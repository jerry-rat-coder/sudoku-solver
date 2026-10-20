import type { KillerCage } from './killer.ts'

export interface SudokuExample {
    name: string
    difficulty: string
    puzzle: string
}

export const SUDOKU_EXAMPLES: readonly SudokuExample[] = [
    {
        name: '晨间热身',
        difficulty: '入门',
        puzzle: '530070000600195000098000060800060003400803001700020006060000280000419005000080079',
    },
    {
        name: '数对练习',
        difficulty: '进阶',
        puzzle: '000000900002000048108040060050060000006003791010900806001530004200019035305200079',
    },
    {
        name: '隐藏数对',
        difficulty: '进阶',
        puzzle: '530608012000005008008040560800701003020000001700900850060530080000409000300000009',
    },
    {
        name: '强制网挑战',
        difficulty: '大师',
        puzzle: '100007090030020008009600500005300900010080002600004000300000010040000007007000300',
    },
]

export function parsePuzzle(puzzle: string) {
    return puzzle
        .replaceAll(/[^0-9.]/g, '')
        .slice(0, 81)
        .padEnd(81, '0')
        .split('')
        .map((value) => (value === '.' ? 0 : Number(value)))
}

export interface XSudokuExample {
    name: string
    difficulty: string
    puzzle: string
}

/**
 * 对角线数独（Sudoku X）示例：在经典规则上要求两条对角线也恰好包含 1–9。
 * 题目取自 SudokuWiki 的 Sudoku X 策略示例，解题过程需要对角线专属技巧。
 */
export const X_SUDOKU_EXAMPLES: readonly XSudokuExample[] = [
    {
        name: '对角线热身',
        difficulty: '入门',
        puzzle: '000060050005000690070000013080050000007109000000040070290000030056000400030010000',
    },
    {
        name: '对角线矩形练习',
        difficulty: '进阶',
        puzzle: '380006010000004002004000508002000600050020040003000900508000100600100000040700056',
    },
    {
        name: '对角线指向练习',
        difficulty: '进阶',
        puzzle: '010000090000004000000700100160008059080040030430500017006001000000400500040000080',
    },
    {
        name: '对角线综合挑战',
        difficulty: '大师',
        puzzle: '000304000009000000073100000090060070002000600060050030040002590000000200800905000',
    },
]

export interface AntiKnightExample {
    name: string
    difficulty: string
    puzzle: string
}

/**
 * 无马数独（Anti-Knight）示例：在经典规则上要求马步互见的两格不能同数。
 * 题目由 scripts/gen-antiknight-examples.mjs 生成（无马规则下唯一解），
 * 每题的求解过程都会用到无马专属技巧：马步指向、马步认领、马步数对。
 */
export const ANTIKNIGHT_EXAMPLES: readonly AntiKnightExample[] = [
    {
        name: '无马热身',
        difficulty: '入门',
        puzzle: '050000000000600003400500200000400920007000800040098005000100000072000104000002500',
    },
    {
        name: '马步指向练习',
        difficulty: '进阶',
        puzzle: '000200000902608000078010600009000000000000000010030206000302000293000057000500000',
    },
    {
        name: '马步数对练习',
        difficulty: '进阶',
        puzzle: '200710000400006200000000000000000040000000603600005080062400010004260050000001060',
    },
    {
        name: '无马综合挑战',
        difficulty: '大师',
        puzzle: '600001504439005100010000320000000060000260700004007080000000800000000000000002600',
    },
]

const KILLER_SAMPLE_SOLUTION =
    '162857493534129678789643521475312986913586742628794135356478219241935867897261354'

const DIVERSE_CAGE_PATTERNS: readonly (readonly (readonly number[])[])[] = [
    [
        [0, 1, 2, 4],
        [3, 6, 7],
        [5, 8],
    ],
    [
        [0, 1, 2, 3, 6],
        [4, 5, 7, 8],
    ],
    [
        [0, 3],
        [1, 2],
        [6, 7],
        [4, 5, 8],
    ],
]

function cellsForBox(box: number, offsets: readonly number[]) {
    const rowStart = Math.floor(box / 3) * 3
    const columnStart = (box % 3) * 3
    return offsets.map(
        (offset) =>
            (rowStart + Math.floor(offset / 3)) * 9 +
            columnStart +
            (offset % 3),
    )
}

function sumForCells(cells: readonly number[]) {
    return cells.reduce(
        (sum, cell) => sum + Number(KILLER_SAMPLE_SOLUTION[cell]),
        0,
    )
}

function diverseKillerCages(): KillerCage[] {
    const patternOrder = [0, 1, 2, 2, 0, 1, 1, 2, 0]
    return patternOrder.flatMap((patternIndex, box) =>
        DIVERSE_CAGE_PATTERNS[patternIndex].map((offsets) => {
            const cells = cellsForBox(box, offsets)
            return { cells, sum: sumForCells(cells) }
        }),
    )
}

function puzzleWithGivens(cells: readonly number[]) {
    const givenCells = new Set(cells)
    return [...KILLER_SAMPLE_SOLUTION]
        .map((value, cell) => (givenCells.has(cell) ? value : '0'))
        .join('')
}

export interface KillerSudokuExample {
    name: string
    difficulty: string
    puzzle: string
    cages: readonly KillerCage[]
}
/** A complete, orthogonally connected cage layout with no ordinary givens. */
export const KILLER_SUDOKU_EXAMPLES: readonly KillerSudokuExample[] = [
    {
        name: '三格笼演示',
        difficulty: '标准',
        puzzle: '0'.repeat(81),
        cages: Array.from({ length: 27 }, (_, index) => {
            const row = Math.floor(index / 3)
            const column = (index % 3) * 3
            const cells = [
                row * 9 + column,
                row * 9 + column + 1,
                row * 9 + column + 2,
            ]
            return {
                cells,
                sum: sumForCells(cells),
            }
        }),
    },
    {
        name: '异形笼练习',
        difficulty: '进阶',
        puzzle: puzzleWithGivens([0, 4, 8, 27, 40, 44, 54, 67, 80]),
        cages: diverseKillerCages(),
    },
]
