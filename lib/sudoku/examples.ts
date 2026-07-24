export interface SudokuExample {
  name: string;
  difficulty: string;
  puzzle: string;
}

export const SUDOKU_EXAMPLES: readonly SudokuExample[] = [
  {
    name: "晨间热身",
    difficulty: "入门",
    puzzle:
      "530070000600195000098000060800060003400803001700020006060000280000419005000080079",
  },
  {
    name: "数对练习",
    difficulty: "进阶",
    puzzle:
      "000000900002000048108040060050060000006003791010900806001530004200019035305200079",
  },
  {
    name: "隐藏数对",
    difficulty: "进阶",
    puzzle:
      "530608012000005008008040560800701003020000001700900850060530080000409000300000009",
  },
  {
    name: "强制网挑战",
    difficulty: "大师",
    puzzle:
      "100007090030020008009600500005300900010080002600004000300000010040000007007000300",
  },
];

export function parsePuzzle(puzzle: string) {
  return puzzle
    .replaceAll(/[^0-9.]/g, "")
    .slice(0, 81)
    .padEnd(81, "0")
    .split("")
    .map((value) => (value === "." ? 0 : Number(value)));
}
