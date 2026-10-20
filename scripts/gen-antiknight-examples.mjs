/**
 * 无马数独示例题生成器。
 *
 * 用途：为 ANTIKNIGHT_EXAMPLES 生成"无马规则下唯一解"的题目，
 * 并优先挑选求解过程用到无马专属技巧（马步指向/认领/数对）的题目。
 *
 * 说明：这里的回溯/解计数仅用于出题与唯一性校验，
 * 不参与步骤播放器的求解推理——求解推理严格使用人类技巧（lib/sudoku）。
 *
 * 运行：node --experimental-strip-types scripts/gen-antiknight-examples.mjs
 */
import {
    createBoard,
    isKnightAdjacent,
    knightPeersOf,
    solveSudoku,
} from '../lib/sudoku/engine.ts'
import { parsePuzzle } from '../lib/sudoku/examples.ts'

const DIGIT_MASKS = Array.from({ length: 10 }, (_, digit) => 1 << (digit - 1))

/** 随机打乱（可传种子保证可复现）。 */
function shuffled(values, random) {
    const next = [...values]
    for (let index = next.length - 1; index > 0; index -= 1) {
        const target = Math.floor(random() * (index + 1))
        ;[next[index], next[target]] = [next[target], next[index]]
    }
    return next
}

function mulberry32(seed) {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let value = state
        value = Math.imul(value ^ (value >>> 15), 1 | value)
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
}

function boxesOf(cell) {
    return Math.floor(Math.floor(cell / 9) / 3) * 3 + Math.floor((cell % 9) / 3)
}

function rowsOf(cell) {
    return Math.floor(cell / 9)
}

function colsOf(cell) {
    return cell % 9
}

/**
 * 无马规则下的解计数（上限 cutoff 即提前停止）。
 * 独立的朴素回溯，仅用于出题校验。
 */
function countAntiknightSolutions(input, cutoff = 2) {
    const values = [...input]
    const rowUsed = Array.from({ length: 9 }, () => 0)
    const colUsed = Array.from({ length: 9 }, () => 0)
    const boxUsed = Array.from({ length: 9 }, () => 0)
    const empties = []
    for (let cell = 0; cell < 81; cell += 1) {
        const value = values[cell]
        if (value === 0) {
            empties.push(cell)
            continue
        }
        const mask = DIGIT_MASKS[value]
        if (
            rowUsed[rowsOf(cell)] & mask ||
            colUsed[colsOf(cell)] & mask ||
            boxUsed[boxesOf(cell)] & mask
        ) {
            return 0
        }
        rowUsed[rowsOf(cell)] |= mask
        colUsed[colsOf(cell)] |= mask
        boxUsed[boxesOf(cell)] |= mask
    }
    // 预填格之间也不能马步同数。
    for (let cell = 0; cell < 81; cell += 1) {
        if (values[cell] === 0) continue
        for (const peer of knightPeersOf(cell)) {
            if (values[peer] === values[cell]) return 0
        }
    }

    let count = 0
    const search = (index) => {
        if (count >= cutoff) return
        if (index === empties.length) {
            count += 1
            return
        }
        const cell = empties[index]
        const forbidden =
            rowUsed[rowsOf(cell)] |
            colUsed[colsOf(cell)] |
            boxUsed[boxesOf(cell)] |
            emptiesLikePeers(cell, empties, values)
        for (const digit of shuffled(
            [1, 2, 3, 4, 5, 6, 7, 8, 9],
            randomForSearch,
        )) {
            const mask = DIGIT_MASKS[digit]
            if (forbidden & mask) continue
            values[cell] = digit
            rowUsed[rowsOf(cell)] |= mask
            colUsed[colsOf(cell)] |= mask
            boxUsed[boxesOf(cell)] |= mask
            search(index + 1)
            values[cell] = 0
            rowUsed[rowsOf(cell)] &= ~mask
            colUsed[colsOf(cell)] &= ~mask
            boxUsed[boxesOf(cell)] &= ~mask
            if (count >= cutoff) return
        }
    }
    search(0)
    return count
}

/** 当前格的已填马步邻居所占数字（马步约束的增量部分）。 */
function emptiesLikePeers(cell, empties, values) {
    let mask = 0
    for (const peer of knightPeersOf(cell)) {
        if (values[peer] !== 0) mask |= DIGIT_MASKS[values[peer]]
    }
    return mask
}

