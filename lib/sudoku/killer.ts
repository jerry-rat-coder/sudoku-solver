import {
  DIGITS,
  FULL_MASK,
  applyStep,
  bit,
  cloneBoard,
  conflictCellsForValues,
  countBits,
  createBoard,
  digitInMask,
  isSolved,
  maskToDigits,
  snapshot,
  toCellName,
  validateBoard,
  type CandidateRef,
  type MutableBoard,
  type SolveOptions,
  type SolveResult,
  type SolveStep,
  type ValidationIssue,
} from "./model.ts";
import { findNextRegisteredStep } from "./techniques.ts";

/** A standard Killer Sudoku cage: orthogonally connected, non-overlapping cells
 * whose digits are all distinct and add up to `sum`. */
export interface KillerCage {
  cells: readonly number[];
  sum: number;
}

export interface KillerCageBounds {
  min: number;
  max: number;
}

const cageDigitSetCache = new Map<string, readonly number[]>();

function normalizedCells(cells: readonly number[]) {
  return [...new Set(cells)].sort((left, right) => left - right);
}

export function killerCageBounds(size: number): KillerCageBounds | null {
  if (!Number.isInteger(size) || size < 1 || size > 9) return null;
  return {
    min: (size * (size + 1)) / 2,
    max: (size * (19 - size)) / 2,
  };
}

export function isKillerCageContiguous(cells: readonly number[]) {
  const normalized = normalizedCells(cells);
  if (normalized.length === 0) return false;
  const cellSet = new Set(normalized);
  const seen = new Set<number>([normalized[0]]);
  const pending = [normalized[0]];

  while (pending.length) {
    const cell = pending.pop()!;
    const row = Math.floor(cell / 9);
    const column = cell % 9;
    const neighbours = [
      row > 0 ? cell - 9 : -1,
      row < 8 ? cell + 9 : -1,
      column > 0 ? cell - 1 : -1,
      column < 8 ? cell + 1 : -1,
    ];
    for (const neighbour of neighbours) {
      if (cellSet.has(neighbour) && !seen.has(neighbour)) {
        seen.add(neighbour);
        pending.push(neighbour);
      }
    }
  }

  return seen.size === normalized.length;
}

export function validateKillerCages(
  cages: readonly KillerCage[],
  options: { requireCoverage?: boolean } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const occupied = new Map<number, number>();

  cages.forEach((cage, cageIndex) => {
    const cells = normalizedCells(cage.cells);
    const label = `第 ${cageIndex + 1} 个杀手笼`;
    if (cells.length !== cage.cells.length || cells.some((cell) => !Number.isInteger(cell) || cell < 0 || cell >= 81)) {
      issues.push({
        message: `${label}包含无效或重复单元格。`,
        cells: cells.filter((cell) => Number.isInteger(cell) && cell >= 0 && cell < 81),
      });
    }
    if (cells.length < 2 || cells.length > 9) {
      issues.push({
        message: `${label}必须包含 2 到 9 个单元格。`,
        cells,
      });
    }
    if (cells.length > 0 && !isKillerCageContiguous(cells)) {
      issues.push({
        message: `${label}必须由上下左右相连的单元格组成。`,
        cells,
      });
    }
    const bounds = killerCageBounds(cells.length);
    if (
      !bounds ||
      !Number.isInteger(cage.sum) ||
      cage.sum < bounds.min ||
      cage.sum > bounds.max
    ) {
      issues.push({
        message: bounds
          ? `${label}的和数必须在 ${bounds.min} 到 ${bounds.max} 之间。`
          : `${label}的单元格数量不支持和数约束。`,
        cells,
      });
    }
    for (const cell of cells) {
      const firstCage = occupied.get(cell);
      if (firstCage !== undefined) {
        issues.push({
          message: `${label}与第 ${firstCage + 1} 个杀手笼重叠。`,
          cells: [cell],
        });
      } else {
        occupied.set(cell, cageIndex);
      }
    }
  });

  if (options.requireCoverage) {
    const missing = Array.from({ length: 81 }, (_, cell) => cell).filter(
      (cell) => !occupied.has(cell),
    );
    if (missing.length) {
      issues.push({
        message: `标准杀手数独的笼子必须恰好覆盖全部 81 格；还有 ${missing.length} 格未归入任何笼子。`,
        cells: missing,
      });
    }
  }

  return issues;
}

