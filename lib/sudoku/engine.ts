import {
  applyStep,
  createBoard,
  digitInMask,
  isSolved,
  snapshot,
  validateBoard,
  type MutableBoard,
  type SolveResult,
  type SolveOptions,
} from "./model.ts";
import {
  FORCING_TECHNIQUES,
  findForcingChain,
  findForcingNet,
} from "./forcing.ts";
import {
  TECHNIQUE_CATALOG as REGISTERED_TECHNIQUES,
  findNextRegisteredStep,
} from "./techniques.ts";

export * from "./model.ts";

export const TECHNIQUE_CATALOG = [
  ...REGISTERED_TECHNIQUES,
  ...FORCING_TECHNIQUES,
] as const;

export function findNextStepForSnapshot(
  values: readonly number[],
  candidates: readonly number[],
) {
  const board: MutableBoard = {
    values: [...values],
    candidates: [...candidates],
  };
  return (
    findNextRegisteredStep(board) ??
    findForcingChain(board) ??
    findForcingNet(board)
  );
}

function boardChanged(left: MutableBoard, right: MutableBoard) {
  return (
    right.values.some((value, index) => value !== left.values[index]) ||
    right.candidates.some(
      (mask, index) => mask !== left.candidates[index],
    )
  );
}

function stateKey(board: MutableBoard) {
  return `${board.values.join("")}|${board.candidates.join(",")}`;
}

function validateProposedStep(
  board: MutableBoard,
  step: SolveResult["steps"][number],
) {
  const definition = TECHNIQUE_CATALOG.find(
    (technique) => technique.id === step.technique,
  );
  if (!definition || definition.weight !== step.weight) {
    return "技巧注册信息与推导步骤不一致。";
  }

  if (step.action === "place") {
    if (
      !step.placed ||
      board.values[step.placed.cell] !== 0 ||
      !digitInMask(
        board.candidates[step.placed.cell],
        step.placed.digit,
      )
    ) {
      return "落数结论不是当前盘面的有效候选。";
    }
    return undefined;
  }

  if (step.removed.length === 0) {
    return "候选消除步骤没有给出任何删除项。";
  }
  const seen = new Set<string>();
  for (const removed of step.removed) {
    const key = `${removed.cell}-${removed.digit}`;
    if (
      seen.has(key) ||
      board.values[removed.cell] !== 0 ||
      !digitInMask(board.candidates[removed.cell], removed.digit)
    ) {
      return "候选消除结论包含重复项或当前并不存在的候选。";
    }
    seen.add(key);
  }
  return undefined;
}

export function solveSudoku(
  input: readonly number[],
  options: SolveOptions = {},
): SolveResult {
  const candidateOverrides =
    options.candidatePolicy === "respect" ? options.candidates : undefined;
  let board = createBoard(input, candidateOverrides);
  const initialIssues = [
    ...validateBoard(board, input),
    ...(options.candidatePolicy === "respect" &&
    (!candidateOverrides ||
      candidateOverrides.length !== 81 ||
      candidateOverrides.some(
        (mask) =>
          !Number.isInteger(Number(mask)) ||
          Number(mask) < 0 ||
          Number(mask) > 0b111111111,
      ))
      ? [
          {
            message: "候选局面必须包含 81 个有效的九位候选掩码。",
            cells: [] as number[],
          },
        ]
      : []),
  ];
  const snapshots = [snapshot(board)];
  const steps: SolveResult["steps"][number][] = [];

  if (initialIssues.length > 0) {
    return {
      status: "invalid",
      snapshots,
      steps,
      issues: initialIssues,
    };
  }

  const visited = new Set([stateKey(board)]);
  // Every valid step removes at least one candidate or fills one cell. A
  // classic 9×9 Sudoku has fewer than 810 such monotonic changes.
  const maximumMonotonicSteps = 810;

  for (let iteration = 0; iteration < maximumMonotonicSteps; iteration += 1) {
    if (isSolved(board)) {
      return { status: "solved", snapshots, steps, issues: [] };
    }

    // Waterfall scheduling: the registry is scanned from the lowest weight
    // after every single board change. Forcing logic is only reached when all
    // named, lower-weight techniques are exhausted.
    const nextStep =
      findNextRegisteredStep(board) ??
      findForcingChain(board) ??
      findForcingNet(board);
    if (!nextStep) {
      return { status: "stuck", snapshots, steps, issues: [] };
    }

    const proposalIssue = validateProposedStep(board, nextStep);
    if (proposalIssue) {
      return {
        status: "invalid",
        snapshots,
        steps,
        issues: [
          {
            message: `技巧“${nextStep.label}”未通过中央校验：${proposalIssue}`,
            cells: [...nextStep.focusCells],
          },
        ],
      };
    }

    const nextBoard = applyStep(board, nextStep);
    if (!boardChanged(board, nextBoard)) {
      return {
        status: "invalid",
        snapshots,
        steps,
        issues: [
          {
            message: `技巧“${nextStep.label}”没有产生有效的盘面变化。`,
            cells: [...nextStep.focusCells],
          },
        ],
      };
    }

    const issues = validateBoard(nextBoard);
    if (issues.length > 0) {
      return {
        status: "invalid",
        snapshots,
        steps,
        issues: [
          {
            message: `技巧“${nextStep.label}”产生了矛盾，推理已安全停止。`,
            cells: [...nextStep.focusCells],
          },
          ...issues,
        ],
      };
    }

    const key = stateKey(nextBoard);
    if (visited.has(key)) {
      return {
        status: "invalid",
        snapshots,
        steps,
        issues: [
          {
            message: "推理状态发生循环，已停止以保护步骤链。",
            cells: [...nextStep.focusCells],
          },
        ],
      };
    }
    visited.add(key);

    board = nextBoard;
    steps.push({
      ...nextStep,
      id: `step-${steps.length + 1}-${nextStep.id}`,
    });
    snapshots.push(snapshot(board));
  }

  return {
    status: "invalid",
    snapshots,
    steps,
    issues: [
      {
        message: "推理变化次数超过经典数独的单调状态上限。",
        cells: [],
      },
    ],
  };
}
