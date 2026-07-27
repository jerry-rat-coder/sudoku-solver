import { useEffect, useMemo, useState } from "react";
import {
  conflictingCells,
  type OcrProgress,
  type SudokuOcrResult,
} from "@/lib/ocr/sudokuOcr";

interface OcrImportDialogProps {
  phase: "processing" | "review" | "error";
  imageUrl: string;
  fileName: string;
  progress: OcrProgress;
  result: SudokuOcrResult | null;
  error: string;
  onChooseAnother: () => void;
  onCancel: () => void;
  onApply: (values: readonly number[]) => void;
}

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export function OcrImportDialog({
  phase,
  imageUrl,
  fileName,
  progress,
  result,
  error,
  onChooseAnother,
  onCancel,
  onApply,
}: OcrImportDialogProps) {
  const [values, setValues] = useState<number[]>([]);
  const [selectedCell, setSelectedCell] = useState(0);

  useEffect(() => {
    if (!result) return;
    setValues([...result.values]);
    const firstLowConfidence = result.confidences.findIndex(
      (confidence, cell) =>
        result.values[cell] !== 0 && confidence < 0.68,
    );
    setSelectedCell(firstLowConfidence >= 0 ? firstLowConfidence : 0);
  }, [result]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (phase !== "review") return;
      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        const digit = Number(event.key);
        setValues((current) =>
          current.map((value, cell) =>
            cell === selectedCell ? digit : value,
          ),
        );
      } else if (
        event.key === "Backspace" ||
        event.key === "Delete" ||
        event.key === "0"
      ) {
        event.preventDefault();
        setValues((current) =>
          current.map((value, cell) => (cell === selectedCell ? 0 : value)),
        );
      } else if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        const row = Math.floor(selectedCell / 9);
        const column = selectedCell % 9;
        if (event.key === "ArrowUp") {
          setSelectedCell(Math.max(0, row - 1) * 9 + column);
        } else if (event.key === "ArrowDown") {
          setSelectedCell(Math.min(8, row + 1) * 9 + column);
        } else if (event.key === "ArrowLeft") {
          setSelectedCell(row * 9 + Math.max(0, column - 1));
        } else {
          setSelectedCell(row * 9 + Math.min(8, column + 1));
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, phase, selectedCell]);

  const conflicts = useMemo(() => conflictingCells(values), [values]);
  const clueCount = values.filter(Boolean).length;
  const lowConfidence = useMemo(
    () =>
      new Set(
        result
          ? result.confidences.flatMap((confidence, cell) =>
              result.values[cell] !== 0 && confidence < 0.68 ? [cell] : [],
            )
          : [],
      ),
    [result],
  );
  const canApply = clueCount >= 8 && conflicts.size === 0;

  const setDigit = (digit: number) => {
    setValues((current) =>
      current.map((value, cell) =>
        cell === selectedCell ? digit : value,
      ),
    );
  };

  return (
    <div className="ocr-backdrop" role="presentation">
      <section
        className="ocr-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ocr-dialog-title"
      >
        <header className="ocr-dialog-header">
          <div>
            <p className="eyebrow">LOCAL IMAGE RECOGNITION</p>
            <h2 id="ocr-dialog-title">
              {phase === "processing"
                ? "正在识别数独图片"
                : phase === "error"
                  ? "暂时无法识别"
                  : "校对识别结果"}
            </h2>
            <p>{fileName}</p>
          </div>
          <button
            type="button"
            className="ocr-close"
            onClick={onCancel}
            aria-label="关闭图片识别"
          >
            ×
          </button>
        </header>

        {phase === "processing" ? (
          <div className="ocr-processing">
            <div className="ocr-image-card">
              <img src={imageUrl} alt="待识别的数独图片" />
              <span className="ocr-scan-line" aria-hidden="true" />
            </div>
            <div className="ocr-progress-copy" aria-live="polite">
              <span className="ocr-progress-number">
                {Math.round(progress.value * 100)}
                <small>%</small>
              </span>
              <h3>{progress.message}</h3>
              <p>
                图片仅在当前浏览器中处理，不会上传。复杂照片可能需要十几秒。
              </p>
              <div className="ocr-progress-track" aria-hidden="true">
                <span style={{ width: `${progress.value * 100}%` }} />
              </div>
            </div>
          </div>
        ) : phase === "error" ? (
          <div className="ocr-error">
            <div className="ocr-image-card">
              <img src={imageUrl} alt="未能识别的数独图片" />
            </div>
            <div>
              <span className="ocr-error-code">OCR / RETRY</span>
              <h3>{error}</h3>
              <p>
                建议让完整九宫格占据画面主体，避免强反光、遮挡和过度倾斜。
              </p>
              <div className="ocr-dialog-actions">
                <button type="button" onClick={onCancel}>
                  取消
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={onChooseAnother}
                >
                  重新选择图片
                </button>
              </div>
            </div>
          </div>
        ) : result ? (
          <>
            <div className="ocr-review">
              <div className="ocr-reference">
                <div className="ocr-reference-tabs">
                  <span>原图</span>
                  <span>已矫正 · {result.rotation}°</span>
                </div>
                <div className="ocr-reference-images">
                  <img src={imageUrl} alt="上传的数独原图" />
                  <img src={result.gridPreviewUrl} alt="透视矫正后的数独网格" />
                </div>
                <p>
                  已识别 <strong>{clueCount}</strong> 个数字
                  {result.lowConfidenceCount > 0 ? (
                    <>
                      ，其中 <strong>{result.lowConfidenceCount}</strong>{" "}
                      格建议重点检查
                    </>
                  ) : null}
                  。
                </p>
              </div>

              <div className="ocr-editor">
                <div className="ocr-mini-grid" aria-label="OCR 识别结果">
                  {Array.from({ length: 81 }, (_, cell) => {
                    const row = Math.floor(cell / 9);
                    const column = cell % 9;
                    const classes = [
                      "ocr-mini-cell",
                      column % 3 === 2 && column !== 8 ? "box-right" : "",
                      row % 3 === 2 && row !== 8 ? "box-bottom" : "",
                      selectedCell === cell ? "selected" : "",
                      lowConfidence.has(cell) &&
                      values[cell] !== 0 &&
                      result.values[cell] === values[cell]
                        ? "low-confidence"
                        : "",
                      conflicts.has(cell) ? "conflict" : "",
                      result.values[cell] !== values[cell] ? "corrected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <button
                        type="button"
                        className={classes}
                        aria-label={`第 ${row + 1} 行第 ${column + 1} 列，${
                          values[cell] || "空"
                        }`}
                        aria-pressed={selectedCell === cell}
                        onClick={() => setSelectedCell(cell)}
                        key={cell}
                      >
                        {values[cell] || ""}
                        {lowConfidence.has(cell) && values[cell] !== 0 ? (
                          <i aria-label="低置信度" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                <div className="ocr-keypad" aria-label="校对数字键盘">
                  {DIGITS.map((digit) => (
                    <button
                      type="button"
                      onClick={() => setDigit(digit)}
                      key={digit}
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="clear"
                    onClick={() => setDigit(0)}
                  >
                    清空
                  </button>
                </div>
                <div className="ocr-review-status" aria-live="polite">
                  {conflicts.size > 0 ? (
                    <p className="invalid">
                      有 {conflicts.size} 个红色冲突格，请校正后再填入题盘。
                    </p>
                  ) : (
                    <p>行、列和九宫格暂未发现重复数字。</p>
                  )}
                  <span>
                    黄色角标表示低置信度；绿色边框表示你已手动修改。
                  </span>
                </div>
              </div>
            </div>

            <footer className="ocr-dialog-footer">
              <button type="button" onClick={onChooseAnother}>
                更换图片
              </button>
              <div>
                <button type="button" onClick={onCancel}>
                  取消
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!canApply}
                  onClick={() => onApply(values)}
                >
                  填入题盘
                </button>
              </div>
            </footer>
          </>
        ) : null}
      </section>
    </div>
  );
}