export function killerConflictCellsForValues(
  values: readonly number[],
  cages: readonly KillerCage[],
) {
  const conflicts = conflictCellsForValues(values);
  for (const cage of cages) {
    const known = cage.cells.filter((cell) => values[cell]);
    const byValue = new Map<number, number[]>();
    for (const cell of known) {
      const value = values[cell];
      const same = byValue.get(value) ?? [];
      same.push(cell);
      byValue.set(value, same);
    }
    for (const cells of byValue.values()) {
      if (cells.length > 1) cells.forEach((cell) => conflicts.add(cell));
    }
    const knownSum = known.reduce((sum, cell) => sum + values[cell], 0);
    if (knownSum > cage.sum || (known.length === cage.cells.length && knownSum !== cage.sum)) {
      known.forEach((cell) => conflicts.add(cell));
    }
  }
  return conflicts;
}

function digitSets(size: number, target: number, forbiddenMask: number) {
  const key = `${size}:${target}:${forbiddenMask}`;
  const cached = cageDigitSetCache.get(key);
  if (cached) return cached;

  const sets: number[] = [];
  const visit = (start: number, remaining: number, remainingSum: number, mask: number) => {
    if (remaining === 0) {
      if (remainingSum === 0) sets.push(mask);
      return;
    }
    for (let digit = start; digit <= 10 - remaining; digit += 1) {
      if (forbiddenMask & bit(digit)) continue;
      const nextSum = remainingSum - digit;
      if (nextSum < 0) continue;
      visit(digit + 1, remaining - 1, nextSum, mask | bit(digit));
    }
  };
  visit(1, size, target, 0);
  cageDigitSetCache.set(key, sets);
  return sets;
}

/**
 * Returns the values that can still occur in each empty cage cell.  It first
 * enumerates the distinct digit sets for the target sum, then only admits
 * permutations compatible with each cell's current Sudoku candidates.  This
 * follows the same sum + all-different model used by GridPuzzle's Killer rule.
 */
export function candidatesForKillerCage(
  board: MutableBoard,
  cage: KillerCage,
) {
  const cells = normalizedCells(cage.cells);
  const knownCells = cells.filter((cell) => board.values[cell] !== 0);
  const unknownCells = cells.filter((cell) => board.values[cell] === 0);
  const knownMask = knownCells.reduce(
    (mask, cell) => mask | bit(board.values[cell]),
    0,
  );
  const knownSum = knownCells.reduce((sum, cell) => sum + board.values[cell], 0);

  if (
    countBits(knownMask) !== knownCells.length ||
    knownSum > cage.sum ||
    (unknownCells.length === 0 && knownSum !== cage.sum)
  ) {
    return null;
  }
  if (unknownCells.length === 0) return new Map<number, number>();

  const candidateMasks = unknownCells.map(
    (cell) => board.candidates[cell] & FULL_MASK & ~knownMask,
  );
  if (candidateMasks.some((mask) => mask === 0)) return null;

  const sets = digitSets(
    unknownCells.length,
    cage.sum - knownSum,
    knownMask,
  );
  if (sets.length === 0) return null;

  const allowed = Array(unknownCells.length).fill(0) as number[];
  for (const setMask of sets) {
    const order = unknownCells
      .map((_, index) => index)
      .sort(
        (left, right) =>
          countBits(candidateMasks[left] & setMask) -
          countBits(candidateMasks[right] & setMask),
      );
    const assign = (position: number, remainingMask: number) => {
      if (position === order.length) return remainingMask === 0;
      const cellIndex = order[position];
      const available = candidateMasks[cellIndex] & remainingMask;
      let found = false;
      for (const digit of maskToDigits(available)) {
        if (assign(position + 1, remainingMask & ~bit(digit))) {
          allowed[cellIndex] |= bit(digit);
          found = true;
        }
      }
      return found;
    };
    assign(0, setMask);
  }

  if (allowed.some((mask) => mask === 0)) return null;
  return new Map(unknownCells.map((cell, index) => [cell, allowed[index]]));
}

function killerStateIssues(board: MutableBoard, cages: readonly KillerCage[]) {
  const issues = validateBoard(board);
  for (const [index, cage] of cages.entries()) {
    if (candidatesForKillerCage(board, cage) === null) {
      issues.push({
        message: `第 ${index + 1} 个杀手笼无法满足“和为 ${cage.sum} 且数字不重复”的规则。`,
        cells: normalizedCells(cage.cells),
      });
    }
  }
  return issues;
}

