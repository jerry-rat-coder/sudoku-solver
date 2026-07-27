export type OcrStage =
  | "decode"
  | "locate"
  | "recognize"
  | "validate";

export interface OcrProgress {
  stage: OcrStage;
  value: number;
  message: string;
}

export interface SudokuOcrResult {
  values: number[];
  confidences: number[];
  clueCount: number;
  lowConfidenceCount: number;
  rotation: 0 | 90 | 180 | 270;
  gridPreviewUrl: string;
}

interface Point {
  x: number;
  y: number;
}

interface GridGeometry {
  corners: readonly [Point, Point, Point, Point];
  bounds: { x: number; y: number; width: number; height: number };
  score: number;
}

interface Component {
  pixels: number[];
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

interface DigitTemplate {
  digit: number;
  pixels: Uint8Array;
  dilated: Uint8Array;
  ink: number;
}

interface OrientationResult {
  values: number[];
  confidences: number[];
  grayscale: Uint8ClampedArray;
  rotation: 0 | 90 | 180 | 270;
  score: number;
}

const GRID_SIZE = 900;
const TEMPLATE_SIZE = 28;
const MAX_SOURCE_DIMENSION = 1400;
const LOW_CONFIDENCE = 0.68;
let cachedTemplates: DigitTemplate[] | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function report(
  onProgress: ((progress: OcrProgress) => void) | undefined,
  stage: OcrStage,
  value: number,
  message: string,
) {
  onProgress?.({ stage, value, message });
}

function grayscaleFromImageData(imageData: ImageData) {
  const result = new Uint8ClampedArray(imageData.width * imageData.height);
  for (let source = 0, target = 0; source < imageData.data.length; source += 4) {
    result[target] = Math.round(
      imageData.data[source] * 0.299 +
        imageData.data[source + 1] * 0.587 +
        imageData.data[source + 2] * 0.114,
    );
    target += 1;
  }
  return result;
}

export function otsuThreshold(values: ArrayLike<number>) {
  const histogram = new Uint32Array(256);
  let total = 0;
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = clamp(Math.round(values[index]), 0, 255);
    histogram[value] += 1;
    total += 1;
    sum += value;
  }

  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let bestThreshold = 128;
  for (let threshold = 0; threshold < 256; threshold += 1) {
    backgroundWeight += histogram[threshold];
    if (backgroundWeight === 0) continue;
    const foregroundWeight = total - backgroundWeight;
    if (foregroundWeight === 0) break;
    backgroundSum += threshold * histogram[threshold];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance =
      backgroundWeight *
      foregroundWeight *
      (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = threshold;
    }
  }
  return bestThreshold;
}

function binaryFromGrayscale(grayscale: ArrayLike<number>) {
  const threshold = clamp(otsuThreshold(grayscale) + 8, 65, 215);
  const binary = new Uint8Array(grayscale.length);
  for (let index = 0; index < grayscale.length; index += 1) {
    binary[index] = grayscale[index] < threshold ? 1 : 0;
  }
  return binary;
}

function pointDistance(left: Point, right: Point) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function componentGeometry(component: Component, width: number, height: number) {
  const boxWidth = component.maxX - component.minX + 1;
  const boxHeight = component.maxY - component.minY + 1;
  const shorter = Math.min(boxWidth, boxHeight);
  const longer = Math.max(boxWidth, boxHeight);
  const coverage = shorter / Math.min(width, height);
  const squareness = shorter / Math.max(1, longer);
  const density = component.area / Math.max(1, boxWidth * boxHeight);
  const edgeBalance =
    Math.min(
      pointDistance(component.topLeft, component.topRight),
      pointDistance(component.bottomLeft, component.bottomRight),
      pointDistance(component.topLeft, component.bottomLeft),
      pointDistance(component.topRight, component.bottomRight),
    ) / Math.max(1, longer);
  return {
    coverage,
    squareness,
    density,
    edgeBalance,
    score:
      component.area *
      coverage *
      squareness *
      clamp(edgeBalance, 0.2, 1) *
      (density > 0.5 ? 0.15 : 1),
  };
}