let randomForSearch = Math.random

/** 生成一个无马合法终盘。 */
function generateAntiknightSolution(random) {
    const values = Array(81).fill(0)
    const rowUsed = Array.from({ length: 9 }, () => 0)
    const colUsed = Array.from({ length: 9 }, () => 0)
    const boxUsed = Array.from({ length: 9 }, () => 0)

    const place = (index) => {
        if (index === 81) return true
        const cell = index
        const forbiddenByKnight = emptiesLikePeers(cell, [], values)
        const candidates = shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9], random).filter(
            (digit) => {
                const mask = DIGIT_MASKS[digit]
                return !(
                    (rowUsed[rowsOf(cell)] |
                        colUsed[colsOf(cell)] |
                        boxUsed[boxesOf(cell)] |
                        forbiddenByKnight) &
                    mask
                )
            },
        )
        for (const digit of candidates) {
            const mask = DIGIT_MASKS[digit]
            values[cell] = digit
            rowUsed[rowsOf(cell)] |= mask
            colUsed[colsOf(cell)] |= mask
            boxUsed[boxesOf(cell)] |= mask
            if (place(index + 1)) return true
            values[cell] = 0
            rowUsed[rowsOf(cell)] &= ~mask
            colUsed[colsOf(cell)] &= ~mask
            boxUsed[boxesOf(cell)] &= ~mask
        }
        return false
    }

    return place(0) ? values : null
}

/** 挖洞：保持无马唯一解的前提下尽量移除已知数。 */
function digPuzzle(solution, random, minGivens) {
    const puzzle = [...solution]
    for (const cell of shuffled(
        Array.from({ length: 81 }, (_, index) => index),
        random,
    )) {
        if (puzzle[cell] === 0) continue
        const givens = puzzle.filter((value) => value !== 0).length
        if (givens <= minGivens) break
        const backup = puzzle[cell]
        puzzle[cell] = 0
        if (countAntiknightSolutions(puzzle, 2) !== 1) {
            puzzle[cell] = backup
        }
    }
    return puzzle
}

function analyze(puzzle) {
    const values = parsePuzzle(puzzle)
    const result = solveSudoku(values, { variant: 'antiknight' })
    const techniques = [...new Set(result.steps.map((step) => step.technique))]
    const maxWeight = Math.max(0, ...result.steps.map((step) => step.weight))
    return { result, techniques, maxWeight }
}

function labelFor(maxWeight) {
    if (maxWeight <= 20) return '入门'
    if (maxWeight <= 42) return '进阶'
    return '大师'
}

function main() {
    const seed = Number(process.argv[2] ?? 20261017)
    const random = mulberry32(seed)
    randomForSearch = random

    const buckets = {
        basic: [],
        pointing: [],
        claiming: [],
        pair: [],
    }

    const attempts = Number(process.argv[3] ?? 40)
    for (let round = 0; round < attempts; round += 1) {
        const solution = generateAntiknightSolution(random)
        if (!solution) continue
        const puzzle = digPuzzle(
            solution,
            random,
            round < attempts / 2 ? 26 : 22,
        )
        const puzzleString = puzzle.join('')
        const analysis = analyze(puzzleString)
        if (analysis.result.status !== 'solved') continue

        const entry = {
            puzzle: puzzleString,
            givens: puzzle.filter((value) => value !== 0).length,
            weight: analysis.maxWeight,
            techniques: analysis.techniques,
        }
        if (analysis.techniques.includes('knight-pair'))
            buckets.pair.push(entry)
        else if (analysis.techniques.includes('knight-pointing'))
            buckets.pointing.push(entry)
        else if (analysis.techniques.includes('knight-claiming'))
            buckets.claiming.push(entry)
        else buckets.basic.push(entry)

        process.stderr.write(
            `round ${round}: givens=${entry.givens} weight=${entry.weight} [${analysis.techniques.join(',')}]\n`,
        )
    }

    for (const [name, entries] of Object.entries(buckets)) {
        entries.sort((left, right) => left.givens - right.givens)
        console.log(`# bucket ${name} (${entries.length})`)
        for (const entry of entries.slice(0, 3)) {
            console.log(
                JSON.stringify({
                    bucket: name,
                    difficulty: labelFor(entry.weight),
                    ...entry,
                }),
            )
        }
    }
}

main()