export function findKillerCageStep(
  board: MutableBoard,
  cages: readonly KillerCage[],
): SolveStep | null {
  for (const [index, cage] of cages.entries()) {
    const allowed = candidatesForKillerCage(board, cage);
    if (!allowed) continue;
    const removed: CandidateRef[] = [];
    for (const [cell, allowedMask] of allowed) {
      for (const digit of maskToDigits(board.candidates[cell] & ~allowedMask)) {
        removed.push({ cell, digit });
      }
    }
    if (removed.length === 0) continue;
    const cells = normalizedCells(cage.cells);
    return {
      id: `killer-cage-${index}-${removed.map(({ cell, digit }) => `${cell}-${digit}`).join("_")}`,
      technique: "killer-cage-combination",
      category: "killer",
      label: "杀手笼组合",
      weight: 5,
      action: "eliminate",
      digits: [...new Set(removed.map(({ digit }) => digit))].sort((left, right) => left - right) as SolveStep["digits"],
      cells,
      focusCells: cells,
      relatedCells: cells,
      evidence: [...allowed.entries()].flatMap(([cell, mask]) =>
        maskToDigits(mask).map((digit) => ({ cell, digit })),
      ),
      removed,
      links: [],
      explanation: {
        premise: `第 ${index + 1} 个杀手笼有 ${cells.length} 格，目标和为 ${cage.sum}，且笼内数字不能重复。`,
        reasoning: "枚举满足和数的不同数字组合，并保留能与各格当前候选匹配的排列。",
        conclusion: `删除该笼中 ${removed.length} 个不可能的候选数。`,
      },
    };
  }
  return null;
}

function validPlacementStep(board: MutableBoard, step: SolveStep) {
  if (step.action === "place") {
    return Boolean(
      step.placed &&
        board.values[step.placed.cell] === 0 &&
        digitInMask(board.candidates[step.placed.cell], step.placed.digit),
    );
  }
  return step.removed.length > 0 && step.removed.every(
    ({ cell, digit }) =>
      board.values[cell] === 0 && digitInMask(board.candidates[cell], digit),
  );
}

function normalizeForKillerSearch(board: MutableBoard, cages: readonly KillerCage[]) {
  const normalized = cloneBoard(board);
  for (let round = 0; round < 100; round += 1) {
    let changed = false;
    for (const cage of cages) {
      const allowed = candidatesForKillerCage(normalized, cage);
      if (!allowed) return null;
      for (const [cell, allowedMask] of allowed) {
        const nextMask = normalized.candidates[cell] & allowedMask;
        if (nextMask === 0) return null;
        if (nextMask !== normalized.candidates[cell]) {
          normalized.candidates[cell] = nextMask;
          changed = true;
        }
      }
    }
    const single = normalized.values.findIndex(
      (value, cell) => value === 0 && countBits(normalized.candidates[cell]) === 1,
    );
    if (single !== -1) {
      const [digit] = maskToDigits(normalized.candidates[single]);
      const step: SolveStep = {
        id: `search-single-${single}-${digit}`,
        technique: "killer-constraint-search",
        category: "killer",
        label: "杀手约束传播",
        weight: 999,
        action: "place",
        digit,
        digits: [digit],
        cells: [single],
        focusCells: [single],
        relatedCells: [],
        evidence: [{ cell: single, digit }],
        removed: [],
        placed: { cell: single, digit },
        links: [],
        explanation: { premise: "", reasoning: "", conclusion: "" },
      };
      return normalizeForKillerSearch(applyStep(normalized, step), cages);
    }
    return changed || killerStateIssues(normalized, cages).length === 0
      ? normalized
      : null;
  }
  return null;
}

function findKillerSolution(
  board: MutableBoard,
  cages: readonly KillerCage[],
): number[] | null {
  const normalized = normalizeForKillerSearch(board, cages);
  if (!normalized) return null;
  if (isKillerSolved(normalized, cages)) return normalized.values;
  const choices = normalized.values
    .map((value, cell) => ({ value, cell, count: countBits(normalized.candidates[cell]) }))
    .filter(({ value }) => value === 0)
    .sort((left, right) => left.count - right.count);
  const choice = choices[0];
  if (!choice || choice.count === 0) return null;
  for (const digit of maskToDigits(normalized.candidates[choice.cell])) {
    const step: SolveStep = {
      id: `search-branch-${choice.cell}-${digit}`,
      technique: "killer-constraint-search",
      category: "killer",
      label: "杀手约束验证",
      weight: 999,
      action: "place",
      digit,
      digits: [digit],
      cells: [choice.cell],
      focusCells: [choice.cell],
      relatedCells: [],
      evidence: [{ cell: choice.cell, digit }],
      removed: [],
      placed: { cell: choice.cell, digit },
      links: [],
      explanation: { premise: "", reasoning: "", conclusion: "" },
    };
    const solution: number[] | null = findKillerSolution(
      applyStep(normalized, step),
      cages,
    );
    if (solution) return solution;
  }
  return null;
}

