export const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export type Digit = (typeof DIGITS)[number];
export type TechniqueId =
  | "naked-single"
  | "hidden-single"
  | "naked-pair"
  | "hidden-pair";
export type UnitKind = "row" | "column" | "box";

export interface CandidateRef {
  cell: number;
  digit: Digit;
}

export interface UnitRef {
  kind: UnitKind;
  index: number;
}

export interface BoardSnapshot {
  values: readonly number[];
  candidates: readonly number[];
}

export interface SolveStep {
  id: string;
  technique: TechniqueId;
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

interface Unit extends UnitRef {
  cells: readonly number[];
}

interface MutableBoard {
  values: number[];
  candidates: number[];
}

const FULL_MASK = 0b111111111;
const bit = (digit: number) => 1 << (digit - 1);

const ROWS: Unit[] = Array.from({ length: 9 }, (_, row) => ({
  kind: "row",
  index: row,
  cells: Array.from({ length: 9 }, (_, column) => row * 9 + column),
}));

const COLUMNS: Unit[] = Array.from({ length: 9 }, (_, column) => ({
  kind: "column",
  index: column,
  cells: Array.from({ length: 9 }, (_, row) => row * 9 + column),
}));

const BOXES: Unit[] = Array.from({ length: 9 }, (_, box) => {
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

export const PEERS: readonly (readonly number[])[] = Array.from(
  { length: 81 },
  (_, cell) => {
    const row = Math.floor(cell / 9);
    const column = cell % 9;
    const box = Math.floor(row / 3) * 3 + Math.floor(column / 3);
    return [
      ...new Set([
        ...ROWS[row].cells,
        ...COLUMNS[column].cells,
        ...BOXES[box].cells,
      ]),
    ]
      .filter((peer) => peer !== cell)
      .sort((a, b) => a - b);
  },
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

function countBits(mask: number) {
  let value = mask;
  let count = 0;
  while (value > 0) {
    value &= value - 1;
    count += 1;
  }
  return count;
}

function snapshot(board: MutableBoard): BoardSnapshot {
  return {
    values: [...board.values],
    candidates: [...board.candidates],
  };
}

function createBoard(input: readonly number[]): MutableBoard {
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
    return FULL_MASK & ~used;
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

function validateBoard(board: MutableBoard): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const conflicts = conflictCellsForValues(board.values);
  if (conflicts.size > 0) {
    issues.push({
      message: "盘面中存在同行、同列或同宫的重复数字。",
      cells: [...conflicts].sort((a, b) => a - b),
    });
  }

  const impossible = board.values
    .map((value, cell) => ({ value, cell }))
    .filter(({ value, cell }) => value === 0 && board.candidates[cell] === 0)
    .map(({ cell }) => cell);

  if (impossible.length > 0) {
    issues.push({
      message: "部分空格已经没有合法候选数，请检查题目。",
      cells: impossible,
    });
  }
  return issues;
}

function makePlacementStep(
  technique: Extract<TechniqueId, "naked-single" | "hidden-single">,
  cell: number,
  digit: Digit,
  unit?: Unit,
): SolveStep {
  return {
    id: `${technique}-${cell}-${digit}`,
    technique,
    label: technique === "naked-single" ? "裸单" : "隐性唯一数",
    weight: technique === "naked-single" ? 10 : 20,
    action: "place",
    unit: unit
      ? { kind: unit.kind, index: unit.index }
      : undefined,
    digit,
    digits: [digit],
    cells: [cell],
    focusCells: [cell],
    relatedCells: unit ? [...unit.cells] : [],
    evidence: [{ cell, digit }],
    removed: [],
    placed: { cell, digit },
  };
}

function findNakedSingle(board: MutableBoard): SolveStep | null {
  for (let cell = 0; cell < 81; cell += 1) {
    if (board.values[cell] !== 0) continue;
    const mask = board.candidates[cell];
    if (countBits(mask) !== 1) continue;
    const [digit] = maskToDigits(mask);
    return makePlacementStep("naked-single", cell, digit);
  }
  return null;
}

function findHiddenSingle(board: MutableBoard): SolveStep | null {
  for (const unit of UNITS) {
    for (const digit of DIGITS) {
      if (unit.cells.some((cell) => board.values[cell] === digit)) continue;
      const possibleCells = unit.cells.filter(
        (cell) =>
          board.values[cell] === 0 &&
          digitInMask(board.candidates[cell], digit),
      );
      if (possibleCells.length === 1) {
        return makePlacementStep(
          "hidden-single",
          possibleCells[0],
          digit,
          unit,
        );
      }
    }
  }
  return null;
}

function findNakedPair(board: MutableBoard): SolveStep | null {
  for (const unit of UNITS) {
    const pairCells = unit.cells.filter(
      (cell) =>
        board.values[cell] === 0 &&
        countBits(board.candidates[cell]) === 2,
    );

    for (let left = 0; left < pairCells.length; left += 1) {
      const firstCell = pairCells[left];
      const pairMask = board.candidates[firstCell];
      const matching = pairCells.filter(
        (cell) => board.candidates[cell] === pairMask,
      );
      if (matching.length !== 2 || matching[0] !== firstCell) continue;

      const removed: CandidateRef[] = [];
      for (const cell of unit.cells) {
        if (
          matching.includes(cell) ||
          board.values[cell] !== 0 ||
          (board.candidates[cell] & pairMask) === 0
        ) {
          continue;
        }
        for (const digit of maskToDigits(board.candidates[cell] & pairMask)) {
          removed.push({ cell, digit });
        }
      }

      if (removed.length === 0) continue;
      const digits = maskToDigits(pairMask);
      return {
        id: `naked-pair-${unit.kind}-${unit.index}-${matching.join("-")}`,
        technique: "naked-pair",
        label: "裸数对",
        weight: 30,
        action: "eliminate",
        unit: { kind: unit.kind, index: unit.index },
        digits,
        cells: matching,
        focusCells: matching,
        relatedCells: [...unit.cells],
        evidence: matching.flatMap((cell) =>
          digits.map((digit) => ({ cell, digit })),
        ),
        removed,
      };
    }
  }
  return null;
}

function findHiddenPair(board: MutableBoard): SolveStep | null {
  for (const unit of UNITS) {
    for (let first = 1; first <= 8; first += 1) {
      const firstDigit = first as Digit;
      const firstCells = unit.cells.filter(
        (cell) =>
          board.values[cell] === 0 &&
          digitInMask(board.candidates[cell], firstDigit),
      );
      if (firstCells.length !== 2) continue;

      for (let second = first + 1; second <= 9; second += 1) {
        const secondDigit = second as Digit;
        const secondCells = unit.cells.filter(
          (cell) =>
            board.values[cell] === 0 &&
            digitInMask(board.candidates[cell], secondDigit),
        );
        if (
          secondCells.length !== 2 ||
          firstCells[0] !== secondCells[0] ||
          firstCells[1] !== secondCells[1]
        ) {
          continue;
        }

        const pairMask = bit(firstDigit) | bit(secondDigit);
        const removed = firstCells.flatMap((cell) =>
          maskToDigits(board.candidates[cell] & ~pairMask).map((digit) => ({
            cell,
            digit,
          })),
        );
        if (removed.length === 0) continue;

        const digits: Digit[] = [firstDigit, secondDigit];
        return {
          id: `hidden-pair-${unit.kind}-${unit.index}-${first}-${second}`,
          technique: "hidden-pair",
          label: "隐性数对",
          weight: 40,
          action: "eliminate",
          unit: { kind: unit.kind, index: unit.index },
          digits,
          cells: firstCells,
          focusCells: firstCells,
          relatedCells: [...unit.cells],
          evidence: firstCells.flatMap((cell) =>
            digits.map((digit) => ({ cell, digit })),
          ),
          removed,
        };
      }
    }
  }
  return null;
}

function findNextStep(board: MutableBoard) {
  return (
    findNakedSingle(board) ??
    findHiddenSingle(board) ??
    findNakedPair(board) ??
    findHiddenPair(board)
  );
}

function applyStep(board: MutableBoard, step: SolveStep): MutableBoard {
  const next: MutableBoard = {
    values: [...board.values],
    candidates: [...board.candidates],
  };

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
    next.candidates[cell] &= ~bit(digit);
  }
  return next;
}

function isSolved(board: MutableBoard) {
  return board.values.every((value) => value !== 0);
}

export function solveSudoku(input: readonly number[]): SolveResult {
  let board = createBoard(input);
  const issues = validateBoard(board);
  const snapshots: BoardSnapshot[] = [snapshot(board)];
  const steps: SolveStep[] = [];

  if (issues.length > 0) {
    return { status: "invalid", snapshots, steps, issues };
  }

  for (let iteration = 0; iteration < 500; iteration += 1) {
    if (isSolved(board)) {
      return { status: "solved", snapshots, steps, issues: [] };
    }

    const nextStep = findNextStep(board);
    if (!nextStep) {
      return { status: "stuck", snapshots, steps, issues: [] };
    }

    const nextBoard = applyStep(board, nextStep);
    const changed =
      nextBoard.values.some((value, index) => value !== board.values[index]) ||
      nextBoard.candidates.some(
        (mask, index) => mask !== board.candidates[index],
      );
    if (!changed) {
      return { status: "stuck", snapshots, steps, issues: [] };
    }

    board = nextBoard;
    steps.push({ ...nextStep, id: `step-${steps.length + 1}-${nextStep.id}` });
    snapshots.push(snapshot(board));
  }

  return { status: "stuck", snapshots, steps, issues: [] };
}

