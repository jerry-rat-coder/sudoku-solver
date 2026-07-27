import assert from "node:assert/strict";
import test from "node:test";

import {
  conflictingCells,
  decodeSudokuImage,
  locateSudokuGrid,
  otsuThreshold,
  recognizeSudokuImage,
  rotateSquare,
} from "../lib/ocr/sudokuOcr.ts";

function drawLine(pixels, width, height, from, to, thickness = 1) {
  const steps = Math.max(
    Math.abs(to.x - from.x),
    Math.abs(to.y - from.y),
  );
  for (let step = 0; step <= steps; step += 1) {
    const ratio = steps === 0 ? 0 : step / steps;
    const centerX = Math.round(from.x + (to.x - from.x) * ratio);
    const centerY = Math.round(from.y + (to.y - from.y) * ratio);
    for (let dy = -thickness; dy <= thickness; dy += 1) {
      for (let dx = -thickness; dx <= thickness; dx += 1) {
        const x = centerX + dx;
        const y = centerY + dy;
        if (x >= 0 && x < width && y >= 0 && y < height) {
          pixels[y * width + x] = 18;
        }
      }
    }
  }
}

test("Otsu threshold separates dark ink from a light page", () => {
  const pixels = new Uint8ClampedArray([
    ...Array(80).fill(18),
    ...Array(20).fill(45),
    ...Array(400).fill(242),
  ]);
  const threshold = otsuThreshold(pixels);
  assert.ok(threshold >= 18);
  assert.ok(threshold < 242);
});

test("grid locator finds a connected, perspective-skewed Sudoku board", () => {
  const width = 220;
  const height = 210;
  const pixels = new Uint8ClampedArray(width * height).fill(246);
  const corners = [
    { x: 28, y: 19 },
    { x: 194, y: 30 },
    { x: 184, y: 190 },
    { x: 20, y: 180 },
  ];

  for (let line = 0; line <= 9; line += 1) {
    const ratio = line / 9;
    drawLine(
      pixels,
      width,
      height,
      {
        x: Math.round(corners[0].x + (corners[3].x - corners[0].x) * ratio),
        y: Math.round(corners[0].y + (corners[3].y - corners[0].y) * ratio),
      },
      {
        x: Math.round(corners[1].x + (corners[2].x - corners[1].x) * ratio),
        y: Math.round(corners[1].y + (corners[2].y - corners[1].y) * ratio),
      },
      line % 3 === 0 ? 2 : 1,
    );
    drawLine(
      pixels,
      width,
      height,
      {
        x: Math.round(corners[0].x + (corners[1].x - corners[0].x) * ratio),
        y: Math.round(corners[0].y + (corners[1].y - corners[0].y) * ratio),
      },
      {
        x: Math.round(corners[3].x + (corners[2].x - corners[3].x) * ratio),
        y: Math.round(corners[3].y + (corners[2].y - corners[3].y) * ratio),
      },
      line % 3 === 0 ? 2 : 1,
    );
  }

  const geometry = locateSudokuGrid(pixels, width, height);
  assert.ok(geometry.bounds.width > 150);
  assert.ok(geometry.bounds.height > 150);
  for (const [index, expected] of corners.entries()) {
    assert.ok(
      Math.hypot(
        geometry.corners[index].x - expected.x,
        geometry.corners[index].y - expected.y,
      ) < 12,
    );
  }
});

test("square image rotation preserves cell ordering", () => {
  const source = new Uint8ClampedArray([
    1, 2, 3,
    4, 5, 6,
    7, 8, 9,
  ]);
  assert.deepEqual(
    [...rotateSquare(source, 3, 1)],
    [
      7, 4, 1,
      8, 5, 2,
      9, 6, 3,
    ],
  );
  assert.deepEqual([...rotateSquare(source, 3, 4)], [...source]);
});

test("OCR review catches row, column, and box conflicts", () => {
  const values = Array(81).fill(0);
  values[0] = 5;
  values[1] = 5;
  values[9] = 5;
  const conflicts = conflictingCells(values);
  assert.deepEqual([...conflicts].sort((a, b) => a - b), [0, 1, 9]);
});

test("recognizeSudokuImage rejects immediately when signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      recognizeSudokuImage(
        { name: "board.png", type: "image/png", size: 128 },
        undefined,
        controller.signal,
      ),
    (error) =>
      error instanceof DOMException &&
      error.name === "AbortError" &&
      error.message === "识别已取消。",
  );
});

test("image decoding does not depend on createImageBitmap", async () => {
  const originals = {
    createImageBitmap: globalThis.createImageBitmap,
    document: globalThis.document,
    Image: globalThis.Image,
    window: globalThis.window,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };
  let createImageBitmapCalls = 0;
  let revokedUrl = "";

  class MockImage {
    naturalWidth = 2;
    naturalHeight = 1;
    onload = null;
    onerror = null;

    set src(_value) {
      queueMicrotask(() => this.onload?.());
    }
  }

  try {
    globalThis.createImageBitmap = () => {
      createImageBitmapCalls += 1;
      return new Promise(() => {});
    };
    globalThis.Image = MockImage;
    globalThis.window = globalThis;
    URL.createObjectURL = () => "blob:test-image";
    URL.revokeObjectURL = (url) => {
      revokedUrl = url;
    };
    globalThis.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          fillStyle: "",
          fillRect: () => {},
          drawImage: () => {},
          getImageData: () => ({
            width: 2,
            height: 1,
            data: new Uint8ClampedArray([
              255, 255, 255, 255,
              0, 0, 0, 255,
            ]),
          }),
        }),
      }),
    };

    const decoded = await Promise.race([
      decodeSudokuImage({}),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("HTML image decoding did not finish")),
          250,
        ),
      ),
    ]);

    assert.equal(createImageBitmapCalls, 0);
    assert.equal(decoded.width, 2);
    assert.equal(decoded.height, 1);
    assert.deepEqual([...decoded.grayscale], [255, 0]);
    assert.equal(revokedUrl, "blob:test-image");
  } finally {
    globalThis.createImageBitmap = originals.createImageBitmap;
    globalThis.document = originals.document;
    globalThis.Image = originals.Image;
    globalThis.window = originals.window;
    URL.createObjectURL = originals.createObjectURL;
    URL.revokeObjectURL = originals.revokeObjectURL;
  }
});