function isKillerSolved(board: MutableBoard, cages: readonly KillerCage[]) {
  return (
    isSolved(board) &&
    cages.every((cage) => {
      const values = cage.cells.map((cell) => board.values[cell]);
      return (
        values.every(Boolean) &&
        new Set(values).size === values.length &&
        values.reduce((sum, value) => sum + value, 0) === cage.sum
      );
    })
  );
}

function solutionStep(board: MutableBoard, solution: readonly number[], cell: number): SolveStep {
  const digit = solution[cell] as (typeof DIGITS)[number];
  return {
    id: `killer-search-${cell}-${digit}`,
    technique: "killer-constraint-search",
    category: "killer",
    label: "杀手约束验证",
    weight: 999,
    action: "place",
    digit,
    digits: [digit],
    cells: [cell],
    focusCells: [cell],
    relatedCells: [],
    evidence: [{ cell, digit }],
    removed: [],
    placed: { cell, digit },
    links: [],
    explanation: {
      premise: "基础技巧与笼组合均无法继续缩减时，求解器保留行、列、宫及每个杀手笼的全部约束进行验证。",
      reasoning: `验证后的可行解确定 ${toCellName(cell)} = ${digit}。`,
      conclusion: `填入 ${toCellName(cell)} = ${digit}。`,
    },
  };
}

export function solveKillerSudoku(
  input: readonly number[],
  cages: readonly KillerCage[],
  options: SolveOptions = {},
): SolveResult {
  const candidateOverrides = options.candidatePolicy === "respect" ? options.candidates : undefined;
  let board = createBoard(input, candidateOverrides);
  const initialIssues = [
    ...validateKillerCages(cages, { requireCoverage: true }),
    ...validateBoard(board, input),
    ...(options.candidatePolicy === "respect" &&
    (!candidateOverrides || candidateOverrides.length !== 81)
      ? [{ message: "候选局面必须包含 81 个有效的九位候选掩码。", cells: [] as number[] }]
      : []),
  ];
  const snapshots = [snapshot(board)];
  const steps: SolveStep[] = [];
  if (initialIssues.length) return { status: "invalid", snapshots, steps, issues: initialIssues };

  const stateIssues = killerStateIssues(board, cages);
  if (stateIssues.length) return { status: "invalid", snapshots, steps, issues: stateIssues };

  for (let iteration = 0; iteration < 1_080; iteration += 1) {
    if (isKillerSolved(board, cages)) return { status: "solved", snapshots, steps, issues: [] };
    const nextStep = findKillerCageStep(board, cages) ?? findNextRegisteredStep(board);
    if (!nextStep) break;
    if (!validPlacementStep(board, nextStep)) {
      return {
        status: "invalid",
        snapshots,
        steps,
        issues: [{ message: `技巧“${nextStep.label}”未能在当前杀手数独盘面中成立。`, cells: nextStep.focusCells }],
      };
    }
    board = applyStep(board, nextStep);
    const issues = killerStateIssues(board, cages);
    if (issues.length) return { status: "invalid", snapshots, steps, issues };
    steps.push({ ...nextStep, id: `step-${steps.length + 1}-${nextStep.id}` });
    snapshots.push(snapshot(board));
  }

  const solution = findKillerSolution(board, cages);
  if (!solution) {
    return {
      status: "invalid",
      snapshots,
      steps,
      issues: [{ message: "在行、列、宫和杀手笼约束下不存在可行解。", cells: [] }],
    };
  }
  for (let cell = 0; cell < 81; cell += 1) {
    if (board.values[cell] !== 0) continue;
    const step = solutionStep(board, solution, cell);
    if (!validPlacementStep(board, step)) {
      return {
        status: "invalid",
        snapshots,
        steps,
        issues: [{ message: "约束验证的落数不在当前候选中，已安全停止。", cells: [cell] }],
      };
    }
    board = applyStep(board, step);
    steps.push({ ...step, id: `step-${steps.length + 1}-${step.id}` });
    snapshots.push(snapshot(board));
  }

  return isKillerSolved(board, cages)
    ? { status: "solved", snapshots, steps, issues: [] }
    : { status: "invalid", snapshots, steps, issues: [{ message: "杀手数独最终盘面未通过笼子校验。", cells: [] }] };
}
