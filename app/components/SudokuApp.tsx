"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SudokuBoard } from "@/app/components/SudokuBoard";
import { StepPanel } from "@/app/components/StepPanel";
import {
  DIGITS,
  conflictCellsForValues,
  solveSudoku,
  toCellName,
  type SolveResult,
} from "@/lib/sudoku/engine";
import {
  parsePuzzle,
  SUDOKU_EXAMPLES,
} from "@/lib/sudoku/examples";

type InputMode = "value" | "candidate";

const EMPTY_VALUES = Array(81).fill(0) as number[];
const EMPTY_NOTES = Array(81).fill(0) as number[];

function firstEmpty(values: readonly number[]) {
  const index = values.findIndex((value) => value === 0);
  return index === -1 ? 0 : index;
}

export default function SudokuApp() {
  const initialValues = useMemo(
    () => parsePuzzle(SUDOKU_EXAMPLES[0].puzzle),
    [],
  );
  const [values, setValues] = useState<number[]>(initialValues);
  const [notes, setNotes] = useState<number[]>([...EMPTY_NOTES]);
  const [selectedCell, setSelectedCell] = useState<number | null>(
    firstEmpty(initialValues),
  );
  const [inputMode, setInputMode] = useState<InputMode>("value");
  const [result, setResult] = useState<SolveResult | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [sourceLabel, setSourceLabel] = useState(
    `${SUDOKU_EXAMPLES[0].name} · ${SUDOKU_EXAMPLES[0].difficulty}`,
  );

  const givens = useMemo(
    () => values.map((value) => value !== 0),
    [values],
  );
  const conflicts = useMemo(
    () => conflictCellsForValues(values),
    [values],
  );
  const displaySnapshot = result?.snapshots[stepIndex];
  const displayValues = displaySnapshot?.values ?? values;
  const displayCandidates = displaySnapshot?.candidates ?? notes;
  const currentStep =
    result && stepIndex > 0 ? result.steps[stepIndex - 1] : undefined;
  const filledCount = values.filter(Boolean).length;

  const invalidateResult = useCallback(() => {
    setResult(null);
    setStepIndex(0);
    setSourceLabel("自定义题目");
  }, []);

  const inputDigit = useCallback(
    (digit: number) => {
      if (selectedCell === null || result) return;
      if (inputMode === "value") {
        setValues((current) =>
          current.map((value, cell) => (cell === selectedCell ? digit : value)),
        );
        setNotes((current) =>
          current.map((mask, cell) => (cell === selectedCell ? 0 : mask)),
        );
      } else if (values[selectedCell] === 0) {
        const candidateBit = 1 << (digit - 1);
        setNotes((current) =>
          current.map((mask, cell) =>
            cell === selectedCell ? mask ^ candidateBit : mask,
          ),
        );
      }
      invalidateResult();
    },
    [inputMode, invalidateResult, result, selectedCell, values],
  );

  const eraseSelected = useCallback(() => {
    if (selectedCell === null || result) return;
    setValues((current) =>
      current.map((value, cell) => (cell === selectedCell ? 0 : value)),
    );
    setNotes((current) =>
      current.map((mask, cell) => (cell === selectedCell ? 0 : mask)),
    );
    invalidateResult();
  }, [invalidateResult, result, selectedCell]);

  const moveSelection = useCallback((direction: string) => {
    setSelectedCell((current) => {
      const cell = current ?? 0;
      const row = Math.floor(cell / 9);
      const column = cell % 9;
      if (direction === "ArrowUp") return Math.max(0, row - 1) * 9 + column;
      if (direction === "ArrowDown")
        return Math.min(8, row + 1) * 9 + column;
      if (direction === "ArrowLeft") return row * 9 + Math.max(0, column - 1);
      return row * 9 + Math.min(8, column + 1);
    });
  }, []);

  const changeStep = useCallback(
    (requestedStep: number) => {
      if (!result) return;
      const nextStep = Math.max(
        0,
        Math.min(result.steps.length, requestedStep),
      );
      setStepIndex(nextStep);
      const focusCell =
        nextStep > 0
          ? result.steps[nextStep - 1]?.focusCells[0]
          : firstEmpty(values);
      if (focusCell !== undefined) setSelectedCell(focusCell);
    },
    [result, values],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" &&
        (target as HTMLInputElement).type === "range"
      ) {
        return;
      }

      if (result) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          changeStep(stepIndex - 1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          changeStep(stepIndex + 1);
        } else if (event.key === "Home") {
          event.preventDefault();
          changeStep(0);
        } else if (event.key === "End") {
          event.preventDefault();
          changeStep(result.steps.length);
        }
        return;
      }

      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        inputDigit(Number(event.key));
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        eraseSelected();
      } else if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          event.key,
        )
      ) {
        event.preventDefault();
        moveSelection(event.key);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    changeStep,
    eraseSelected,
    inputDigit,
    moveSelection,
    result,
    stepIndex,
  ]);

  const loadExample = () => {
    const nextIndex = (exampleIndex + 1) % SUDOKU_EXAMPLES.length;
    const example = SUDOKU_EXAMPLES[nextIndex];
    const nextValues = parsePuzzle(example.puzzle);
    setExampleIndex(nextIndex);
    setValues(nextValues);
    setNotes([...EMPTY_NOTES]);
    setSelectedCell(firstEmpty(nextValues));
    setResult(null);
    setStepIndex(0);
    setSourceLabel(`${example.name} · ${example.difficulty}`);
  };

  const clearPuzzle = () => {
    setValues([...EMPTY_VALUES]);
    setNotes([...EMPTY_NOTES]);
    setSelectedCell(0);
    setResult(null);
    setStepIndex(0);
    setSourceLabel("空白题目");
  };

  const startSolving = () => {
    const nextResult = solveSudoku(values);
    setResult(nextResult);
    setStepIndex(nextResult.steps.length > 0 ? 1 : 0);
    if (nextResult.steps[0]?.focusCells[0] !== undefined) {
      setSelectedCell(nextResult.steps[0].focusCells[0]);
    }
  };

  const returnToEdit = () => {
    setResult(null);
    setStepIndex(0);
    setSelectedCell(firstEmpty(values));
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            9
          </span>
          <div>
            <h1>数独推演器</h1>
            <p>Human Logic Solver</p>
          </div>
        </div>
        <div className="topbar-context" aria-live="polite">
          <span>{sourceLabel}</span>
          <strong>
            已填 {filledCount} <small>/ 81</small>
          </strong>
        </div>
        <div className="header-actions">
          <button type="button" className="secondary" onClick={loadExample}>
            示例题目
            <small>
              {exampleIndex + 1}/{SUDOKU_EXAMPLES.length}
            </small>
          </button>
          <button type="button" className="ghost" onClick={clearPuzzle}>
            清空
          </button>
          <button type="button" className="solve-button" onClick={startSolving}>
            开始推演
          </button>
        </div>
      </header>

      <div className="workspace">
        <section className="board-panel" aria-label="题目录入区">
          <div className="input-toolbar">
            <div className="mode-control" aria-label="输入模式">
              <span className="toolbar-label">输入模式</span>
              <div className="segmented">
                <button
                  type="button"
                  className={inputMode === "value" ? "active" : ""}
                  onClick={() => setInputMode("value")}
                  disabled={Boolean(result)}
                >
                  填数字
                </button>
                <button
                  type="button"
                  className={inputMode === "candidate" ? "active" : ""}
                  onClick={() => setInputMode("candidate")}
                  disabled={Boolean(result)}
                >
                  候选数
                </button>
              </div>
            </div>

            <div className="number-pad" aria-label="数字键盘">
              {DIGITS.map((digit) => (
                <button
                  type="button"
                  key={digit}
                  onClick={() => inputDigit(digit)}
                  disabled={Boolean(result)}
                >
                  {digit}
                </button>
              ))}
            </div>

            {result ? (
              <button type="button" className="edit-button" onClick={returnToEdit}>
                修改题目
              </button>
            ) : (
              <button
                type="button"
                className="erase-button"
                onClick={eraseSelected}
              >
                擦除
              </button>
            )}
          </div>

          <SudokuBoard
            values={displayValues}
            candidates={displayCandidates}
            givens={givens}
            selectedCell={selectedCell}
            conflicts={conflicts}
            currentStep={currentStep}
            onSelect={setSelectedCell}
          />

          <div className="board-footer">
            <div className="legend">
              <span>
                <i className="legend-given" /> 题目
              </span>
              <span>
                <i className="legend-related" /> 相关单位
              </span>
              <span>
                <i className="legend-result" /> 本步结论
              </span>
              <span>
                <i className="legend-remove" /> 候选排除
              </span>
            </div>
            <p>
              当前单元格{" "}
              <strong>
                {selectedCell === null ? "未选择" : toCellName(selectedCell)}
              </strong>
            </p>
          </div>
        </section>

        <StepPanel
          result={result}
          stepIndex={stepIndex}
          onStepChange={changeStep}
          onFocusCell={setSelectedCell}
        />
      </div>

      <footer className="app-footer">
        <p>
          v0.1 · 当前技巧库：裸单、隐性唯一数、裸数对、隐性数对
        </p>
        <p>全程使用可解释的人类逻辑，不使用回溯或跳舞链。</p>
      </footer>
    </main>
  );
}
