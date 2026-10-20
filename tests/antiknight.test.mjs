import assert from 'node:assert/strict'
import test from 'node:test'

import {
    TECHNIQUE_CATALOG,
    applyStep,
    bit,
    createBoard,
    digitInMask,
    findNextStepForSnapshot,
    isKnightAdjacent,
    knightPeersOf,
    peersForVariant,
    solveSudoku,
    unitsForVariant,
    validateBoard,
} from '../lib/sudoku/engine.ts'
import { ANTIKNIGHT_EXAMPLES, parsePuzzle } from '../lib/sudoku/examples.ts'
import {
    findKnightClaiming,
    findKnightPair,
    findKnightPointing,
} from '../lib/sudoku/techniques.ts'

const KNIGHT_TECHNIQUES = new Set([
    'knight-pointing',
    'knight-claiming',
    'knight-pair',
])

/** 独立的无马解计数器（仅用于出题/唯一性校验，不参与求解推理）。 */
function countAntiknightSolutions(input, cutoff = 2) {
    const values = [...input]
    const maskOf = (cell) => {
        const row = Math.floor(cell / 9)
        const column = cell % 9
        let used = 0
        const mark = (value) => {
            if (value > 0) used |= bit(value)
        }
        for (let index = 0; index < 9; index += 1) {
            mark(values[row * 9 + index])
            mark(values[index * 9 + column])
        }
        const boxRow = Math.floor(row / 3) * 3
        const boxColumn = Math.floor(column / 3) * 3
        for (let dr = 0; dr < 3; dr += 1) {
            for (let dc = 0; dc < 3; dc += 1) {
                mark(values[(boxRow + dr) * 9 + boxColumn + dc])
            }
        }
        for (const peer of knightPeersOf(cell)) {
            mark(values[peer])
        }
        return 0b111111111 & ~used
    }

    let count = 0
    const search = () => {
        if (count >= cutoff) return
        let best = -1
        let bestMask = 0
        let bestCount = 10
        for (let cell = 0; cell < 81; cell += 1) {
            if (values[cell] !== 0) continue
            const mask = maskOf(cell)
            const size = mask.toString(2).split('1').length - 1
            if (size === 0) return
            if (size < bestCount) {
                best = cell
                bestMask = mask
                bestCount = size
            }
        }
        if (best === -1) {
            count += 1
            return
        }
        for (let digit = 1; digit <= 9; digit += 1) {
            if (!(bestMask & bit(digit))) continue
            values[best] = digit
            search()
            values[best] = 0
            if (count >= cutoff) return
        }
    }
    search()
    return count
}

test('无马变体扩展互见而不增加单位', () => {
    assert.equal(unitsForVariant('antiknight').length, 27)
    assert.ok(isKnightAdjacent(9, 28))
    assert.ok(!isKnightAdjacent(9, 27))
    assert.ok(knightPeersOf(0).includes(11) && knightPeersOf(0).includes(19))

    const classicPeers = peersForVariant('classic')
    const knightPeers = peersForVariant('antiknight')
    // R2C1(9) 与 R4C2(28) 马步互见，经典互见看不到。
    assert.ok(!classicPeers[9].includes(28))
    assert.ok(knightPeers[9].includes(28))
    // 无马互见是经典互见的严格超集。
    for (let cell = 0; cell < 81; cell += 1) {
        assert.ok(classicPeers[cell].every((peer) => knightPeers[cell].includes(peer)))
    }
    assert.ok(knightPeers[9].length > classicPeers[9].length)
})

test('马步重复数字只在无马模式下报冲突', () => {
    // R2C1(9) 与 R4C2(28) 马步互见，同行列宫均不重复。
    const input = Array(81).fill(0)
    input[9] = 5
    input[28] = 5

    const classicBoard = createBoard(input, undefined, 'classic')
    const knightBoard = createBoard(input, undefined, 'antiknight')

    assert.deepEqual(validateBoard(classicBoard, input), [])
    const issues = validateBoard(knightBoard, input)
    assert.equal(issues.length, 1)
    assert.ok(issues[0].message.includes('马步'))
    assert.deepEqual(issues[0].cells, [9, 28])
})

