import assert from "node:assert/strict";
import test from "node:test";

import { solveSudoku } from "../lib/sudoku/engine.ts";
import {
  parsePuzzle,
  SUDOKU_EXAMPLES,
} from "../lib/sudoku/examples.ts";

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