function findComponents(binary: Uint8Array, width: number, height: number) {
  const visited = new Uint8Array(binary.length);
  const stack = new Int32Array(binary.length);
  const components: Component[] = [];
  const directions = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ] as const;

  for (let start = 0; start < binary.length; start += 1) {
    if (!binary[start] || visited[start]) continue;
    let stackSize = 1;
    stack[0] = start;
    visited[start] = 1;
    const pixels: number[] = [];
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let minSum = Number.POSITIVE_INFINITY;
    let maxSum = Number.NEGATIVE_INFINITY;
    let maxDifference = Number.NEGATIVE_INFINITY;
    let minDifference = Number.POSITIVE_INFINITY;
    let topLeft = { x: 0, y: 0 };
    let topRight = { x: 0, y: 0 };
    let bottomRight = { x: 0, y: 0 };
    let bottomLeft = { x: 0, y: 0 };

    while (stackSize > 0) {
      const pixel = stack[--stackSize];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      pixels.push(pixel);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const sum = x + y;
      const difference = x - y;
      if (sum < minSum) {
        minSum = sum;
        topLeft = { x, y };
      }
      if (sum > maxSum) {
        maxSum = sum;
        bottomRight = { x, y };
      }
      if (difference > maxDifference) {
        maxDifference = difference;
        topRight = { x, y };
      }
      if (difference < minDifference) {
        minDifference = difference;
        bottomLeft = { x, y };
      }

      for (const [dx, dy] of directions) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (
          nextX < 0 ||
          nextX >= width ||
          nextY < 0 ||
          nextY >= height
        ) {
          continue;
        }
        const next = nextY * width + nextX;
        if (binary[next] && !visited[next]) {
          visited[next] = 1;
          stack[stackSize++] = next;
        }
      }
    }

    if (pixels.length >= 8) {
      components.push({
        pixels,
        area: pixels.length,
        minX,
        minY,
        maxX,
        maxY,
        topLeft,
        topRight,
        bottomRight,
        bottomLeft,
      });
    }
  }
  return components;
}

function geometryFromComponent(
  component: Component,
  width: number,
  height: number,
): GridGeometry {
  const metrics = componentGeometry(component, width, height);
  const boxCorners: [Point, Point, Point, Point] = [
    { x: component.minX, y: component.minY },
    { x: component.maxX, y: component.minY },
    { x: component.maxX, y: component.maxY },
    { x: component.minX, y: component.maxY },
  ];
  const detectedCorners: [Point, Point, Point, Point] = [
    component.topLeft,
    component.topRight,
    component.bottomRight,
    component.bottomLeft,
  ];
  const cornerEdges = [
    pointDistance(detectedCorners[0], detectedCorners[1]),
    pointDistance(detectedCorners[1], detectedCorners[2]),
    pointDistance(detectedCorners[2], detectedCorners[3]),
    pointDistance(detectedCorners[3], detectedCorners[0]),
  ];
  const useDetectedCorners =
    Math.min(...cornerEdges) >
    Math.min(
      component.maxX - component.minX,
      component.maxY - component.minY,
    ) *
      0.45;
  return {
    corners: useDetectedCorners ? detectedCorners : boxCorners,
    bounds: {
      x: component.minX,
      y: component.minY,
      width: component.maxX - component.minX + 1,
      height: component.maxY - component.minY + 1,
    },
    score: metrics.score,
  };
}

