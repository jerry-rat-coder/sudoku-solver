import assert from 'node:assert/strict'
import test from 'node:test'

import {
    DIAGONALS,
    bit,
    createBoard,
    digitInMask,
    findNextStepForSnapshot,
    peersForVariant,
    solveSudoku,
    unitsForVariant,
    validateBoard,
} from '../lib/sudoku/engine.ts'
import { X_SUDOKU_EXAMPLES, parsePuzzle } from '../lib/sudoku/examples.ts'
import {
    findDiagonalClaiming,
    findDiagonalPointing,
    findDiagonalRectangle,
} from '../lib/sudoku/techniques.ts'

test('X variant adds both diagonals as units and extends peer visibility', () => {
    const xUnits = unitsForVariant('x')
    const classicUnits = unitsForVariant('classic')
    assert.equal(classicUnits.length, 27)
    assert.equal(xUnits.length, 29)
    assert.deepEqual(
        xUnits
            .filter((unit) => unit.kind === 'diagonal')
            .map((unit) => unit.index),
        [0, 1],
    )

    // R1C1 与 R4C4 在经典规则下互不相望，但在主对角线上互见。
    assert.ok(!peersForVariant('classic')[0].includes(30))
    assert.ok(peersForVariant('x')[0].includes(30))
    // R1C9 与 R4C6 在副对角线上互见。
    assert.ok(!peersForVariant('classic')[8].includes(32))
    assert.ok(peersForVariant('x')[8].includes(32))
    // R5C5（中心格）在两条对角线上：X 互见严格多于经典互见。
    const classicPeers = peersForVariant('classic')[40]
    const xPeers = peersForVariant('x')[40]
    assert.ok(classicPeers.every((cell) => xPeers.includes(cell)))
    assert.deepEqual(
        xPeers
            .filter((cell) => !classicPeers.includes(cell))
            .sort((a, b) => a - b),
        [0, 8, 10, 16, 20, 24, 56, 60, 64, 70, 72, 80],
    )
})

test('diagonal duplicates are reported as validation conflicts in X mode only', () => {
    // 主对角线 R1C1 与 R4C4 都填 5：行列宫均不冲突，只有对角线冲突。
    const input = Array(81).fill(0)
    input[0] = 5
    input[30] = 5

    const classicBoard = createBoard(input, undefined, 'classic')
    const xBoard = createBoard(input, undefined, 'x')

    assert.deepEqual(validateBoard(classicBoard, input), [])
    const issues = validateBoard(xBoard, input)
    assert.equal(issues.length, 1)
    assert.ok(issues[0].message.includes('对角线'))
    assert.deepEqual(issues[0].cells, [0, 30])
})

test('diagonal-pointing removes a digit from the diagonal outside the box', () => {
    // 宫 1 中候选 3 只落在主对角线的 R1C1、R2C2、R3C3 上
    //（宫内其余格的候选 3 被排除），因此可从主对角线上宫外的候选 3 删除。
    const board = createBoard(Array(81).fill(0), undefined, 'x')
    for (const cell of [1, 2, 9, 11, 18, 19]) {
        board.candidates[cell] &= ~bit(3)
    }

    const step = findDiagonalPointing(board)
    assert.ok(step)
    assert.equal(step.technique, 'diagonal-pointing')
    assert.equal(step.action, 'eliminate')
    assert.equal(step.unit.kind, 'diagonal')
    assert.equal(step.unit.index, 0)
    assert.ok(step.explanation.premise.includes('对角线'))
    assert.ok(step.explanation.reasoning.includes('对角线'))
    // 证据是宫 1 内对角线上的候选 3。
    assert.deepEqual(
        step.cells.sort((a, b) => a - b),
        [0, 10, 20],
    )
    // 被删除的目标是主对角线上宫 1 之外的候选 3。
    assert.ok(step.removed.length > 0)
    assert.ok(step.removed.every(({ digit }) => digit === 3))
    assert.ok(step.removed.every(({ cell }) => ![0, 10, 20].includes(cell)))
    assert.ok(
        step.removed.every(({ cell }) => cell % 10 === 0),
        '删除位置必须都在主对角线上',
    )
})

test('diagonal-claiming removes a digit from the box outside the diagonal', () => {
    // 主对角线上候选 7 只出现在宫 1（R1C1、R2C2），
    // 因此可从宫 1 中对角线之外的候选 7 删除。
    const input = Array(81).fill(0)
    input[20] = 3 // R3C3 填掉，使主对角线候选 7 只剩宫 1 两格
    // 阻断主对角线其他格的候选 7：给 30/40/50/60/70/80 填数太重，
    // 换个思路：直接构造候选。
    const board = createBoard(input, undefined, 'x')
    // 手动清除主对角线上宫 1 之外的候选 7，模拟“候选 7 集中在宫 1”。
    for (const cell of [30, 40, 50, 60, 70, 80]) {
        board.candidates[cell] &= ~bit(7)
    }
    // 且宫 1 对角线两格保留候选 7（createBoard 默认保留）。
    assert.ok(digitInMask(board.candidates[0], 7))
    assert.ok(digitInMask(board.candidates[10], 7))

    const step = findDiagonalClaiming(board)
    assert.ok(step)
    assert.equal(step.technique, 'diagonal-claiming')
    assert.equal(step.action, 'eliminate')
    assert.equal(step.unit.kind, 'diagonal')
    assert.ok(step.explanation.conclusion.includes('对角线'))
    // 被删除的是宫 1 中对角线之外的候选 7。
    assert.ok(step.removed.length > 0)
    assert.ok(step.removed.every(({ digit }) => digit === 7))
    assert.ok(step.removed.every(({ cell }) => ![0, 10].includes(cell)))
    assert.ok(
        step.removed.every(({ cell }) => {
            const box =
                Math.floor(Math.floor(cell / 9) / 3) * 3 +
                Math.floor((cell % 9) / 3)
            return box === 0
        }),
    )
})

