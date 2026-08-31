import assert from "node:assert/strict";
import test from "node:test";

import {
  CELL_UNITS,
  TECHNIQUE_CATALOG,
  bit,
  countBits,
  createBoard,
  digitInMask,
  findNextStepForSnapshot,
  solveSudoku,
} from "../lib/sudoku/engine.ts";
import {
  KILLER_SUDOKU_EXAMPLES,
  parsePuzzle,
  SUDOKU_EXAMPLES,
} from "../lib/sudoku/examples.ts";
import {
  findKillerCageStep,
  solveKillerSudoku,
  updateKillerSelection,
  validateKillerCages,
} from "../lib/sudoku/killer.ts";

test("Killer cage drawing restarts only for a new disconnected gesture", () => {
  const connected = updateKillerSelection(new Set([0]), 1, true);
  assert.deepEqual([...connected], [0, 1]);

  const restarted = updateKillerSelection(connected, 20, true);
  assert.deepEqual([...restarted], [20]);

  const ignoredDuringDrag = updateKillerSelection(connected, 20, false);
  assert.deepEqual([...ignoredDuringDrag], [0, 1]);
});

test("Killer cages enforce standard size, connectivity, sum, and coverage rules", () => {
  const issues = validateKillerCages(
    [
      { cells: [0, 2], sum: 3 },
      { cells: [10], sum: 1 },
    ],
    { requireCoverage: true },
  );

  assert.ok(issues.some((issue) => issue.message.includes("上下左右相连")));
  assert.ok(issues.some((issue) => issue.message.includes("2 到 9")));
  assert.ok(issues.some((issue) => issue.message.includes("恰好覆盖全部 81 格")));
});