export function locateSudokuGrid(
  grayscale: Uint8ClampedArray,
  width: number,
  height: number,
): GridGeometry {
  const binary = binaryFromGrayscale(grayscale);
  const components = findComponents(binary, width, height);
  const candidates = components
    .map((component) => ({
      component,
      metrics: componentGeometry(component, width, height),
    }))
    .filter(
      ({ metrics }) =>
        metrics.coverage >= 0.28 &&
        metrics.squareness >= 0.48 &&
        metrics.edgeBalance >= 0.22,
    )
    .sort((left, right) => right.metrics.score - left.metrics.score);

  if (candidates.length > 0) {
    return geometryFromComponent(candidates[0].component, width, height);
  }

  const darkPixels: number[] = [];
  for (let index = 0; index < binary.length; index += 1) {
    if (binary[index]) darkPixels.push(index);
  }
  if (darkPixels.length < width * height * 0.003) {
    throw new Error("图片中没有检测到清晰的数独网格。");
  }
  const xs = darkPixels.map((pixel) => pixel % width).sort((a, b) => a - b);
  const ys = darkPixels
    .map((pixel) => Math.floor(pixel / width))
    .sort((a, b) => a - b);
  const trim = Math.floor(darkPixels.length * 0.015);
  const minX = xs[trim];
  const maxX = xs[xs.length - trim - 1];
  const minY = ys[trim];
  const maxY = ys[ys.length - trim - 1];
  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;
  if (
    Math.min(boxWidth, boxHeight) < Math.min(width, height) * 0.25 ||
    Math.min(boxWidth, boxHeight) / Math.max(boxWidth, boxHeight) < 0.5
  ) {
    throw new Error("未能定位完整的九宫格，请上传边界清楚的正面图片。");
  }
  return {
    corners: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
    bounds: { x: minX, y: minY, width: boxWidth, height: boxHeight },
    score: 0,
  };
}

function solveLinearSystem(matrix: number[][], values: number[]) {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (
        Math.abs(augmented[row][column]) >
        Math.abs(augmented[pivot][column])
      ) {
        pivot = row;
      }
    }
    [augmented[column], augmented[pivot]] = [
      augmented[pivot],
      augmented[column],
    ];
    const divisor = augmented[column][column];
    if (Math.abs(divisor) < 1e-8) throw new Error("网格透视参数不稳定。");
    for (let entry = column; entry <= size; entry += 1) {
      augmented[column][entry] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let entry = column; entry <= size; entry += 1) {
        augmented[row][entry] -= factor * augmented[column][entry];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

function homographyFromSquare(corners: readonly Point[], size: number) {
  const destinations = [
    { x: 0, y: 0 },
    { x: size - 1, y: 0 },
    { x: size - 1, y: size - 1 },
    { x: 0, y: size - 1 },
  ];
  const matrix: number[][] = [];
  const values: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const destination = destinations[index];
    const source = corners[index];
    matrix.push([
      destination.x,
      destination.y,
      1,
      0,
      0,
      0,
      -destination.x * source.x,
      -destination.y * source.x,
    ]);
    values.push(source.x);
    matrix.push([
      0,
      0,
      0,
      destination.x,
      destination.y,
      1,
      -destination.x * source.y,
      -destination.y * source.y,
    ]);
    values.push(source.y);
  }
  return solveLinearSystem(matrix, values);
}

function bilinearSample(
  grayscale: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  const left = clamp(Math.floor(x), 0, width - 1);
  const top = clamp(Math.floor(y), 0, height - 1);
  const right = Math.min(width - 1, left + 1);
  const bottom = Math.min(height - 1, top + 1);
  const xMix = clamp(x - left, 0, 1);
  const yMix = clamp(y - top, 0, 1);
  const topValue =
    grayscale[top * width + left] * (1 - xMix) +
    grayscale[top * width + right] * xMix;
  const bottomValue =
    grayscale[bottom * width + left] * (1 - xMix) +
    grayscale[bottom * width + right] * xMix;
  return Math.round(topValue * (1 - yMix) + bottomValue * yMix);
}

function warpGrid(
  grayscale: Uint8ClampedArray,
  width: number,
  height: number,
  corners: readonly Point[],
) {
  const homography = homographyFromSquare(corners, GRID_SIZE);
  const output = new Uint8ClampedArray(GRID_SIZE * GRID_SIZE);
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const denominator =
        homography[6] * x + homography[7] * y + 1;
      const sourceX =
        (homography[0] * x + homography[1] * y + homography[2]) /
        denominator;
      const sourceY =
        (homography[3] * x + homography[4] * y + homography[5]) /
        denominator;
      output[y * GRID_SIZE + x] = bilinearSample(
        grayscale,
        width,
        height,
        sourceX,
        sourceY,
      );
    }
  }
  return output;
}

