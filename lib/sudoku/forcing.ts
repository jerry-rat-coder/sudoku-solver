import {
  DIGITS,
  PEERS,
  UNITS,
  bit,
  cloneBoard,
  conflictCellsForValues,
  countBits,
  digitInMask,
  isSolved,
  maskToDigits,
  toCellName,
  type CandidateRef,
  type Digit,
  type MutableBoard,
  type SolveStep,
  type TechniqueDefinition,
} from "./model.ts";

export const FORCING_TECHNIQUES: readonly TechniqueDefinition[] = [
  {
    id: "forcing-chain",
    label: "矛盾链",
    weight: 800,
    category: "forcing",
    description: "假设一个候选为真，仅用确定性传播即可推出矛盾。",
  },
  {
    id: "forcing-net",
    label: "强制网",
    weight: 900,
    category: "forcing",
    description: "穷尽假设下的所有逻辑分支，以反证树排除候选。",
  },
];

interface PropagationResult {
  board: MutableBoard;
  trace: CandidateRef[];
  contradiction?: string;
}

interface SearchStats {
  exploredBranches: number;
  maxDepth: number;
  samplePath: CandidateRef[];
  contradiction: string;
}

function firstContradiction(board: MutableBoard) {
  const conflicts = conflictCellsForValues(board.values);
  if (conflicts.size > 0) {
    const [first] = [...conflicts].sort((left, right) => left - right);
    return `${toCellName(first)} 所在单位出现重复数字`;
  }

  for (let cell = 0; cell < 81; cell += 1) {
    if (board.values[cell] === 0 && board.candidates[cell] === 0) {
      return `${toCellName(cell)} 已经没有任何候选数`;
    }
  }

  for (const unit of UNITS) {
    for (const digit of DIGITS) {
      const isPlaced = unit.cells.some((cell) => board.values[cell] === digit);
      if (isPlaced) continue;
      const hasPosition = unit.cells.some(
        (cell) =>
          board.values[cell] === 0 &&
          digitInMask(board.candidates[cell], digit),
      );
      if (!hasPosition) {
        const unitName =
          unit.kind === "row" ? "行" : unit.kind === "column" ? "列" : "宫";
        return `第 ${unit.index + 1} ${unitName}中的数字 ${digit} 已无可放置位置`;
      }
    }
  }

  return undefined;
}

function assign(
  board: MutableBoard,
  candidate: CandidateRef,
  trace: CandidateRef[],
) {
  const { cell, digit } = candidate;
  if (board.values[cell] !== 0) {
    return board.values[cell] === digit
      ? undefined
      : `${toCellName(cell)} 被迫同时取两个不同数字`;
  }
  if (!digitInMask(board.candidates[cell], digit)) {
    return `${toCellName(cell)} 已经不能取 ${digit}`;
  }
  if (PEERS[cell].some((peer) => board.values[peer] === digit)) {
    return `${toCellName(cell)} = ${digit} 与同单位已填数字冲突`;
  }

  board.values[cell] = digit;
  board.candidates[cell] = 0;
  trace.push(candidate);
  for (const peer of PEERS[cell]) {
    if (board.values[peer] === 0) {
      board.candidates[peer] &= ~bit(digit);
    }
  }
  return undefined;
}

function propagate(
  source: MutableBoard,
  assumption: CandidateRef,
  inheritedTrace: readonly CandidateRef[] = [],
): PropagationResult {
  const board = cloneBoard(source);
  const trace = [...inheritedTrace];
  const assignmentIssue = assign(board, assumption, trace);
  if (assignmentIssue) {
    return { board, trace, contradiction: assignmentIssue };
  }

  for (;;) {
    const contradiction = firstContradiction(board);
    if (contradiction) return { board, trace, contradiction };

    let next: CandidateRef | undefined;
    for (let cell = 0; cell < 81; cell += 1) {
      if (
        board.values[cell] === 0 &&
        countBits(board.candidates[cell]) === 1
      ) {
        next = { cell, digit: maskToDigits(board.candidates[cell])[0] };
        break;
      }
    }

    if (!next) {
      outer: for (const unit of UNITS) {
        for (const digit of DIGITS) {
          if (unit.cells.some((cell) => board.values[cell] === digit)) {
            continue;
          }
          const cells = unit.cells.filter(
            (cell) =>
              board.values[cell] === 0 &&
              digitInMask(board.candidates[cell], digit),
          );
          if (cells.length === 1) {
            next = { cell: cells[0], digit };
            break outer;
          }
        }
      }
    }

    if (!next) return { board, trace };
    const issue = assign(board, next, trace);
    if (issue) return { board, trace, contradiction: issue };
  }
}

function orderedCandidates(board: MutableBoard) {
  return Array.from({ length: 81 }, (_, cell) => cell)
    .filter((cell) => board.values[cell] === 0)
    .sort(
      (left, right) =>
        countBits(board.candidates[left]) -
          countBits(board.candidates[right]) || left - right,
    )
    .flatMap((cell) =>
      maskToDigits(board.candidates[cell]).map((digit) => ({ cell, digit })),
    );
}

