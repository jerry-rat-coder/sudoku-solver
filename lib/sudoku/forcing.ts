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
  type ChainLink,
  type Digit,
  type ForcingProof,
  type MutableBoard,
  type ProofConflict,
  type ProofLiteral,
  type SolveStep,
  type TechniqueDefinition,
  type Unit,
} from "./model.ts";

export const FORCING_TECHNIQUES: readonly TechniqueDefinition[] = [
  {
    id: "nishio-chain",
    label: "西尾强制链",
    weight: 300,
    category: "forcing",
    description:
      "从一个待判候选建立带因果父节点的真假候选链，以明确冲突反证。",
  },
  {
    id: "forcing-net",
    label: "强制网",
    weight: 900,
    category: "forcing",
    description: "穷尽候选下的所有逻辑分支，以完整反证树排除候选。",
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

interface CausalProof {
  literals: ProofLiteral[];
  conflict: ProofConflict;
}

function unitName(unit: Pick<Unit, "kind" | "index">) {
  const kind =
    unit.kind === "row" ? "行" : unit.kind === "column" ? "列" : "宫";
  return `第 ${unit.index + 1} ${kind}`;
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
        return `${unitName(unit)}中的数字 ${digit} 已无可放置位置`;
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

function literalId({ cell, digit }: CandidateRef) {
  return cell * 9 + digit - 1;
}

function buildCausalNishioProof(
  board: MutableBoard,
  assumption: CandidateRef,
): CausalProof | null {
  const initialCandidates = Array.from({ length: 729 }, () => false);
  const cellCandidates: number[][] = Array.from({ length: 81 }, () => []);
  for (let cell = 0; cell < 81; cell += 1) {
    if (board.values[cell] !== 0) continue;
    for (const digit of maskToDigits(board.candidates[cell])) {
      const id = literalId({ cell, digit });
      initialCandidates[id] = true;
      cellCandidates[cell].push(id);
    }
  }

  const states = new Int8Array(729);
  const trueNodes = new Int32Array(729).fill(-1);
  const falseNodes = new Int32Array(729).fill(-1);
  const literals: ProofLiteral[] = [];
  let conflict: ProofConflict | undefined;

  const candidateForId = (id: number): CandidateRef => ({
    cell: Math.floor(id / 9),
    digit: ((id % 9) + 1) as Digit,
  });

  const addLiteral = (
    candidate: CandidateRef,
    state: "true" | "false",
    reason: ProofLiteral["reason"],
    parents: readonly number[],
    unit?: ProofLiteral["unit"],
  ) => {
    if (conflict) return -1;
    const id = literalId(candidate);
    const desired = state === "true" ? 1 : -1;
    const existingOpposite =
      state === "true" ? falseNodes[id] : trueNodes[id];
    if (states[id] === desired) {
      return state === "true" ? trueNodes[id] : falseNodes[id];
    }

    const nodeIndex = literals.length;
    literals.push({
      candidate,
      state,
      role: nodeIndex === 0 ? "origin" : "derived",
      reason,
      parents: [...parents],
      unit,
    });

    if (existingOpposite >= 0) {
      conflict = {
        kind: "candidate",
        message: `${toCellName(candidate.cell)}(${candidate.digit}) 被同时推出为真和为假`,
        cells: [candidate.cell],
        nodeIndexes: [existingOpposite, nodeIndex],
      };
      return nodeIndex;
    }

    states[id] = desired;
    if (state === "true") trueNodes[id] = nodeIndex;
    else falseNodes[id] = nodeIndex;
    return nodeIndex;
  };

  const findEmptyCellConflict = () => {
    for (let cell = 0; cell < 81; cell += 1) {
      if (board.values[cell] !== 0 || cellCandidates[cell].length === 0) {
        continue;
      }
      if (cellCandidates[cell].every((id) => states[id] === -1)) {
        const nodeIndexes = cellCandidates[cell].map((id) => falseNodes[id]);
        return {
          kind: "cell" as const,
          message: `${toCellName(cell)} 的所有候选都被推出为假`,
          cells: [cell],
          nodeIndexes,
        };
      }
    }
    return undefined;
  };

  const findEmptyUnitConflict = () => {
    for (const unit of UNITS) {
      for (const digit of DIGITS) {
        if (unit.cells.some((cell) => board.values[cell] === digit)) continue;
        const ids = unit.cells
          .filter((cell) => board.values[cell] === 0)
          .map((cell) => literalId({ cell, digit }))
          .filter((id) => initialCandidates[id]);
        if (ids.length > 0 && ids.every((id) => states[id] === -1)) {
          return {
            kind: "unit" as const,
            message: `${unitName(unit)}中的数字 ${digit} 所有位置都被推出为假`,
            cells: ids.map((id) => candidateForId(id).cell),
            nodeIndexes: ids.map((id) => falseNodes[id]),
            unit: { kind: unit.kind, index: unit.index },
            digit,
          };
        }
      }
    }
    return undefined;
  };

  addLiteral(assumption, "true", "origin", []);
  for (let cursor = 0; cursor < literals.length && !conflict; cursor += 1) {
    const literal = literals[cursor];
    if (literal.state === "true") {
      const { cell, digit } = literal.candidate;
      for (const id of cellCandidates[cell]) {
        const other = candidateForId(id);
        if (other.digit !== digit) {
          addLiteral(other, "false", "weak-link", [cursor]);
          if (conflict) break;
        }
      }
      if (conflict) break;
      for (const peer of PEERS[cell]) {
        const id = literalId({ cell: peer, digit });
        if (initialCandidates[id]) {
          addLiteral({ cell: peer, digit }, "false", "weak-link", [cursor]);
          if (conflict) break;
        }
      }
    }
    if (conflict) break;

    conflict = findEmptyCellConflict() ?? findEmptyUnitConflict();
    if (conflict) break;

    for (let cell = 0; cell < 81 && !conflict; cell += 1) {
      if (board.values[cell] !== 0) continue;
      const ids = cellCandidates[cell];
      if (ids.some((id) => states[id] === 1)) continue;
      const remaining = ids.filter((id) => states[id] !== -1);
      if (remaining.length === 1) {
        const parents = ids
          .filter((id) => states[id] === -1)
          .map((id) => falseNodes[id]);
        addLiteral(
          candidateForId(remaining[0]),
          "true",
          "cell-single",
          parents,
        );
      }
    }
    if (conflict) break;

    for (const unit of UNITS) {
      if (conflict) break;
      for (const digit of DIGITS) {
        if (unit.cells.some((cell) => board.values[cell] === digit)) continue;
        const ids = unit.cells
          .filter((cell) => board.values[cell] === 0)
          .map((cell) => literalId({ cell, digit }))
          .filter((id) => initialCandidates[id]);
        if (ids.some((id) => states[id] === 1)) continue;
        const remaining = ids.filter((id) => states[id] !== -1);
        if (remaining.length === 1) {
          const parents = ids
            .filter((id) => states[id] === -1)
            .map((id) => falseNodes[id]);
          addLiteral(
            candidateForId(remaining[0]),
            "true",
            "unit-single",
            parents,
            { kind: unit.kind, index: unit.index },
          );
          if (conflict) break;
        }
      }
    }
  }

  if (!conflict) return null;

  const included = new Set<number>();
  const includeAncestors = (nodeIndex: number) => {
    if (included.has(nodeIndex) || nodeIndex < 0) return;
    included.add(nodeIndex);
    for (const parent of literals[nodeIndex].parents) includeAncestors(parent);
  };
  for (const nodeIndex of conflict.nodeIndexes) includeAncestors(nodeIndex);
  const ordered = [...included].sort((left, right) => left - right);
  const remap = new Map(ordered.map((oldIndex, index) => [oldIndex, index]));
  const conflictNodes = new Set(conflict.nodeIndexes);
  const prunedLiterals = ordered.map((oldIndex, index): ProofLiteral => ({
    ...literals[oldIndex],
    role:
      index === 0
        ? "origin"
        : conflictNodes.has(oldIndex)
          ? "conflict"
          : "derived",
    parents: literals[oldIndex].parents
      .filter((parent) => remap.has(parent))
      .map((parent) => remap.get(parent)!),
  }));
  const prunedConflict: ProofConflict = {
    ...conflict,
    nodeIndexes: conflict.nodeIndexes.map((index) => remap.get(index)!),
  };

  return { literals: prunedLiterals, conflict: prunedConflict };
}

function linksFromProof(literals: readonly ProofLiteral[]): ChainLink[] {
  const links: ChainLink[] = [];
  for (const [childIndex, child] of literals.entries()) {
    for (const parentIndex of child.parents) {
      const parent = literals[parentIndex];
      if (!parent || parentIndex >= childIndex) continue;
      links.push({
        from: parent.candidate,
        to: child.candidate,
        type:
          child.reason === "weak-link"
            ? "weak"
            : child.parents.length === 1
              ? "strong"
              : "implication",
      });
    }
  }
  return links;
}

function nishioStep(
  assumption: CandidateRef,
  causalProof: CausalProof,
): SolveStep {
  const definition = FORCING_TECHNIQUES[0];
  const path = causalProof.literals.map(({ candidate }) => candidate);
  const cells = [
    ...new Set([
      ...path.map(({ cell }) => cell),
      ...causalProof.conflict.cells,
    ]),
  ].sort((left, right) => left - right);

  return {
    id: `${definition.id}-${assumption.cell}-${assumption.digit}`,
    technique: definition.id,
    category: definition.category,
    label: definition.label,
    weight: definition.weight,
    action: "eliminate",
    digit: assumption.digit,
    digits: [assumption.digit],
    cells,
    focusCells: [assumption.cell, ...causalProof.conflict.cells],
    relatedCells: cells,
    evidence: path,
    removed: [assumption],
    links: linksFromProof(causalProof.literals),
    proof: {
      mode: "nishio",
      assumption,
      conclusion: assumption,
      contradiction: causalProof.conflict.message,
      path,
      literals: causalProof.literals,
      conflict: causalProof.conflict,
      exploredBranches: 0,
      maxDepth: 0,
    },
    explanation: {
      premise: `从待判候选 ${toCellName(assumption.cell)}(${assumption.digit}) 为真出发，建立西尾真假候选链。`,
      reasoning: `沿“真候选排除弱邻居”和“其余位置为假则唯一位置为真”传播，最终冲突：${causalProof.conflict.message}。`,
      conclusion: `链首候选不能为真，删除 ${toCellName(assumption.cell)} 的候选数 ${assumption.digit}。`,
    },
  };
}

export function findNishioChain(board: MutableBoard): SolveStep | null {
  for (const assumption of orderedCandidates(board)) {
    const proof = buildCausalNishioProof(board, assumption);
    if (proof) return nishioStep(assumption, proof);
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
    const result = propagate(board, { cell: branchCell, digit }, trace);
    if (result.contradiction) {
      if (stats.samplePath.length === 0) {
        stats.samplePath = result.trace;
        stats.contradiction = result.contradiction;
      }
      continue;
    }
    if (hasCompletion(result.board, result.trace, depth + 1, stats, memo)) {
      memo.set(key, true);
      return true;
    }
  }

  memo.set(key, false);
  return false;
}

function forcingNetStep(
  assumption: CandidateRef,
  path: readonly CandidateRef[],
  contradiction: string,
  exploredBranches: number,
  maxDepth: number,
): SolveStep {
  const definition = FORCING_TECHNIQUES[1];
  const preview = path.slice(0, 18);
  const proof: ForcingProof = {
    mode: "net",
    assumption,
    conclusion: assumption,
    contradiction,
    path,
    literals: [
      {
        candidate: assumption,
        state: "true",
        role: "origin",
        reason: "branch",
        parents: [],
      },
    ],
    exploredBranches,
    maxDepth,
  };

  return {
    id: `${definition.id}-${assumption.cell}-${assumption.digit}`,
    technique: definition.id,
    category: definition.category,
    label: definition.label,
    weight: definition.weight,
    action: "eliminate",
    digit: assumption.digit,
    digits: [assumption.digit],
    cells: [...new Set(preview.map(({ cell }) => cell))],
    focusCells: [assumption.cell],
    relatedCells: [...new Set(preview.map(({ cell }) => cell))],
    evidence: [assumption],
    removed: [assumption],
    links: [],
    proof,
    explanation: {
      premise: `以待判候选 ${toCellName(assumption.cell)}(${assumption.digit}) 为根建立穷尽证明树。`,
      reasoning: `证明树核验了 ${exploredBranches} 个分支（最大深度 ${maxDepth}），每个叶节点都落入矛盾：${contradiction}。`,
      conclusion: `所有分支均失败，删除 ${toCellName(assumption.cell)} 的候选数 ${assumption.digit}。`,
    },
  };
}

export function findForcingNet(board: MutableBoard): SolveStep | null {
  for (const assumption of orderedCandidates(board)) {
    const initial = propagate(board, assumption);
    if (initial.contradiction) {
      const proof = buildCausalNishioProof(board, assumption);
      if (proof) return nishioStep(assumption, proof);
      continue;
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

    return forcingNetStep(
      assumption,
      stats.samplePath.length > 0 ? stats.samplePath : initial.trace,
      stats.contradiction,
      stats.exploredBranches,
      stats.maxDepth,
    );
  }
  return null;
}