export function rotateSquare(
  source: Uint8ClampedArray,
  size: number,
  quarterTurns: number,
) {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return new Uint8ClampedArray(source);
  let current = new Uint8ClampedArray(source);
  for (let turn = 0; turn < turns; turn += 1) {
    const rotated = new Uint8ClampedArray(current.length);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        rotated[x * size + (size - y - 1)] = current[y * size + x];
      }
    }
    current = rotated;
  }
  return current;
}

function normalizeShape(
  source: Uint8Array,
  width: number,
  height: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
) {
  const result = new Uint8Array(TEMPLATE_SIZE * TEMPLATE_SIZE);
  const sourceWidth = bounds.maxX - bounds.minX + 1;
  const sourceHeight = bounds.maxY - bounds.minY + 1;
  const scale = Math.min(22 / sourceWidth, 24 / sourceHeight);
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const offsetX = Math.floor((TEMPLATE_SIZE - targetWidth) / 2);
  const offsetY = Math.floor((TEMPLATE_SIZE - targetHeight) / 2);
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX = clamp(
        bounds.minX + Math.floor(targetX / scale),
        0,
        width - 1,
      );
      const sourceY = clamp(
        bounds.minY + Math.floor(targetY / scale),
        0,
        height - 1,
      );
      result[(offsetY + targetY) * TEMPLATE_SIZE + offsetX + targetX] =
        source[sourceY * width + sourceX];
    }
  }
  return result;
}

function boundsForBinary(binary: Uint8Array, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!binary[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX >= minX ? { minX, minY, maxX, maxY } : null;
}

function dilateShape(source: Uint8Array) {
  const output = new Uint8Array(source.length);
  for (let y = 0; y < TEMPLATE_SIZE; y += 1) {
    for (let x = 0; x < TEMPLATE_SIZE; x += 1) {
      if (!source[y * TEMPLATE_SIZE + x]) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const targetX = x + dx;
          const targetY = y + dy;
          if (
            targetX >= 0 &&
            targetX < TEMPLATE_SIZE &&
            targetY >= 0 &&
            targetY < TEMPLATE_SIZE
          ) {
            output[targetY * TEMPLATE_SIZE + targetX] = 1;
          }
        }
      }
    }
  }
  return output;
}

function renderTemplates() {
  if (cachedTemplates) return cachedTemplates;
  const fonts = [
    "Arial",
    "Helvetica",
    "Verdana",
    "Tahoma",
    "Trebuchet MS",
    "Times New Roman",
    "Georgia",
    "Courier New",
    "system-ui",
    "serif",
    "sans-serif",
  ];
  const weights = [400, 700];
  const sizes = [40, 46];
  const templates: DigitTemplate[] = [];
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器无法初始化图像识别画布。");

  for (let digit = 1; digit <= 9; digit += 1) {
    for (const font of fonts) {
      for (const weight of weights) {
        for (const size of sizes) {
          context.fillStyle = "#fff";
          context.fillRect(0, 0, 64, 64);
          context.fillStyle = "#000";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.font = `${weight} ${size}px ${font}`;
          context.fillText(String(digit), 32, 34);
          const grayscale = grayscaleFromImageData(
            context.getImageData(0, 0, 64, 64),
          );
          const binary = new Uint8Array(
            [...grayscale].map((value) => (value < 185 ? 1 : 0)),
          );
          const bounds = boundsForBinary(binary, 64, 64);
          if (!bounds) continue;
          const pixels = normalizeShape(binary, 64, 64, bounds);
          templates.push({
            digit,
            pixels,
            dilated: dilateShape(pixels),
            ink: pixels.reduce((sum, value) => sum + value, 0),
          });
        }
      }
    }
  }
  cachedTemplates = templates;
  return templates;
}

