import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  recognizeSudokuImage,
  type OcrProgress,
  type SudokuOcrResult,
} from "@/lib/ocr/sudokuOcr";
import {
  appRouteFromPath,
  type AppRoute,
} from "@/lib/app/routes";
import { OcrImportDialog } from "@/src/components/OcrImportDialog";
import { SudokuBoard } from "@/src/components/SudokuBoard";
import {
  StepPanel,
  StepPlayer,
} from "@/src/components/StepPanel";
import {
  DIGITS,
  conflictCellsForValues,
  solveSudoku,
  toCellName,
  type SolveResult,
} from "@/lib/sudoku/engine";
import {
  isKillerCageContiguous,
  killerCageBounds,
  killerConflictCellsForValues,
  solveKillerSudoku,
  updateKillerSelection,
  type KillerCage,
} from "@/lib/sudoku/killer";
import {
  KILLER_SUDOKU_EXAMPLES,
  parsePuzzle,
  SUDOKU_EXAMPLES,
} from "@/lib/sudoku/examples";

type InputMode = "value" | "candidate" | "cage";
type PuzzleMode = "classic" | "killer";

interface OcrDialogState {
  phase: "processing" | "review" | "error";
  imageUrl: string;
  fileName: string;
  progress: OcrProgress;
  result: SudokuOcrResult | null;
  error: string;
}

const EMPTY_VALUES = Array(81).fill(0) as number[];
const EMPTY_NOTES = Array(81).fill(0) as number[];
const INITIAL_OCR_PROGRESS: OcrProgress = {
  stage: "decode",
  value: 0,
  message: "准备读取图片",
};
const OCR_PROGRESS_STALL_MS = 30_000;

function firstEmpty(values: readonly number[]) {
  const index = values.findIndex((value) => value === 0);
  return index === -1 ? 0 : index;
}

function BoardFooter({
  selectedCell,
  puzzleMode,
  cageCount,
}: {
  selectedCell: number | null;
  puzzleMode: PuzzleMode;
  cageCount: number;
}) {
  return (
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
        {puzzleMode === "killer" ? (
          <span>
            <i className="legend-cage" /> 杀手笼
          </span>
        ) : null}
      </div>
      <p>
        当前单元格{" "}
        <strong>
          {selectedCell === null ? "未选择" : toCellName(selectedCell)}
        </strong>
        {puzzleMode === "killer" ? ` · ${cageCount} 个笼` : ""}
      </p>
    </div>
  );
}