test('候选传播覆盖马步互见格', () => {
    const input = Array(81).fill(0)
    input[40] = 5 // R5C5

    const classicBoard = createBoard(input, undefined, 'classic')
    const knightBoard = createBoard(input, undefined, 'antiknight')

    // 马步邻格 R3C4(21) 在无马模式下失去候选 5，经典模式保留。
    assert.ok(digitInMask(classicBoard.candidates[21], 5))
    assert.ok(!digitInMask(knightBoard.candidates[21], 5))
    for (const peer of knightPeersOf(40)) {
        assert.ok(!digitInMask(knightBoard.candidates[peer], 5), peer)
    }

    // applyStep 落数后的传播同样覆盖马步邻格。
    const empty = createBoard(Array(81).fill(0), undefined, 'antiknight')
    const placed = {
        id: 'manual',
        technique: 'naked-single',
        category: 'basic',
        label: '裸单',
        weight: 10,
        action: 'place',
        digit: 5,
        digits: [5],
        cells: [9],
        focusCells: [9],
        relatedCells: [...peersForVariant('antiknight')[9]],
        evidence: [{ cell: 9, digit: 5 }],
        removed: [],
        placed: { cell: 9, digit: 5 },
        links: [],
        explanation: { premise: '', reasoning: '', conclusion: '' },
    }
    const after = applyStep(empty, placed)
    assert.equal(after.values[9], 5)
    for (const peer of knightPeersOf(9)) {
        assert.ok(!digitInMask(after.candidates[peer], 5), peer)
    }
})

test('马步指向：宫内落点全部马步攻击目标格时删除目标候选', () => {
    // 宫 1 中候选 3 只剩 R2C2(10)、R3C1(18)，两格都与宫外 R4C3(29) 马步互见。
    const board = createBoard(Array(81).fill(0), undefined, 'antiknight')
    for (const cell of [0, 1, 2, 9, 11, 19, 20]) {
        board.candidates[cell] &= ~bit(3)
    }
    assert.ok(digitInMask(board.candidates[10], 3))
    assert.ok(digitInMask(board.candidates[18], 3))
    assert.ok(digitInMask(board.candidates[29], 3))

    const step = findKnightPointing(board)
    assert.ok(step)
    assert.equal(step.technique, 'knight-pointing')
    assert.equal(step.action, 'eliminate')
    assert.equal(step.unit.kind, 'box')
    assert.equal(step.unit.index, 0)
    assert.deepEqual([...step.cells].sort((a, b) => a - b), [10, 18])
    assert.deepEqual(step.removed, [{ cell: 29, digit: 3 }])
    assert.deepEqual(step.focusCells, [29])
    assert.ok(step.relatedCells.includes(10) && step.relatedCells.includes(29))
    assert.ok(step.explanation.premise.includes('马步互见'))
    assert.ok(step.explanation.reasoning.includes('马步'))
    // 可视化：两条马步弱链从证据候选指向目标候选。
    assert.equal(step.links.length, 2)
    assert.ok(step.links.every((link) => link.type === 'weak'))
    assert.ok(
        step.links.every(
            (link) => link.to.cell === 29 && link.to.digit === 3,
        ),
    )
})

test('马步认领：行内落点全部马步攻击目标格时删除目标候选', () => {
    // 第 1 行中候选 7 只剩 R1C2(1)、R1C4(3)，两格都与行外 R3C3(20) 马步互见。
    const board = createBoard(Array(81).fill(0), undefined, 'antiknight')
    for (const cell of [0, 2, 4, 5, 6, 7, 8]) {
        board.candidates[cell] &= ~bit(7)
    }
    assert.ok(digitInMask(board.candidates[1], 7))
    assert.ok(digitInMask(board.candidates[3], 7))
    assert.ok(digitInMask(board.candidates[20], 7))

    const step = findKnightClaiming(board)
    assert.ok(step)
    assert.equal(step.technique, 'knight-claiming')
    assert.equal(step.unit.kind, 'row')
    assert.equal(step.unit.index, 0)
    assert.deepEqual([...step.cells].sort((a, b) => a - b), [1, 3])
    assert.deepEqual(step.removed, [{ cell: 20, digit: 7 }])
    assert.ok(step.explanation.premise.includes('马步互见'))
    assert.ok(step.explanation.conclusion.includes('删除候选数'))
    assert.equal(step.links.length, 2)
    assert.ok(step.links.every((link) => link.type === 'weak'))
})

test('马步数对：两格同候选且马步互见时删除共同互见格', () => {
    // R2C1(9) 与 R4C2(28) 马步互见，候选都恰好是 4、6。
    const board = createBoard(Array(81).fill(0), undefined, 'antiknight')
    board.candidates[9] = bit(4) | bit(6)
    board.candidates[28] = bit(4) | bit(6)

    const step = findKnightPair(board)
    assert.ok(step)
    assert.equal(step.technique, 'knight-pair')
    assert.equal(step.action, 'eliminate')
    assert.deepEqual([...step.cells].sort((a, b) => a - b), [9, 28])
    assert.deepEqual([...step.digits].sort((a, b) => a - b), [4, 6])
    assert.deepEqual(step.focusCells, [9, 28])

    // 消除目标：同时与两格互见的格子（如 R2C2(10)、R4C1(27)）。
    const removedKeys = new Set(
        step.removed.map(({ cell, digit }) => `${cell}-${digit}`),
    )
    for (const cell of [10, 27]) {
        assert.ok(removedKeys.has(`${cell}-4`), cell)
        assert.ok(removedKeys.has(`${cell}-6`), cell)
    }
    assert.ok(step.removed.every(({ cell }) => cell !== 9 && cell !== 28))
    // 证据与连线：两格之间的马步弱链 + 到各删除目标的弱链。
    assert.equal(step.evidence.length, 4)
    assert.ok(
        step.links.some(
            (link) =>
                link.type === 'weak' &&
                link.from.cell === 9 &&
                link.to.cell === 28,
        ),
    )
    assert.ok(step.explanation.premise.includes('马步互见'))
    assert.ok(step.explanation.reasoning.includes('不能同数'))
})