function linksFromPath(path: readonly CandidateRef[]) {
  return path.slice(0, -1).map((candidate, index) => ({
    from: candidate,
    to: path[index + 1],
    type: "implication" as const,
  }));
}

function forcingStep(
  assumption: CandidateRef,
  mode: "chain" | "net",
  trace: readonly CandidateRef[],
  contradiction: string,
  exploredBranches: number,
  maxDepth: number,
): SolveStep {
  const definition = FORCING_TECHNIQUES[mode === "chain" ? 0 : 1];
  const path = trace.length > 0 ? [...trace] : [assumption];
  const pathPreview = path.slice(0, 18);
  const branchDescription =
    mode === "chain"
      ? "基础落数传播"
      : `${exploredBranches} 个穷尽分支、最大嵌套深度 ${maxDepth}`;

  return {
    id: `${definition.id}-${assumption.cell}-${assumption.digit}`,
    technique: definition.id,
    category: definition.category,
    label: definition.label,
    weight: definition.weight,
    action: "eliminate",
    digit: assumption.digit,
    digits: [assumption.digit],
    cells: [...new Set(pathPreview.map(({ cell }) => cell))],
    focusCells: [assumption.cell],
    relatedCells: [
      ...new Set(pathPreview.flatMap(({ cell }) => PEERS[cell])),
    ].sort((left, right) => left - right),
    evidence: pathPreview,
    removed: [assumption],
    links: linksFromPath(pathPreview),
    proof: {
      mode,
      assumption,
      conclusion: assumption,
      contradiction,
      path,
      exploredBranches,
      maxDepth,
    },
    explanation: {
      premise: `暂时假设 ${toCellName(assumption.cell)} = ${assumption.digit}。`,
      reasoning: `沿候选约束进行${branchDescription}后得到矛盾：${contradiction}。`,
      conclusion: `原假设不成立，删除 ${toCellName(assumption.cell)} 的候选数 ${assumption.digit}。`,
    },
  };
}

export function findForcingChain(board: MutableBoard): SolveStep | null {
  for (const assumption of orderedCandidates(board)) {
    const result = propagate(board, assumption);
    if (!result.contradiction) continue;
    return forcingStep(
      assumption,
      "chain",
      result.trace,
      result.contradiction,
      0,
      0,
    );
  }
  return null;
}

function stateKey(board: MutableBoard) {
  return `${board.values.join("")}|${board.candidates.join(",")}`;
}

function hasCompletion(
  board: MutableBoard,
  trace: readonly CandidateRef[],
  depth: number,
  stats: SearchStats,
  memo: Map<string, boolean>,
): boolean {
  const contradiction = firstContradiction(board);
  if (contradiction) {
    if (stats.samplePath.length === 0) {
      stats.samplePath = [...trace];
      stats.contradiction = contradiction;
    }
    return false;
  }
  if (isSolved(board)) return true;

  const key = stateKey(board);
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  let branchCell = -1;
  let branchCount = 10;
  for (let cell = 0; cell < 81; cell += 1) {
    if (board.values[cell] !== 0) continue;
    const count = countBits(board.candidates[cell]);
    if (count < branchCount) {
      branchCell = cell;
      branchCount = count;
    }
  }
  if (branchCell < 0) return false;

  stats.maxDepth = Math.max(stats.maxDepth, depth + 1);
  for (const digit of maskToDigits(board.candidates[branchCell])) {
    stats.exploredBranches += 1;
    const result = propagate(
      board,
      { cell: branchCell, digit },
      trace,
    );
    if (result.contradiction) {
      if (stats.samplePath.length === 0) {
        stats.samplePath = result.trace;
        stats.contradiction = result.contradiction;
      }
      continue;
    }
    if (
      hasCompletion(
        result.board,
        result.trace,
        depth + 1,
        stats,
        memo,
      )
    ) {
      memo.set(key, true);
      return true;
    }
  }

  memo.set(key, false);
  return false;
}

export function findForcingNet(board: MutableBoard): SolveStep | null {
  for (const assumption of orderedCandidates(board)) {
    const initial = propagate(board, assumption);
    if (initial.contradiction) {
      return forcingStep(
        assumption,
        "chain",
        initial.trace,
        initial.contradiction,
        0,
        0,
      );
    }

    const stats: SearchStats = {
      exploredBranches: 0,
      maxDepth: 0,
      samplePath: [],
      contradiction: "所有候选分支均不可成立",
    };
    const hasSolution = hasCompletion(
      initial.board,
      initial.trace,
      0,
      stats,
      new Map(),
    );
    if (hasSolution) continue;

    return forcingStep(
      assumption,
      "net",
      stats.samplePath.length > 0 ? stats.samplePath : initial.trace,
      stats.contradiction,
      stats.exploredBranches,
      stats.maxDepth,
    );
  }
  return null;
}