function shiftedSimilarity(
  sample: Uint8Array,
  sampleDilated: Uint8Array,
  sampleInk: number,
  template: Uint8Array,
  templateDilated: Uint8Array,
  templateInk: number,
  shiftX: number,
  shiftY: number,
) {
  let intersection = 0;
  let sampleCovered = 0;
  let templateCovered = 0;

  for (let y = 0; y < TEMPLATE_SIZE; y += 1) {
    for (let x = 0; x < TEMPLATE_SIZE; x += 1) {
      const sampleValue = sample[y * TEMPLATE_SIZE + x];
      const templateX = x - shiftX;
      const templateY = y - shiftY;
      const templateValue =
        templateX >= 0 &&
        templateX < TEMPLATE_SIZE &&
        templateY >= 0 &&
        templateY < TEMPLATE_SIZE
          ? template[templateY * TEMPLATE_SIZE + templateX]
          : 0;
      if (sampleValue) {
        if (templateValue) intersection += 1;
        if (
          templateX >= 0 &&
          templateX < TEMPLATE_SIZE &&
          templateY >= 0 &&
          templateY < TEMPLATE_SIZE &&
          templateDilated[templateY * TEMPLATE_SIZE + templateX]
        ) {
          sampleCovered += 1;
        }
      }
      if (templateValue) {
        if (sampleDilated[y * TEMPLATE_SIZE + x]) templateCovered += 1;
      }
    }
  }
  const dice = (2 * intersection) / Math.max(1, sampleInk + templateInk);
  const coverage =
    (sampleCovered / Math.max(1, sampleInk) +
      templateCovered / Math.max(1, templateInk)) /
    2;
  const inkBalance =
    Math.min(sampleInk, templateInk) / Math.max(1, sampleInk, templateInk);
  return dice * 0.34 + coverage * 0.51 + inkBalance * 0.15;
}

function classifyDigit(shape: Uint8Array, templates: readonly DigitTemplate[]) {
  const byDigit = new Map<number, number>();
  const sampleDilated = dilateShape(shape);
  const sampleInk = shape.reduce((sum, value) => sum + value, 0);
  const shifts = [
    [0, 0],
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;
  for (const template of templates) {
    let best = 0;
    for (const [shiftX, shiftY] of shifts) {
      best = Math.max(
        best,
        shiftedSimilarity(
          shape,
          sampleDilated,
          sampleInk,
          template.pixels,
          template.dilated,
          template.ink,
          shiftX,
          shiftY,
        ),
      );
    }
    byDigit.set(template.digit, Math.max(byDigit.get(template.digit) ?? 0, best));
  }
  const ranked = [...byDigit.entries()].sort((left, right) => right[1] - left[1]);
  const [digit, best] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  const confidence = clamp(
    0.18 + best * 0.58 + Math.max(0, best - second) * 1.75,
    0.12,
    0.99,
  );
  return { digit, confidence };
}

function extractDigitShape(
  grid: Uint8ClampedArray,
  row: number,
  column: number,
) {
  const cellSize = GRID_SIZE / 9;
  const margin = Math.round(cellSize * 0.17);
  const startX = Math.round(column * cellSize) + margin;
  const startY = Math.round(row * cellSize) + margin;
  const endX = Math.round((column + 1) * cellSize) - margin;
  const endY = Math.round((row + 1) * cellSize) - margin;
  const width = endX - startX;
  const height = endY - startY;
  const cell = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cell[y * width + x] = grid[(startY + y) * GRID_SIZE + startX + x];
    }
  }
  const binary = binaryFromGrayscale(cell);
  const components = findComponents(binary, width, height)
    .filter((component) => {
      const componentWidth = component.maxX - component.minX + 1;
      const componentHeight = component.maxY - component.minY + 1;
      const centerX = (component.minX + component.maxX) / 2;
      const centerY = (component.minY + component.maxY) / 2;
      return (
        component.area >= 12 &&
        componentHeight >= height * 0.2 &&
        componentWidth >= width * 0.035 &&
        componentWidth <= width * 0.88 &&
        componentHeight <= height * 0.94 &&
        Math.abs(centerX - width / 2) <= width * 0.34 &&
        Math.abs(centerY - height / 2) <= height * 0.34
      );
    })
    .sort(
      (left, right) =>
        right.area *
          (right.maxY - right.minY + 1) -
        left.area * (left.maxY - left.minY + 1),
    );
  if (components.length === 0) return null;

  const component = components[0];
  const componentBinary = new Uint8Array(width * height);
  for (const pixel of component.pixels) componentBinary[pixel] = 1;
  return normalizeShape(componentBinary, width, height, {
    minX: component.minX,
    minY: component.minY,
    maxX: component.maxX,
    maxY: component.maxY,
  });
}

