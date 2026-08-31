import {
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DIGITS,
  digitInMask,
  type CandidateRef,
  type SolveStep,
} from "@/lib/sudoku/engine";
import type { KillerCage } from "@/lib/sudoku/killer";

interface SudokuBoardProps {
  values: readonly number[];
  candidates: readonly number[];
  givens: readonly boolean[];
  selectedCell: number | null;
  conflicts: ReadonlySet<number>;
  currentStep?: SolveStep;
  cages?: readonly KillerCage[];
  cageSelection?: ReadonlySet<number>;
  cageSelectionMode?: boolean;
  onCageSelectStart?: (cell: number) => void;
  onCageSelectExtend?: (cell: number) => void;
  onSelect: (cell: number) => void;
}

interface PointerPoint {
  x: number;
  y: number;
}

function isSelectionPeer(cell: number, selectedCell: number | null) {
  if (selectedCell === null || cell === selectedCell) return false;
  const row = Math.floor(cell / 9);
  const column = cell % 9;
  const selectedRow = Math.floor(selectedCell / 9);
  const selectedColumn = selectedCell % 9;
  const box = Math.floor(row / 3) * 3 + Math.floor(column / 3);
  const selectedBox =
    Math.floor(selectedRow / 3) * 3 + Math.floor(selectedColumn / 3);
  return (
    row === selectedRow ||
    column === selectedColumn ||
    box === selectedBox
  );
}

function refKey(cell: number, digit: number) {
  return `${cell}-${digit}`;
}

function boxIndex(cell: number) {
  return (
    Math.floor(Math.floor(cell / 9) / 3) * 3 +
    Math.floor((cell % 9) / 3)
  );
}

function commonBox(cells: readonly number[]) {
  if (cells.length === 0) return null;
  const first = boxIndex(cells[0]);
  return cells.every((cell) => boxIndex(cell) === first) ? first : null;
}

function cageAnchor(cage: KillerCage) {
  return Math.min(...cage.cells);
}

function cageEdgeClasses(cage: KillerCage, cell: number) {
  const cells = new Set(cage.cells);
  const row = Math.floor(cell / 9);
  const column = cell % 9;
  return [
    !cells.has(cell - 9) || row === 0 ? "cage-edge-top" : "",
    !cells.has(cell + 9) || row === 8 ? "cage-edge-bottom" : "",
    !cells.has(cell - 1) || column === 0 ? "cage-edge-left" : "",
    !cells.has(cell + 1) || column === 8 ? "cage-edge-right" : "",
  ];
}

function candidatePoint({ cell, digit }: CandidateRef) {
  const cellRow = Math.floor(cell / 9);
  const cellColumn = cell % 9;
  const candidateRow = Math.floor((digit - 1) / 3);
  const candidateColumn = (digit - 1) % 3;
  return {
    x: cellColumn * 100 + (candidateColumn + 0.5) * (100 / 3),
    y: cellRow * 100 + (candidateRow + 0.5) * (100 / 3),
  };
}