export default function SudokuApp() {
  const [route, setRoute] = useState<AppRoute>(() =>
    appRouteFromPath(window.location.pathname),
  );
  const [values, setValues] = useState<number[]>(() => [...EMPTY_VALUES]);
  const [notes, setNotes] = useState<number[]>([...EMPTY_NOTES]);
  const [puzzleMode, setPuzzleMode] = useState<PuzzleMode>("classic");
  const [cages, setCages] = useState<KillerCage[]>([]);
  const [selectedCageCells, setSelectedCageCells] = useState<Set<number>>(
    () => new Set(),
  );
  const [cageSumInput, setCageSumInput] = useState("");
  const [selectedCell, setSelectedCell] = useState<number | null>(0);
  const [inputMode, setInputMode] = useState<InputMode>("value");
  const [result, setResult] = useState<SolveResult | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [exampleIndex, setExampleIndex] = useState(-1);
  const [sourceLabel, setSourceLabel] = useState("空白题目");
  const [ocrDialog, setOcrDialog] = useState<OcrDialogState | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const ocrRunRef = useRef(0);
  const ocrAbortRef = useRef<AbortController | null>(null);
  const ocrImageUrlRef = useRef<string | null>(null);

  const givens = useMemo(
    () => values.map((value) => value !== 0),
    [values],
  );
  const conflicts = useMemo(
    () =>
      puzzleMode === "killer"
        ? killerConflictCellsForValues(values, cages)
        : conflictCellsForValues(values),
    [cages, puzzleMode, values],
  );
  const displaySnapshot = result?.snapshots[stepIndex];
  const displayValues = displaySnapshot?.values ?? values;
  const displayCandidates = displaySnapshot?.candidates ?? notes;
  const currentStep =
    result && stepIndex > 0 ? result.steps[stepIndex - 1] : undefined;
  const filledCount = values.filter(Boolean).length;
  const selectedCageCellList = useMemo(
    () => [...selectedCageCells].sort((left, right) => left - right),
    [selectedCageCells],
  );
  const cageDraft = useMemo(() => {
    const bounds = killerCageBounds(selectedCageCellList.length);
    if (selectedCageCellList.length === 0) {
      return { canSave: false, bounds, message: "选择上下左右相连的格子后，填写该笼的和数。" };
    }
    if (selectedCageCellList.length < 2) {
      return { canSave: false, bounds, message: "杀手笼至少需要选中 2 格。" };
    }
    if (selectedCageCellList.length > 9) {
      return { canSave: false, bounds, message: "杀手笼最多只能包含 9 格。" };
    }
    if (!isKillerCageContiguous(selectedCageCellList)) {
      return { canSave: false, bounds, message: "选中的格子必须通过上下左右连续相连。" };
    }
    if (!cageSumInput.trim()) {
      return { canSave: false, bounds, message: `已选 ${selectedCageCellList.length} 格；允许的和数为 ${bounds!.min}–${bounds!.max}。` };
    }
    const sum = Number(cageSumInput);
    if (!Number.isInteger(sum) || sum < bounds!.min || sum > bounds!.max) {
      return { canSave: false, bounds, message: `该 ${selectedCageCellList.length} 格笼的和数必须是 ${bounds!.min}–${bounds!.max} 的整数。` };
    }
    return { canSave: true, bounds, message: `和数 ${sum} 合法；笼内数字将按标准规则不重复。`, sum };
  }, [cageSumInput, selectedCageCellList]);

  useEffect(() => {
    if (puzzleMode !== "killer" || inputMode !== "cage") return;
    const bounds = killerCageBounds(selectedCageCells.size);
    setCageSumInput(bounds ? String(bounds.min) : "");
  }, [inputMode, puzzleMode, selectedCageCells]);

  const navigateTo = useCallback(
    (nextRoute: AppRoute, replace = false) => {
      const nextPath = nextRoute === "replay" ? "/replay" : "/";
      if (window.location.pathname !== nextPath) {
        window.history[replace ? "replaceState" : "pushState"](
          null,
          "",
          nextPath,
        );
      }
      setRoute(nextRoute);
    },
    [],
  );

  useEffect(() => {
    const handlePopState = () =>
      setRoute(appRouteFromPath(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (route === "replay" && !result) {
      navigateTo("entry", true);
      return;
    }
    if (route === "entry" && result) {
      setResult(null);
      setStepIndex(0);
      setSelectedCell(firstEmpty(values));
    }
  }, [navigateTo, result, route, values]);

  useEffect(
    () => () => {
      ocrRunRef.current += 1;
      ocrAbortRef.current?.abort();
      if (ocrImageUrlRef.current) {
        URL.revokeObjectURL(ocrImageUrlRef.current);
        ocrImageUrlRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (ocrDialog?.phase !== "processing") return;

    const progressValue = ocrDialog.progress.value;
    const timer = window.setTimeout(() => {
      ocrRunRef.current += 1;
      ocrAbortRef.current?.abort();
      ocrAbortRef.current = null;
      setOcrDialog((current) =>
        current?.phase === "processing" &&
        current.progress.value === progressValue
          ? {
              ...current,
              phase: "error",
              error:
                "识别进度长时间没有推进。请重新选择图片，或稍后再试。",
            }
          : current,
      );
    }, OCR_PROGRESS_STALL_MS);

    return () => window.clearTimeout(timer);
  }, [ocrDialog?.phase, ocrDialog?.progress.value]);

  const invalidateResult = useCallback(() => {
    setResult(null);
    setStepIndex(0);
    setSourceLabel("自定义题目");
  }, []);

  const inputDigit = useCallback(
    (digit: number) => {
      if (selectedCell === null || result || inputMode === "cage") return;
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
    if (selectedCell === null || result || inputMode === "cage") return;
    setValues((current) =>
      current.map((value, cell) => (cell === selectedCell ? 0 : value)),
    );
    setNotes((current) =>
      current.map((mask, cell) => (cell === selectedCell ? 0 : mask)),
    );
    invalidateResult();
  }, [inputMode, invalidateResult, result, selectedCell]);

  const handleCageSelectStart = useCallback(
    (cell: number) => {
      if (cages.some((cage) => cage.cells.includes(cell))) return;
      setSelectedCell(cell);
      setSelectedCageCells((current) => {
        const next = updateKillerSelection(current, cell, true);
        return next.size <= 9 ? next : current;
      });
    },
    [cages],
  );

  const handleCageSelectExtend = useCallback(
    (cell: number) => {
      if (cages.some((cage) => cage.cells.includes(cell))) return;
      setSelectedCell(cell);
      setSelectedCageCells((current) => {
        const next = updateKillerSelection(current, cell, false);
        return next.size <= 9 ? next : current;
      });
    },
    [cages],
  );

  const changeInputMode = useCallback(
    (nextMode: InputMode) => {
      if (nextMode === inputMode) return;
      if (inputMode === "cage" || nextMode === "cage") {
        setSelectedCageCells(new Set());
        setCageSumInput("");
        setSelectedCell(null);
      }
      setInputMode(nextMode);
    },
    [inputMode],
  );

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
      if (ocrDialog) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "SELECT"
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
    ocrDialog,
    result,
    stepIndex,
  ]);

  const loadExample = () => {
    if (puzzleMode === "killer") {
      const nextIndex = (exampleIndex + 1) % KILLER_SUDOKU_EXAMPLES.length;
      const example = KILLER_SUDOKU_EXAMPLES[nextIndex];
      const nextValues = parsePuzzle(example.puzzle);
      setExampleIndex(nextIndex);
      setValues(nextValues);
      setNotes([...EMPTY_NOTES]);
      setCages(example.cages.map((cage) => ({ ...cage, cells: [...cage.cells] })));
      setSelectedCageCells(new Set());
      setCageSumInput("");
      setSelectedCell(firstEmpty(nextValues));
      setResult(null);
      setStepIndex(0);
      setSourceLabel(`${example.name} · ${example.difficulty}`);
      return;
    }
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
    setCages([]);
    setSelectedCageCells(new Set());
    setCageSumInput("");
    setSelectedCell(0);
    setResult(null);
    setStepIndex(0);
    setSourceLabel(puzzleMode === "killer" ? "空白杀手数独" : "空白题目");
  };

  const changePuzzleMode = (nextMode: PuzzleMode) => {
    setPuzzleMode(nextMode);
    setInputMode(nextMode === "killer" ? "cage" : "value");
    setSelectedCageCells(new Set());
    setCageSumInput("");
    setSelectedCell(nextMode === "killer" ? null : firstEmpty(values));
    setExampleIndex(-1);
    setResult(null);
    setStepIndex(0);
    setSourceLabel(
      values.some(Boolean)
        ? `自定义${nextMode === "killer" ? "杀手数独" : "经典数独"}`
        : nextMode === "killer"
          ? "空白杀手数独"
          : "空白题目",
    );
  };

  const addCage = () => {
    if (!cageDraft.canSave || cageDraft.sum === undefined) return;
    setCages((current) => [
      ...current,
      { cells: selectedCageCellList, sum: cageDraft.sum! },
    ]);
    setSelectedCageCells(new Set());
    setCageSumInput("");
    invalidateResult();
  };

  const removeCage = (index: number) => {
    setCages((current) => current.filter((_, cageIndex) => cageIndex !== index));
    invalidateResult();
  };

  const startSolving = () => {
    const hasCandidateRestrictions = notes.some((mask) => mask !== 0);
    const options = {
      candidatePolicy: hasCandidateRestrictions ? "respect" : "recompute",
      candidates: notes,
    } as const;
    const nextResult =
      puzzleMode === "killer"
        ? solveKillerSudoku(values, cages, options)
        : solveSudoku(values, options);
    const finalStep = nextResult.steps.at(-1);
    setResult(nextResult);
    setStepIndex(nextResult.steps.length);
    if (finalStep?.focusCells[0] !== undefined) {
      setSelectedCell(finalStep.focusCells[0]);
    }
    navigateTo("replay");
  };

  const returnToEdit = () => {
    setResult(null);
    setStepIndex(0);
    setSelectedCell(firstEmpty(values));
    navigateTo("entry");
  };

  const chooseOcrImage = () => imageInputRef.current?.click();

  const closeOcrDialog = useCallback(() => {
    ocrRunRef.current += 1;
    ocrAbortRef.current?.abort();
    ocrAbortRef.current = null;
    if (ocrImageUrlRef.current) {
      URL.revokeObjectURL(ocrImageUrlRef.current);
      ocrImageUrlRef.current = null;
    }
    setOcrDialog(null);
  }, []);

  const handleOcrFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const runId = ocrRunRef.current + 1;
    ocrRunRef.current = runId;
    ocrAbortRef.current?.abort();
    const abortController = new AbortController();
    ocrAbortRef.current = abortController;
    const imageUrl = URL.createObjectURL(file);
    if (ocrImageUrlRef.current) {
      URL.revokeObjectURL(ocrImageUrlRef.current);
    }
    ocrImageUrlRef.current = imageUrl;
    setOcrDialog({
      phase: "processing",
      imageUrl,
      fileName: file.name,
      progress: INITIAL_OCR_PROGRESS,
      result: null,
      error: "",
    });

    try {
      const ocrResult = await recognizeSudokuImage(
        file,
        (progress) => {
          if (ocrRunRef.current !== runId) return;
          setOcrDialog((current) =>
            current ? { ...current, progress } : current,
          );
        },
        abortController.signal,
      );
      if (ocrRunRef.current !== runId) return;
      setOcrDialog((current) =>
        current
          ? {
              ...current,
              phase: "review",
              progress: {
                stage: "validate",
                value: 1,
                message: "识别完成，请校对结果",
              },
              result: ocrResult,
              error: "",
            }
          : current,
      );
    } catch (error) {
      if (ocrRunRef.current !== runId) return;
      setOcrDialog((current) =>
        current
          ? {
              ...current,
              phase: "error",
              error:
                error instanceof Error
                  ? error.message
                  : "图片识别发生未知错误。",
            }
          : current,
      );
    }
  };

  const applyOcrValues = (recognizedValues: readonly number[]) => {
    const nextValues = Array.from({ length: 81 }, (_, cell) => {
      const value = Number(recognizedValues[cell] ?? 0);
      return Number.isInteger(value) && value >= 1 && value <= 9 ? value : 0;
    });
    setValues(nextValues);
    setNotes([...EMPTY_NOTES]);
    setSelectedCageCells(new Set());
    setSelectedCell(firstEmpty(nextValues));
    setResult(null);
    setStepIndex(0);
    setSourceLabel(
      `图片识别 · ${nextValues.filter(Boolean).length} 个已知数`,
    );
    closeOcrDialog();
  };

  return (
    <main className="app-shell">
      <header className={`topbar ${route === "replay" ? "replay-topbar" : ""}`}>
        <div className="brand-group">
          {route === "replay" ? (
            <button
              type="button"
              className="route-back"
              onClick={returnToEdit}
              aria-label="返回录题"
            >
              ←
            </button>
          ) : null}
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              9
            </span>
            <div>
              <h1>数独推演器</h1>
              <p>Human Logic Solver</p>
            </div>
          </div>
        </div>
        <div className="topbar-context" aria-live="polite">
          <span>{sourceLabel}</span>
          <strong>
            已填 {filledCount} <small>/ 81</small>
          </strong>
        </div>
        <div className="header-actions">
          {route === "entry" ? (
            <>
              <label className="puzzle-mode-select">
                <span>题型</span>
                <select
                  value={puzzleMode}
                  onChange={(event) => changePuzzleMode(event.target.value as PuzzleMode)}
                  aria-label="数独模式"
                >
                  <option value="classic">经典数独</option>
                  <option value="killer">杀手数独</option>
                </select>
              </label>
              <button type="button" className="secondary" onClick={loadExample}>
                {puzzleMode === "killer" ? "杀手示例" : "示例题目"}
                <small>
                  {exampleIndex < 0
                    ? `共 ${puzzleMode === "killer" ? KILLER_SUDOKU_EXAMPLES.length : SUDOKU_EXAMPLES.length} 题`
                    : `${exampleIndex + 1}/${puzzleMode === "killer" ? KILLER_SUDOKU_EXAMPLES.length : SUDOKU_EXAMPLES.length}`}
                </small>
              </button>
              <button type="button" className="ghost" onClick={clearPuzzle}>
                清空
              </button>
              <button
                type="button"
                className="solve-button"
                onClick={startSolving}
              >
                开始推演
              </button>
            </>
          ) : null}
        </div>
      </header>

      {route === "entry" ? (
        <div className="workspace entry-workspace">
          <section className="board-panel" aria-label="题目录入区">
            <div className="image-import-bar">
              <div>
                <span className="image-import-mark" aria-hidden="true">
                  OCR
                </span>
                <p>
                  <strong>从数独图片录题</strong>
                  <span>自动定位、矫正并识别，填入前可逐格校对</span>
                </p>
              </div>
              <button type="button" onClick={chooseOcrImage}>
                上传图片
              </button>
              <input
                ref={imageInputRef}
                className="visually-hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/*"
                onChange={handleOcrFile}
                aria-label="选择数独图片"
              />
            </div>

            <div className="input-toolbar">
              <div className="mode-control" aria-label="输入模式">
                <span className="toolbar-label">输入模式</span>
                <div className="segmented">
                  <button
                    type="button"
                    className={inputMode === "value" ? "active" : ""}
                    onClick={() => changeInputMode("value")}
                  >
                    填数字
                  </button>
                  <button
                    type="button"
                    className={inputMode === "candidate" ? "active" : ""}
                    onClick={() => changeInputMode("candidate")}
                  >
                    候选数
                  </button>
                  {puzzleMode === "killer" ? (
                    <button
                      type="button"
                      className={inputMode === "cage" ? "active" : ""}
                      onClick={() => changeInputMode("cage")}
                    >
                      画笼子
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="number-pad" aria-label="数字键盘">
                {DIGITS.map((digit) => (
                  <button
                    type="button"
                    key={digit}
                    onClick={() => inputDigit(digit)}
                    disabled={inputMode === "cage"}
                  >
                    {digit}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="erase-button"
                onClick={eraseSelected}
                disabled={inputMode === "cage"}
              >
                擦除
              </button>
            </div>

            {puzzleMode === "killer" && inputMode === "cage" ? (
              <>
                <div className="cage-editor" aria-label="杀手笼设定">
                  <div className="cage-editor-copy">
                    <h2>杀手笼设定</h2>
                    <p className={cageDraft.canSave ? "" : "invalid"}>
                      {cageDraft.message}
                    </p>
                  </div>
                  <div className="cage-editor-controls">
                    <input
                      className="cage-sum-input"
                      type="number"
                      inputMode="numeric"
                      min={cageDraft.bounds?.min}
                      max={cageDraft.bounds?.max}
                      placeholder="和数"
                      value={cageSumInput}
                      onChange={(event) => setCageSumInput(event.target.value)}
                      aria-label="杀手笼累加和"
                    />
                    <button type="button" onClick={addCage} disabled={!cageDraft.canSave}>
                      添加笼
                    </button>
                  </div>
                </div>
                {cages.length ? (
                  <div className="cage-list" aria-label="已添加的杀手笼">
                    {cages.map((cage, index) => (
                      <div className="cage-list-item" key={`${cage.sum}-${cage.cells.join("-")}`}>
                        和 {cage.sum} · {cage.cells.length} 格
                        <button
                          type="button"
                          onClick={() => removeCage(index)}
                          aria-label={`移除和为 ${cage.sum} 的杀手笼`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}

            <SudokuBoard
              values={values}
              candidates={notes}
              givens={givens}
              selectedCell={selectedCell}
              conflicts={conflicts}
              cages={puzzleMode === "killer" ? cages : []}
              cageSelection={puzzleMode === "killer" ? selectedCageCells : undefined}
              cageSelectionMode={puzzleMode === "killer" && inputMode === "cage"}
              onCageSelectStart={handleCageSelectStart}
              onCageSelectExtend={handleCageSelectExtend}
              onSelect={setSelectedCell}
            />
            <BoardFooter selectedCell={selectedCell} puzzleMode={puzzleMode} cageCount={cages.length} />
          </section>
        </div>
      ) : (
        <div className="workspace replay-workspace">
          <section
            className="board-panel replay-board-panel"
            aria-label="步骤回放盘面"
          >
            <SudokuBoard
              values={displayValues}
              candidates={displayCandidates}
              givens={givens}
              selectedCell={selectedCell}
              conflicts={conflicts}
              currentStep={currentStep}
              cages={puzzleMode === "killer" ? cages : []}
              onSelect={setSelectedCell}
            />
            <StepPlayer
              result={result}
              stepIndex={stepIndex}
              onStepChange={changeStep}
            />
            <BoardFooter selectedCell={selectedCell} puzzleMode={puzzleMode} cageCount={cages.length} />
          </section>

          <StepPanel
            result={result}
            stepIndex={stepIndex}
            onFocusCell={setSelectedCell}
          />
        </div>
      )}

      <footer className="app-footer">
        <p>
          v0.5 · 经典数独／杀手数独 · 图片 OCR 录题
        </p>
        <p>杀手笼遵循和数与不重复规则；OCR 暂不识别笼子和和数。</p>
      </footer>

      {ocrDialog ? (
        <OcrImportDialog
          phase={ocrDialog.phase}
          imageUrl={ocrDialog.imageUrl}
          fileName={ocrDialog.fileName}
          progress={ocrDialog.progress}
          result={ocrDialog.result}
          error={ocrDialog.error}
          onChooseAnother={chooseOcrImage}
          onCancel={closeOcrDialog}
          onApply={applyOcrValues}
        />
      ) : null}
    </main>
  );
}