test('无马专属技巧在经典与对角线模式下绝不触发', () => {
    for (const variant of ['classic', 'x']) {
        const board = createBoard(Array(81).fill(0), undefined, variant)
        assert.equal(findKnightPointing(board), null, variant)
        assert.equal(findKnightClaiming(board), null, variant)
        assert.equal(findKnightPair(board), null, variant)
    }
})

test('技巧注册表包含无马技巧且权重有序', () => {
    const entries = new Map(
        TECHNIQUE_CATALOG.map(({ id, weight, category }) => [
            id,
            { weight, category },
        ]),
    )
    assert.equal(entries.get('knight-pointing').category, 'antiknight')
    assert.equal(entries.get('knight-claiming').category, 'antiknight')
    assert.equal(entries.get('knight-pair').category, 'antiknight')
    assert.equal(entries.get('knight-pointing').weight, 35)
    assert.equal(entries.get('knight-claiming').weight, 36)
    assert.equal(entries.get('knight-pair').weight, 42)
    assert.ok(
        entries.get('diagonal-rectangle').weight <
            entries.get('knight-pointing').weight,
    )
    assert.ok(
        entries.get('knight-pair').weight < entries.get('naked-triple').weight,
    )
})

test('所有无马示例可求解且步骤可解释、可回放', () => {
    for (const example of ANTIKNIGHT_EXAMPLES) {
        const values = parsePuzzle(example.puzzle)
        const result = solveSudoku(values, { variant: 'antiknight' })

        assert.equal(result.status, 'solved', example.name)
        assert.equal(result.snapshots.length, result.steps.length + 1)
        assert.ok(result.steps.length > 0, example.name)

        for (const step of result.steps) {
            assert.equal(step.variant, 'antiknight', step.id)
            // 步骤播放器的解释三段式必须齐全。
            assert.ok(step.explanation.premise.length > 0, step.id)
            assert.ok(step.explanation.reasoning.length > 0, step.id)
            assert.ok(step.explanation.conclusion.length > 0, step.id)
        }

        // 至少用到一种无马专属技巧。
        assert.ok(
            result.steps.some((step) => KNIGHT_TECHNIQUES.has(step.technique)),
            example.name,
        )

        // 无马模式下的裸单解释必须点名马步互见。
        for (const step of result.steps) {
            if (step.technique === 'naked-single') {
                assert.ok(step.explanation.premise.includes('马步'), step.id)
            }
        }

        // 终盘必须满足经典与无马全部约束。
        const finalValues = result.snapshots.at(-1).values
        for (const unit of unitsForVariant('antiknight')) {
            assert.deepEqual(
                unit.cells.map((cell) => finalValues[cell]).sort((a, b) => a - b),
                [1, 2, 3, 4, 5, 6, 7, 8, 9],
                `${example.name} ${unit.kind}${unit.index}`,
            )
        }
        for (let cell = 0; cell < 81; cell += 1) {
            for (const peer of knightPeersOf(cell)) {
                assert.notEqual(
                    finalValues[cell],
                    finalValues[peer],
                    `${example.name} 马步冲突 ${cell}/${peer}`,
                )
            }
        }
    }
})

test('瀑布调度逐位重放一致（无马盘面）', () => {
    for (const example of [ANTIKNIGHT_EXAMPLES[0], ANTIKNIGHT_EXAMPLES.at(-1)]) {
        const result = solveSudoku(parsePuzzle(example.puzzle), {
            variant: 'antiknight',
        })
        assert.equal(result.status, 'solved', example.name)

        for (const [index, step] of result.steps.entries()) {
            const snapshot = result.snapshots[index]
            const selected = findNextStepForSnapshot(
                snapshot.values,
                snapshot.candidates,
                'antiknight',
            )
            assert.ok(selected, step.id)
            assert.equal(selected.technique, step.technique, step.id)
            assert.equal(selected.weight, step.weight, step.id)
        }
    }
})

test('无马示例在无马规则下恰有一个解', () => {
    for (const example of ANTIKNIGHT_EXAMPLES) {
        const values = parsePuzzle(example.puzzle)
        assert.equal(countAntiknightSolutions(values, 2), 1, example.name)
    }
})