test("Killer cage combinations eliminate digits outside the distinct target sum", () => {
  const board = createBoard(Array(81).fill(0));
  const step = findKillerCageStep(board, [{ cells: [0, 1], sum: 3 }]);

  assert.ok(step);
  assert.equal(step.technique, "killer-cage-combination");
  assert.deepEqual(
    step.removed.filter(({ cell }) => cell === 0).map(({ digit }) => digit),
    [3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(
    step.removed.filter(({ cell }) => cell === 1).map(({ digit }) => digit),
    [3, 4, 5, 6, 7, 8, 9],
  );
});

test("a complete Killer Sudoku layout solves with replayable snapshots", () => {
  const example = KILLER_SUDOKU_EXAMPLES[0];
  const result = solveKillerSudoku(parsePuzzle(example.puzzle), example.cages);

  assert.equal(result.status, "solved");
  assert.equal(result.snapshots.length, result.steps.length + 1);
  assert.ok(result.steps.some((step) => step.technique === "killer-cage-combination"));
  const finalValues = result.snapshots.at(-1).values;
  for (const cage of example.cages) {
    const values = cage.cells.map((cell) => finalValues[cell]);
    assert.equal(values.reduce((sum, value) => sum + value, 0), cage.sum);
    assert.equal(new Set(values).size, values.length);
  }
});

test("all bundled examples are solved by the human technique registry", () => {
  for (const example of SUDOKU_EXAMPLES) {
    const result = solveSudoku(parsePuzzle(example.puzzle));
    assert.equal(result.status, "solved", example.name);
    assert.equal(result.snapshots.length, result.steps.length + 1);
    assert.ok(result.steps.length > 0);
  }
});

test("examples exercise both naked and hidden pair eliminations", () => {
  const nakedPairResult = solveSudoku(
    parsePuzzle(SUDOKU_EXAMPLES[1].puzzle),
  );
  const hiddenPairResult = solveSudoku(
    parsePuzzle(SUDOKU_EXAMPLES[2].puzzle),
  );

  assert.ok(
    nakedPairResult.steps.some((step) => step.technique === "naked-pair"),
  );
  assert.ok(
    hiddenPairResult.steps.some((step) => step.technique === "hidden-pair"),
  );
});

test("the master example necessarily demonstrates high-order reasoning", () => {
  const master = SUDOKU_EXAMPLES.find(
    (example) => example.name === "强制网挑战",
  );
  assert.ok(master);

  const result = solveSudoku(parsePuzzle(master.puzzle));
  const techniques = new Set(result.steps.map((step) => step.technique));

  assert.equal(result.status, "solved");
  assert.ok(techniques.has("xy-chain"));
  assert.ok(techniques.has("aic"));
  assert.ok(techniques.has("forcing-net"));
  assert.ok(
    result.steps.some(
      (step) => step.category === "forcing" && step.proof?.path.length,
    ),
  );
});

test("the same puzzle produces a deterministic technique sequence", () => {
  const puzzle = parsePuzzle(SUDOKU_EXAMPLES[2].puzzle);
  const first = solveSudoku(puzzle);
  const second = solveSudoku(puzzle);

  assert.deepEqual(
    first.steps.map((step) => step.id),
    second.steps.map((step) => step.id),
  );
});

test("duplicate givens are rejected before deduction starts", () => {
  const puzzle = Array(81).fill(0);
  puzzle[0] = 5;
  puzzle[1] = 5;

  const result = solveSudoku(puzzle);
  assert.equal(result.status, "invalid");
  assert.equal(result.steps.length, 0);
  assert.deepEqual(result.issues[0].cells, [0, 1]);
});

const AI_ESCARGOT =
  "100007090030020008009600500005300900010080002600004000300000010040000007007000300";
const AI_ESCARGOT_SOLUTION =
  "162857493534129678789643521475312986913586742628794135356478219241935867897261354";

test("a very hard unique puzzle is solved through proof-producing forcing logic", () => {
  const result = solveSudoku(parsePuzzle(AI_ESCARGOT));
  assert.equal(result.status, "solved");
  assert.equal(
    result.snapshots.at(-1).values.join(""),
    AI_ESCARGOT_SOLUTION,
  );

  const forcingSteps = result.steps.filter(
    (step) =>
      step.technique === "nishio-chain" ||
      step.technique === "forcing-net",
  );
  assert.ok(forcingSteps.length > 0);
  for (const step of forcingSteps) {
    assert.ok(step.proof);
    assert.deepEqual(step.removed, [step.proof.conclusion]);
    assert.ok(step.proof.path.length > 0);
    assert.ok(
      !step.explanation.premise.includes("暂时假设") &&
        !step.explanation.reasoning.includes("基础落数传播"),
    );
    if (step.technique === "nishio-chain") {
      assert.ok(step.proof.conflict);
      assert.ok(step.proof.literals.length > 1);
      for (const [nodeIndex, literal] of step.proof.literals.entries()) {
        if (literal.role !== "origin") {
          assert.ok(literal.parents.length > 0);
          assert.ok(literal.parents.every((parent) => parent < nodeIndex));
        }
      }
    }
  }
});

test("every recorded effect is valid in its pre-step snapshot", () => {
  const result = solveSudoku(parsePuzzle(AI_ESCARGOT));
  assert.equal(result.status, "solved");

  for (const [index, step] of result.steps.entries()) {
    const before = result.snapshots[index];
    if (step.placed) {
      assert.equal(before.values[step.placed.cell], 0);
      assert.ok(
        digitInMask(
          before.candidates[step.placed.cell],
          step.placed.digit,
        ),
      );
      assert.equal(
        Number(AI_ESCARGOT_SOLUTION[step.placed.cell]),
        step.placed.digit,
      );
    }
    for (const removed of step.removed) {
      assert.equal(before.values[removed.cell], 0);
      assert.ok(
        digitInMask(before.candidates[removed.cell], removed.digit),
      );
      assert.notEqual(
        Number(AI_ESCARGOT_SOLUTION[removed.cell]),
        removed.digit,
      );
    }
  }
});

test("AIC links alternate correctly and every Nishio edge has a causal basis", () => {
  const result = solveSudoku(parsePuzzle(AI_ESCARGOT));
  const candidatesWeaklyLinked = (left, right) =>
    (left.cell === right.cell && left.digit !== right.digit) ||
    (left.digit === right.digit &&
      CELL_UNITS[left.cell].some((unit) => unit.cells.includes(right.cell)));

  const aicSteps = result.steps.filter((step) => step.technique === "aic");
  assert.ok(aicSteps.length > 0);
  for (const step of aicSteps) {
    const before = result.snapshots[result.steps.indexOf(step)];
    assert.equal(step.links[0].type, "strong");
    assert.equal(step.links.at(-1).type, "strong");
    for (const [index, link] of step.links.entries()) {
      assert.equal(link.type, index % 2 === 0 ? "strong" : "weak");
      if (link.type === "weak") {
        assert.ok(candidatesWeaklyLinked(link.from, link.to));
        continue;
      }
      const cellStrong =
        link.from.cell === link.to.cell &&
        countBits(before.candidates[link.from.cell]) === 2;
      const unitStrong =
        link.from.digit === link.to.digit &&
        CELL_UNITS[link.from.cell].some(
          (unit) =>
            unit.cells.includes(link.to.cell) &&
            unit.cells.filter(
              (cell) =>
                before.values[cell] === 0 &&
                digitInMask(before.candidates[cell], link.from.digit),
            ).length === 2,
        );
      assert.ok(cellStrong || unitStrong);
    }
    const first = step.links[0].from;
    const last = step.links.at(-1).to;
    assert.ok(
      step.removed.every(
        (candidate) =>
          candidatesWeaklyLinked(candidate, first) &&
          candidatesWeaklyLinked(candidate, last),
      ),
    );
  }

  const nishioSteps = result.steps.filter(
    (step) => step.technique === "nishio-chain",
  );
  assert.ok(nishioSteps.length > 0);
  for (const step of nishioSteps) {
    for (const [nodeIndex, literal] of step.proof.literals.entries()) {
      for (const parentIndex of literal.parents) {
        const parent = step.proof.literals[parentIndex];
        assert.ok(parentIndex < nodeIndex);
        if (literal.reason === "weak-link") {
          assert.equal(parent.state, "true");
          assert.equal(literal.state, "false");
          assert.ok(
            candidatesWeaklyLinked(parent.candidate, literal.candidate),
          );
        } else if (literal.reason === "cell-single") {
          assert.equal(parent.state, "false");
          assert.equal(literal.state, "true");
          assert.equal(parent.candidate.cell, literal.candidate.cell);
        } else if (literal.reason === "unit-single") {
          assert.equal(parent.state, "false");
          assert.equal(literal.state, "true");
          assert.equal(parent.candidate.digit, literal.candidate.digit);
          assert.ok(
            literal.unit &&
              CELL_UNITS[parent.candidate.cell].some(
                (unit) =>
                  unit.kind === literal.unit.kind &&
                  unit.index === literal.unit.index,
              ),
          );
        }
      }
    }
  }
});

test("Waterfall restarts at the lowest-weight registry after every change", () => {
  const result = solveSudoku(parsePuzzle(AI_ESCARGOT));
  const weights = new Map(
    TECHNIQUE_CATALOG.map(({ id, weight }) => [id, weight]),
  );

  for (const [index, step] of result.steps.entries()) {
    const before = result.snapshots[index];
    const selected = findNextStepForSnapshot(
      before.values,
      before.candidates,
    );
    assert.ok(selected);
    assert.equal(selected.technique, step.technique);
    assert.equal(selected.weight, weights.get(step.technique));
  }

  assert.ok(
    result.steps.some(
      (step, index) =>
        index + 1 < result.steps.length &&
        step.weight > result.steps[index + 1].weight,
    ),
    "a high-order elimination should be followed by a fresh low-order scan",
  );
});

test("candidate restrictions can represent a partially reduced position", () => {
  const puzzle = parsePuzzle(SUDOKU_EXAMPLES[0].puzzle);
  const candidates = Array(81).fill(0);
  candidates[2] = bit(4);

  const result = solveSudoku(puzzle, {
    candidatePolicy: "respect",
    candidates,
  });
  assert.equal(result.status, "solved");
  assert.equal(result.snapshots[0].candidates[2], bit(4));
  assert.deepEqual(result.steps[0].placed, { cell: 2, digit: 4 });
});

test("reference fixtures exercise named fish and wing detectors", () => {
  const fixtures = [
    {
      technique: "x-wing",
      puzzle:
        "000400602006000100090500080050300000301206405000007020030002060004000900507009000",
    },
    {
      technique: "swordfish",
      puzzle:
        "500010003006003002003200000002300076000050000190007500000009400200800600900040005",
    },
    {
      technique: "jellyfish",
      puzzle:
        "001753800050000007700890100000601570625478931017905400000067004070000010006309700",
    },
    {
      technique: "xy-wing",
      puzzle:
        "900040000000600031020000090000700020002935600070002000060000073510009000000080009",
    },
  ];

  for (const fixture of fixtures) {
    const result = solveSudoku(parsePuzzle(fixture.puzzle));
    assert.equal(result.status, "solved", fixture.technique);
    assert.ok(
      result.steps.some((step) => step.technique === fixture.technique),
      fixture.technique,
    );
  }
});