test('diagonal-rectangle eliminates the opposite corners of a conjugate pair', () => {
    // 主对角线上候选 4 恰好剩 R1C1 与 R9C9 两处（共轭对），
    // 矩形另外两角 R1C9、R9C1 的候选 4 可删。
    const input = Array(81).fill(0)
    const board = createBoard(input, undefined, 'x')
    // 主对角线上只保留 R1C1、R9C9 的候选 4。
    for (const cell of [10, 20, 30, 40, 50, 60, 70]) {
        board.candidates[cell] &= ~bit(4)
    }
    assert.ok(digitInMask(board.candidates[0], 4))
    assert.ok(digitInMask(board.candidates[80], 4))

    const step = findDiagonalRectangle(board)
    assert.ok(step)
    assert.equal(step.technique, 'diagonal-rectangle')
    assert.equal(step.action, 'eliminate')
    assert.equal(step.unit.kind, 'diagonal')
    assert.ok(step.explanation.premise.includes('对角线'))
    assert.deepEqual(
        step.removed.map(({ cell }) => cell).sort((a, b) => a - b),
        [8, 72],
    )
    assert.ok(step.removed.every(({ digit }) => digit === 4))
})

test('diagonal techniques never fire on classic boards', () => {
    const board = createBoard(Array(81).fill(0), undefined, 'classic')
    assert.equal(findDiagonalPointing(board), null)
    assert.equal(findDiagonalClaiming(board), null)
    assert.equal(findDiagonalRectangle(board), null)
})

test('all X Sudoku examples solve uniquely with diagonal-specific steps', () => {
    for (const example of X_SUDOKU_EXAMPLES) {
        const values = parsePuzzle(example.puzzle)
        const result = solveSudoku(values, { variant: 'x' })

        assert.equal(result.status, 'solved', example.name)
        assert.equal(result.snapshots.length, result.steps.length + 1)
        assert.ok(result.steps.length > 0, example.name)

        // 步骤播放器的解释三段式必须齐全。
        for (const step of result.steps) {
            assert.ok(step.explanation.premise.length > 0, step.id)
            assert.ok(step.explanation.reasoning.length > 0, step.id)
            assert.ok(step.explanation.conclusion.length > 0, step.id)
        }

        // 至少用到一种对角线专属技巧，或对角线上的隐性唯一数。
        const diagonalStep = result.steps.some(
            (step) =>
                step.technique === 'diagonal-pointing' ||
                step.technique === 'diagonal-claiming' ||
                step.technique === 'diagonal-rectangle' ||
                (step.technique === 'hidden-single' &&
                    step.unit?.kind === 'diagonal'),
        )
        assert.ok(diagonalStep, example.name)

        // 终盘必须满足对角线约束：两条对角线都是 1-9 的排列。
        const finalValues = result.snapshots.at(-1).values
        for (const diagonal of DIAGONALS) {
            const digits = diagonal.cells.map((cell) => finalValues[cell])
            assert.deepEqual(
                [...digits].sort((a, b) => a - b),
                [1, 2, 3, 4, 5, 6, 7, 8, 9],
                `${example.name} 对角线 ${diagonal.index}`,
            )
        }
    }
})

test('waterfall scheduling restarts at the lowest weight for X boards', () => {
    const example = X_SUDOKU_EXAMPLES[0]
    const result = solveSudoku(parsePuzzle(example.puzzle), { variant: 'x' })
    assert.equal(result.status, 'solved')

    for (const [index, step] of result.steps.entries()) {
        const snapshot = result.snapshots[index]
        const selected = findNextStepForSnapshot(
            snapshot.values,
            snapshot.candidates,
            'x',
        )
        assert.ok(selected, step.id)
        assert.equal(selected.technique, step.technique, step.id)
        assert.equal(selected.weight, step.weight, step.id)
    }
})

test('classic solving never produces diagonal-specific steps', () => {
    const values = parsePuzzle(X_SUDOKU_EXAMPLES[0].puzzle)
    const classicResult = solveSudoku(values, { variant: 'classic' })
    const xResult = solveSudoku(values, { variant: 'x' })

    assert.equal(xResult.status, 'solved')
    // 经典规则下同一题目是多解题，求解器不应在经典模式下给出对角线推理。
    assert.ok(
        !classicResult.steps.some(
            (step) =>
                step.technique === 'diagonal-pointing' ||
                step.technique === 'diagonal-claiming' ||
                step.technique === 'diagonal-rectangle' ||
                (step.technique === 'hidden-single' &&
                    step.unit?.kind === 'diagonal'),
        ),
    )
    assert.ok(classicResult.steps.every((step) => step.variant === 'classic'))
    assert.ok(xResult.steps.every((step) => step.variant === 'x'))
})