export function conflictingCells(values: readonly number[]) {
  const conflicts = new Set<number>();
  const units: number[][] = [];
  for (let row = 0; row < 9; row += 1) {
    units.push(Array.from({ length: 9 }, (_, column) => row * 9 + column));
  }
  for (let column = 0; column < 9; column += 1) {
    units.push(Array.from({ length: 9 }, (_, row) => row * 9 + column));
  }
  for (let box = 0; box < 9; box += 1) {
    const rowStart = Math.floor(box / 3) * 3;
    const columnStart = (box % 3) * 3;
    units.push(
      Array.from(
        { length: 9 },
        (_, offset) =>
          (rowStart + Math.floor(offset / 3)) * 9 +
          columnStart +
          (offset % 3),
      ),
    );
  }
  for (const unit of units) {
    const positions = new Map<number, number[]>();
    for (const cell of unit) {
      const value = Number(values[cell] ?? 0);
      if (value > 0) {
        positions.set(value, [...(positions.get(value) ?? []), cell]);
      }
    }
    for (const cells of positions.values()) {
      if (cells.length > 1) cells.forEach((cell) => conflicts.add(cell));
    }
  }
  return conflicts;
}

async function recognizeOrientation(
  grayscale: Uint8ClampedArray,
  rotation: 0 | 90 | 180 | 270,
  templates: readonly DigitTemplate[],
  onProgress?: (progress: OcrProgress) => void,
  signal?: AbortSignal,
) {
  const values = Array(81).fill(0) as number[];
  const confidences = Array(81).fill(1) as number[];
  for (let row = 0; row < 9; row += 1) {
    if (signal?.aborted) throw new DOMException("识别已取消。", "AbortError");
    for (let column = 0; column < 9; column += 1) {
      const cell = row * 9 + column;
      const shape = extractDigitShape(grayscale, row, column);
      if (!shape) continue;
      const prediction = classifyDigit(shape, templates);
      values[cell] = prediction.digit;
      confidences[cell] = prediction.confidence;
    }
    report(
      onProgress,
      "recognize",
      0.35 + ((rotation / 90) * 9 + row + 1) / 36 * 0.5,
      `正在核对 ${rotation}° 方向，第 ${row + 1} 行`,
    );
    await nextFrame();
  }
  const clues = values.filter(Boolean).length;
  const conflicts = conflictingCells(values).size;
  const recognizedConfidences = confidences.filter(
    (_, index) => values[index] !== 0,
  );
  const averageConfidence =
    recognizedConfidences.reduce((sum, value) => sum + value, 0) /
    Math.max(1, recognizedConfidences.length);
  const plausibleClues = clues >= 8 && clues <= 45 ? 1 : 0;
  const score =
    averageConfidence * 100 +
    plausibleClues * 8 +
    Math.min(clues, 40) * 0.25 -
    conflicts * 10 -
    Math.max(0, clues - 45) * 1.5;
  return { values, confidences, grayscale, rotation, score };
}

