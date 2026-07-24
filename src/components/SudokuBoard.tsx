import {
  DIGITS,
  digitInMask,
  type CandidateRef,
  type SolveStep,
} from "@/lib/sudoku/engine";

interface SudokuBoardProps {
  values: readonly number[];
  candidates: readonly number[];
  givens: readonly boolean[];
  selectedCell: number | null;
  conflicts: ReadonlySet<number>;
  currentStep?: SolveStep;
  onSelect: (cell: number) => void;
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
  onSelect,
}: SudokuBoardProps) {
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
  const placedCell = currentStep?.placed?.cell;

  return (
    <div className="board-frame">
      <div className="sudoku-board" role="grid" aria-label="九乘九数独盘面">
        {Array.from({ length: 81 }, (_, cell) => {
          const row = Math.floor(cell / 9);
          const column = cell % 9;
          const value = values[cell] ?? 0;
          const isSelected = selectedCell === cell;
          const cellClasses = [
            "sudoku-cell",
            column % 3 === 2 && column !== 8 ? "box-edge-right" : "",
            row % 3 === 2 && row !== 8 ? "box-edge-bottom" : "",
            isSelectionPeer(cell, selectedCell) ? "selection-peer" : "",
            relatedCells.has(cell) ? "step-related" : "",
            focusCells.has(cell) ? "step-focus" : "",
            isSelected ? "selected" : "",
            conflicts.has(cell) ? "conflict" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              type="button"
              role="gridcell"
              aria-label={`第 ${row + 1} 行第 ${column + 1} 列${
                value ? `，数字 ${value}` : "，空格"
              }`}
              aria-selected={isSelected}
              className={cellClasses}
              key={cell}
              onClick={() => onSelect(cell)}
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
                    const isVisible =
                      digitInMask(candidates[cell] ?? 0, digit) || isRemoved;
                    return (
                      <span
                        className={[
                          "candidate",
                          isVisible ? "visible" : "",
                          evidenceCandidates.has(key) ? "linked" : "",
                          isRemoved ? "removed" : "",
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
              id="chain-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" />
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
                  link.type === "implication" ? "url(#chain-arrow)" : undefined
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