export function SudokuBoard({
  values,
  candidates,
  givens,
  selectedCell,
  conflicts,
  currentStep,
  cages = [],
  cageSelection = new Set(),
  cageSelectionMode = false,
  onCageSelectStart,
  onCageSelectExtend,
  onSelect,
}: SudokuBoardProps) {
  const activePointerRef = useRef<number | null>(null);
  const lastPointerPointRef = useRef<PointerPoint | null>(null);
  const lastDragCellRef = useRef<number | null>(null);
  const focusCells = new Set(currentStep?.focusCells ?? []);
  const relatedCells = new Set(currentStep?.relatedCells ?? []);
  const removedCandidates = new Set(
    (currentStep?.removed ?? []).map(({ cell, digit }) => refKey(cell, digit)),
  );
  const evidenceCandidates = new Set(
    (currentStep?.evidence ?? []).map(({ cell, digit }) =>
      refKey(cell, digit),
    ),
  );
  const proofCandidates = new Map<
    string,
    "origin" | "true" | "false" | "conflict"
  >();
  for (const literal of currentStep?.proof?.literals ?? []) {
    const key = refKey(
      literal.candidate.cell,
      literal.candidate.digit,
    );
    const role =
      literal.role === "conflict"
        ? "conflict"
        : literal.role === "origin"
          ? "origin"
          : literal.state;
    const existing = proofCandidates.get(key);
    if (
      !existing ||
      role === "conflict" ||
      (role === "origin" && existing !== "conflict")
    ) {
      proofCandidates.set(key, role);
    }
  }
  const removedBox = commonBox(
    (currentStep?.removed ?? []).map(({ cell }) => cell),
  );
  const conflictBox =
    currentStep?.proof?.conflict?.unit?.kind === "box"
      ? currentStep.proof.conflict.unit.index
      : null;
  const placedCell = currentStep?.placed?.cell;
  const cagesByCell = new Map<number, KillerCage>();
  for (const cage of cages) {
    for (const cell of cage.cells) cagesByCell.set(cell, cage);
  }

  const cellAtPoint = (
    element: HTMLDivElement,
    clientX: number,
    clientY: number,
  ) => {
    const rect = element.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX >= rect.right ||
      clientY < rect.top ||
      clientY >= rect.bottom
    ) {
      return null;
    }
    const column = Math.min(
      8,
      Math.floor(((clientX - rect.left) / rect.width) * 9),
    );
    const row = Math.min(
      8,
      Math.floor(((clientY - rect.top) / rect.height) * 9),
    );
    return row * 9 + column;
  };

  const finishCageDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    lastPointerPointRef.current = null;
    lastDragCellRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const startCageDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      !cageSelectionMode ||
      !event.isPrimary ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }
    const cell = cellAtPoint(
      event.currentTarget,
      event.clientX,
      event.clientY,
    );
    if (cell === null) return;
    event.preventDefault();
    activePointerRef.current = event.pointerId;
    lastPointerPointRef.current = { x: event.clientX, y: event.clientY };
    lastDragCellRef.current = cell;
    event.currentTarget.setPointerCapture(event.pointerId);
    onCageSelectStart?.(cell);
  };

  const extendCageDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      !cageSelectionMode ||
      activePointerRef.current !== event.pointerId ||
      !lastPointerPointRef.current
    ) {
      return;
    }
    event.preventDefault();
    const previous = lastPointerPointRef.current;
    const rect = event.currentTarget.getBoundingClientRect();
    const distance = Math.hypot(
      event.clientX - previous.x,
      event.clientY - previous.y,
    );
    const sampleSize = Math.max(3, Math.min(rect.width, rect.height) / 27);
    const sampleCount = Math.max(1, Math.ceil(distance / sampleSize));
    for (let sample = 1; sample <= sampleCount; sample += 1) {
      const progress = sample / sampleCount;
      const cell = cellAtPoint(
        event.currentTarget,
        previous.x + (event.clientX - previous.x) * progress,
        previous.y + (event.clientY - previous.y) * progress,
      );
      if (cell !== null && cell !== lastDragCellRef.current) {
        lastDragCellRef.current = cell;
        onCageSelectExtend?.(cell);
      }
    }
    lastPointerPointRef.current = { x: event.clientX, y: event.clientY };
  };

  return (
    <div className="board-frame">
      <div
        className={`sudoku-board ${cageSelectionMode ? "cage-drawing" : ""}`}
        role="grid"
        aria-label="九乘九数独盘面"
        onPointerDown={startCageDrag}
        onPointerMove={extendCageDrag}
        onPointerUp={finishCageDrag}
        onPointerCancel={finishCageDrag}
        onLostPointerCapture={finishCageDrag}
      >
        {Array.from({ length: 81 }, (_, cell) => {
          const row = Math.floor(cell / 9);
          const column = cell % 9;
          const value = values[cell] ?? 0;
          const isSelected = selectedCell === cell;
          const cage = cagesByCell.get(cell);
          const isCageAnchor = cage ? cageAnchor(cage) === cell : false;
          const cellClasses = [
            "sudoku-cell",
            column % 3 === 2 && column !== 8 ? "box-edge-right" : "",
            row % 3 === 2 && row !== 8 ? "box-edge-bottom" : "",
            isSelectionPeer(cell, selectedCell) ? "selection-peer" : "",
            relatedCells.has(cell) ? "step-related" : "",
            removedBox === boxIndex(cell) ? "step-box-context" : "",
            conflictBox === boxIndex(cell) ? "step-box-conflict" : "",
            focusCells.has(cell) ? "step-focus" : "",
            isSelected ? "selected" : "",
            conflicts.has(cell) ? "conflict" : "",
            cage ? "killer-cage" : "",
            ...(cage ? cageEdgeClasses(cage, cell) : []),
            cageSelection.has(cell) ? "cage-selection" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              type="button"
              role="gridcell"
              aria-label={`第 ${row + 1} 行第 ${column + 1} 列${
                value ? `，数字 ${value}` : "，空格"
              }${cage ? `，杀手笼和为 ${cage.sum}` : ""}`}
              aria-selected={isSelected || cageSelection.has(cell)}
              className={cellClasses}
              key={cell}
              onClick={(event) => {
                if (cageSelectionMode) {
                  if (event.detail === 0) onCageSelectStart?.(cell);
                  return;
                }
                onSelect(cell);
              }}
              tabIndex={isSelected || (selectedCell === null && cell === 0) ? 0 : -1}
            >
              {value ? (
                <span
                  className={[
                    "cell-value",
                    givens[cell] ? "given" : "derived",
                    placedCell === cell ? "just-placed" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {value}
                </span>
              ) : (
                <span className="candidate-grid" aria-hidden="true">
                  {DIGITS.map((digit) => {
                    const key = refKey(cell, digit);
                    const isRemoved = removedCandidates.has(key);
                    const proofState = proofCandidates.get(key);
                    const isVisible =
                      digitInMask(candidates[cell] ?? 0, digit) || isRemoved;
                    return (
                      <span
                        className={[
                          "candidate",
                          isVisible ? "visible" : "",
                          evidenceCandidates.has(key) && !proofState
                            ? "linked"
                            : "",
                          isRemoved ? "removed" : "",
                          proofState ? `proof-${proofState}` : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        data-candidate-id={`r${row + 1}c${column + 1}-${digit}`}
                        key={digit}
                      >
                        {digit}
                      </span>
                    );
                  })}
                </span>
              )}
              {isCageAnchor ? (
                <span className="cage-sum" aria-hidden="true">
                  {cage!.sum}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {currentStep?.links.length ? (
        <svg
          className="chain-overlay"
          viewBox="0 0 900 900"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="chain-arrow-strong"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path className="arrow-strong" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
            <marker
              id="chain-arrow-weak"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path className="arrow-weak" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
            <marker
              id="chain-arrow-implication"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path
                className="arrow-implication"
                d="M 0 0 L 10 5 L 0 10 z"
              />
            </marker>
          </defs>
          {currentStep.links.map((link, index) => {
            const from = candidatePoint(link.from);
            const to = candidatePoint(link.to);
            return (
              <line
                className={`chain-link ${link.type}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                markerEnd={
                  currentStep.proof
                    ? `url(#chain-arrow-${link.type})`
                    : undefined
                }
                key={`${link.type}-${link.from.cell}-${link.from.digit}-${link.to.cell}-${link.to.digit}-${index}`}
              />
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}
