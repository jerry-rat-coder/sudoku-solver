export const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export type Digit = (typeof DIGITS)[number];
export type UnitKind = "row" | "column" | "box";
export type TechniqueCategory =
  | "basic"
  | "intersection"
  | "subset"
  | "fish"
  | "wing"
  | "chain"
  | "forcing";

export type TechniqueId =
  | "naked-single"
  | "hidden-single"
  | "locked-candidate-pointing"
  | "locked-candidate-claiming"
  | "naked-pair"
  | "hidden-pair"
  | "naked-triple"
  | "hidden-triple"
  | "naked-quad"
  | "hidden-quad"
  | "x-wing"
  | "swordfish"
  | "jellyfish"
  | "xy-wing"
  | "xyz-wing"
  | "simple-coloring"
  | "x-chain"
  | "xy-chain"
  | "aic"
  | "nishio-chain"
  | "forcing-net";

export interface CandidateRef {
  cell: number;
  digit: Digit;
}

export interface UnitRef {
  kind: UnitKind;
  index: number;
}

export interface Unit extends UnitRef {
  cells: readonly number[];
}

export interface BoardSnapshot {
  values: readonly number[];
  candidates: readonly number[];
}

export interface ChainLink {
  from: CandidateRef;
  to: CandidateRef;
  type: "strong" | "weak" | "implication";
}

export interface ProofLiteral {
  candidate: CandidateRef;
  state: "true" | "false";
  role: "origin" | "derived" | "conflict";
  reason: "origin" | "weak-link" | "cell-single" | "unit-single" | "branch";
  parents: readonly number[];
  unit?: UnitRef;
}

export interface ProofConflict {
  kind: "candidate" | "cell" | "unit";
  message: string;
  cells: readonly number[];
  nodeIndexes: readonly number[];
  unit?: UnitRef;
  digit?: Digit;
}

export interface ForcingProof {
  mode: "nishio" | "net";
  assumption: CandidateRef;
  conclusion: CandidateRef;
  contradiction: string;
  path: readonly CandidateRef[];
  literals: readonly ProofLiteral[];
  conflict?: ProofConflict;
  exploredBranches: number;
  maxDepth: number;
}

export interface StepExplanation {
  premise: string;
  reasoning: string;
  conclusion: string;
}

export interface SolveStep {
  id: string;
  technique: TechniqueId;
  category: TechniqueCategory;
  label: string;
  weight: number;
  action: "place" | "eliminate";
  unit?: UnitRef;
  digit?: Digit;
  digits: readonly Digit[];
  cells: readonly number[];
  focusCells: readonly number[];
  relatedCells: readonly number[];
  evidence: readonly CandidateRef[];
  removed: readonly CandidateRef[];
  placed?: CandidateRef;
  links: readonly ChainLink[];
  proof?: ForcingProof;
  explanation: StepExplanation;
}

export interface ValidationIssue {
  message: string;
  cells: readonly number[];
}

export interface SolveResult {
  status: "solved" | "stuck" | "invalid";
  snapshots: readonly BoardSnapshot[];
  steps: readonly SolveStep[];
  issues: readonly ValidationIssue[];
}

export interface SolveOptions {
  candidatePolicy?: "recompute" | "respect";
  candidates?: readonly number[];
}

export interface MutableBoard {
  values: number[];
  candidates: number[];
}

export interface TechniqueDefinition {
  id: TechniqueId;
  label: string;
  weight: number;
  category: TechniqueCategory;
  description: string;
}

export const FULL_MASK = 0b111111111;
export const bit = (digit: number) => 1 << (digit - 1);

export const ROWS: readonly Unit[] = Array.from({ length: 9 }, (_, row) => ({
  kind: "row",
  index: row,
  cells: Array.from({ length: 9 }, (_, column) => row * 9 + column),
}));

export const COLUMNS: readonly Unit[] = Array.from(
  { length: 9 },
  (_, column) => ({
    kind: "column",
    index: column,
    cells: Array.from({ length: 9 }, (_, row) => row * 9 + column),
  }),
);

export const BOXES: readonly Unit[] = Array.from({ length: 9 }, (_, box) => {
  const rowStart = Math.floor(box / 3) * 3;
  const columnStart = (box % 3) * 3;
  return {
    kind: "box",
    index: box,
    cells: Array.from(
      { length: 9 },
      (_, offset) =>
        (rowStart + Math.floor(offset / 3)) * 9 +
        columnStart +
        (offset % 3),
    ),
  };
});

export const UNITS: readonly Unit[] = [...ROWS, ...COLUMNS, ...BOXES];

export const CELL_UNITS: readonly (readonly Unit[])[] = Array.from(
  { length: 81 },
  (_, cell) => {
    const row = Math.floor(cell / 9);
    const column = cell % 9;
    const box = Math.floor(row / 3) * 3 + Math.floor(column / 3);
    return [ROWS[row], COLUMNS[column], BOXES[box]];
  },
);

export const PEERS: readonly (readonly number[])[] = Array.from(
  { length: 81 },
  (_, cell) =>
    [
      ...new Set(CELL_UNITS[cell].flatMap((unit) => [...unit.cells])),
    ]
      .filter((peer) => peer !== cell)
      .sort((left, right) => left - right),
);

export function toCellName(cell: number) {
  return `R${Math.floor(cell / 9) + 1}C${(cell % 9) + 1}`;
}

export function describeUnit(unit?: UnitRef) {
  if (!unit) return "";
  const names: Record<UnitKind, string> = {
    row: "行",
    column: "列",
    box: "宫",
  };
  return `第 ${unit.index + 1} ${names[unit.kind]}`;
}