function gridPreviewUrl(grayscale: Uint8ClampedArray) {
  const canvas = document.createElement("canvas");
  canvas.width = GRID_SIZE;
  canvas.height = GRID_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return "";
  const image = context.createImageData(GRID_SIZE, GRID_SIZE);
  for (let index = 0; index < grayscale.length; index += 1) {
    const target = index * 4;
    image.data[target] = grayscale[index];
    image.data[target + 1] = grayscale[index];
    image.data[target + 2] = grayscale[index];
    image.data[target + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function decodeImage(file: File) {
  let source: CanvasImageSource | null = null;
  let sourceWidth = 0;
  let sourceHeight = 0;
  let cleanup = () => {};
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      source = bitmap;
      sourceWidth = bitmap.width;
      sourceHeight = bitmap.height;
      cleanup = () => bitmap.close();
    } catch {
      // Some Safari versions expose createImageBitmap but reject valid uploads.
      // Fall through to the broadly supported HTMLImageElement decoder.
    }
  }
  if (!source) {
    const imageUrl = URL.createObjectURL(file);
    const image = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("浏览器无法解码这张图片。"));
        image.src = imageUrl;
      });
    } catch (error) {
      URL.revokeObjectURL(imageUrl);
      throw error;
    }
    source = image;
    sourceWidth = image.naturalWidth;
    sourceHeight = image.naturalHeight;
    cleanup = () => URL.revokeObjectURL(imageUrl);
  }
  const scale = Math.min(
    1,
    MAX_SOURCE_DIMENSION / Math.max(sourceWidth, sourceHeight),
  );
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    cleanup();
    throw new Error("当前浏览器无法读取图片像素。");
  }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  cleanup();
  return {
    width,
    height,
    grayscale: grayscaleFromImageData(context.getImageData(0, 0, width, height)),
  };
}

export async function recognizeSudokuImage(
  file: File,
  onProgress?: (progress: OcrProgress) => void,
  signal?: AbortSignal,
): Promise<SudokuOcrResult> {
  if (signal?.aborted) throw new DOMException("识别已取消。", "AbortError");
  const supportedExtension = /\.(?:png|jpe?g|webp)$/i.test(file.name);
  if (
    (file.type && !file.type.startsWith("image/")) ||
    (!file.type && !supportedExtension)
  ) {
    throw new Error("请选择 PNG、JPEG 或 WebP 格式的数独图片。");
  }
  if (file.size > 24 * 1024 * 1024) {
    throw new Error("图片超过 24MB，请压缩后再试。");
  }

  report(onProgress, "decode", 0.04, "正在读取图片");
  await nextFrame();
  const source = await decodeImage(file);
  if (signal?.aborted) throw new DOMException("识别已取消。", "AbortError");
  report(onProgress, "locate", 0.16, "正在定位九宫格边界");
  await nextFrame();
  const geometry = locateSudokuGrid(
    source.grayscale,
    source.width,
    source.height,
  );
  const straightened = warpGrid(
    source.grayscale,
    source.width,
    source.height,
    geometry.corners,
  );
  const templates = renderTemplates();
  report(onProgress, "recognize", 0.35, "正在识别 81 个单元格");
  await nextFrame();

  const orientations: OrientationResult[] = [];
  const rotations = [0, 90, 180, 270] as const;
  for (const rotation of rotations) {
    const rotated = rotateSquare(straightened, GRID_SIZE, rotation / 90);
    orientations.push(
      await recognizeOrientation(
        rotated,
        rotation,
        templates,
        onProgress,
        signal,
      ),
    );
  }
  orientations.sort((left, right) => right.score - left.score);
  const best = orientations[0];
  const clueCount = best.values.filter(Boolean).length;
  if (clueCount < 8) {
    throw new Error(
      "只识别到很少数字。请使用边界完整、光线均匀且数字清晰的图片。",
    );
  }

  report(onProgress, "validate", 0.94, "正在检查行、列和九宫格");
  await nextFrame();
  const lowConfidenceCount = best.confidences.filter(
    (confidence, cell) =>
      best.values[cell] !== 0 && confidence < LOW_CONFIDENCE,
  ).length;
  report(onProgress, "validate", 1, "识别完成，请校对结果");
  return {
    values: best.values,
    confidences: best.confidences,
    clueCount,
    lowConfidenceCount,
    rotation: best.rotation,
    gridPreviewUrl: gridPreviewUrl(best.grayscale),
  };
}