export function maskToDigits(mask: number): Digit[] {
  return DIGITS.filter((digit) => (mask & bit(digit)) !== 0);
}

export function digitInMask(mask: number, digit: number) {
  return (mask & bit(digit)) !== 0;
}

export function countBits(mask: number) {
  let value = mask;
  let count = 0;
  while (value > 0) {
    value &= value - 1;
    count += 1;
  }
  return count;
}

export function cloneBoard(board: MutableBoard): MutableBoard {
  return {
    values: [...board.values],
    candidates: [...board.candidates],
  };
}

export function snapshot(board: MutableBoard): BoardSnapshot {
  return {
    values: [...board.values],
    candidates: [...board.candidates],
  };
}

export function createBoard(
  input: readonly number[],
  candidateOverrides?: readonly number[],
): MutableBoard {
  const values = Array.from({ length: 81 }, (_, index) => {
    const value = Number(input[index] ?? 0);
    return Number.isInteger(value) && value >= 1 && value <= 9 ? value : 0;
  });

  const candidates = values.map((value, cell) => {
    if (value !== 0) return 0;
    const used = PEERS[cell].reduce((mask, peer) => {
      const peerValue = values[peer];
      return peerValue ? mask | bit(peerValue) : mask;
    }, 0);
    const legalMask = FULL_MASK & ~used;
    const override = Number(candidateOverrides?.[cell] ?? 0);
    return Number.isInteger(override) && override > 0 && override <= FULL_MASK
      ? legalMask & override
      : legalMask;
  });

  return { values, candidates };
}

export function conflictCellsForValues(input: readonly number[]) {
  const conflicts = new Set<number>();
  for (const unit of UNITS) {
    const cellsByDigit = new Map<number, number[]>();
    for (const cell of unit.cells) {
      const value = input[cell] ?? 0;
      if (!value) continue;
      const cells = cellsByDigit.get(value) ?? [];
      cells.push(cell);
      cellsByDigit.set(value, cells);
    }
    for (const cells of cellsByDigit.values()) {
      if (cells.length > 1) cells.forEach((cell) => conflicts.add(cell));
    }
  }
  return conflicts;
}

export function validateBoard(
  board: MutableBoard,
  rawInput?: readonly number[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (
    rawInput &&
    (rawInput.length !== 81 ||
      rawInput.some(
        (value) =>
          !Number.isInteger(Number(value)) ||
          Number(value) < 0 ||
          Number(value) > 9,
      ))
  ) {
    issues.push({
      message: "题目必须恰好包含 81 个 0 到 9 之间的整数。",
      cells: [],
    });
  }

  const conflicts = conflictCellsForValues(board.values);
  if (conflicts.size > 0) {
    issues.push({
      message: "盘面中存在同行、同列或同宫的重复数字。",
      cells: [...conflicts].sort((left, right) => left - right),
    });
  }

  const impossible = board.values
    .map((value, cell) => ({ value, cell }))
    .filter(({ value, cell }) => value === 0 && board.candidates[cell] === 0)
    .map(({ cell }) => cell);
  if (impossible.length > 0) {
    issues.push({
      message: "部分空格已经没有合法候选数，请检查题目或推理链。",
      cells: impossible,
    });
  }

  const missingPlaces = UNITS.flatMap((unit) =>
    DIGITS.filter(
      (digit) =>
        !unit.cells.some((cell) => board.values[cell] === digit) &&
        !unit.cells.some(
          (cell) =>
            board.values[cell] === 0 &&
            digitInMask(board.candidates[cell], digit),
        ),
    ).map(() => unit),
  );
  if (missingPlaces.length > 0) {
    issues.push({
      message: "至少一个单位中的数字已经没有可放置的位置。",
      cells: [...new Set(missingPlaces.flatMap((unit) => unit.cells))].sort(
        (left, right) => left - right,
      ),
    });
  }

  return issues;
}

export function applyStep(
  board: MutableBoard,
  step: SolveStep,
): MutableBoard {
  const next = cloneBoard(board);

  if (step.action === "place" && step.placed) {
    const { cell, digit } = step.placed;
    next.values[cell] = digit;
    next.candidates[cell] = 0;
    for (const peer of PEERS[cell]) {
      if (next.values[peer] === 0) {
        next.candidates[peer] &= ~bit(digit);
      }
    }
    return next;
  }

  for (const { cell, digit } of step.removed) {
    if (next.values[cell] === 0) {
      next.candidates[cell] &= ~bit(digit);
    }
  }
  return next;
}

export function isSolved(board: MutableBoard) {
  if (board.values.some((value) => value === 0)) return false;
  return conflictCellsForValues(board.values).size === 0;
}

export function cellsSeeEachOther(left: number, right: number) {
  return PEERS[left].includes(right);
}

export function commonPeers(cells: readonly number[]) {
  if (cells.length === 0) return [];
  return PEERS[cells[0]].filter((peer) =>
    cells.slice(1).every((cell) => PEERS[cell].includes(peer)),
  );
}

export function combinations<T>(
  values: readonly T[],
  size: number,
): T[][] {
  const result: T[][] = [];
  const build = (start: number, selected: T[]) => {
    if (selected.length === size) {
      result.push([...selected]);
      return;
    }
    for (
      let index = start;
      index <= values.length - (size - selected.length);
      index += 1
    ) {
      selected.push(values[index]);
      build(index + 1, selected);
      selected.pop();
    }
  };
  build(0, []);
  return result;
}
