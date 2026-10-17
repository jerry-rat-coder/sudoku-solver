import {
    BOXES,
    COLUMNS,
    DIAGONALS,
    DIGITS,
    ROWS,
    bit,
    cellsSeeEachOther,
    combinations,
    commonPeers,
    countBits,
    describeUnit,
    digitInMask,
    maskToDigits,
    peersForVariant,
    toCellName,
    unitsForVariant,
    type CandidateRef,
    type ChainLink,
    type Digit,
    type MutableBoard,
    type SolveStep,
    type TechniqueDefinition,
    type TechniqueId,
    type Unit,
} from './model.ts'

const peersOf = (board: MutableBoard) => peersForVariant(board.variant)
const unitsOf = (board: MutableBoard) => unitsForVariant(board.variant)

interface RegisteredTechnique extends TechniqueDefinition {
    find: (board: MutableBoard) => SolveStep | null
}

const define = (
    definition: TechniqueDefinition,
    find: RegisteredTechnique['find'],
): RegisteredTechnique => ({ ...definition, find })

const unitRef = (unit: Unit) => ({ kind: unit.kind, index: unit.index })

const uniqueNumbers = (values: readonly number[]) =>
    [...new Set(values)].sort((left, right) => left - right)

const refsForCells = (
    board: MutableBoard,
    cells: readonly number[],
): CandidateRef[] =>
    cells.flatMap((cell) =>
        maskToDigits(board.candidates[cell]).map((digit) => ({ cell, digit })),
    )

const definitionById = new Map<TechniqueId, TechniqueDefinition>()

function stepFor(
    technique: TechniqueDefinition,
    details: Omit<
        SolveStep,
        'id' | 'technique' | 'label' | 'weight' | 'category'
    > & { id: string },
): SolveStep {
    return {
        technique: technique.id,
        label: technique.label,
        weight: technique.weight,
        category: technique.category,
        ...details,
    }
}

function currentDefinition(id: TechniqueId) {
    const definition = definitionById.get(id)
    if (!definition) throw new Error(`Technique is not registered: ${id}`)
    return definition
}

function findNakedSingle(board: MutableBoard): SolveStep | null {
    for (let cell = 0; cell < 81; cell += 1) {
        if (
            board.values[cell] !== 0 ||
            countBits(board.candidates[cell]) !== 1
        ) {
            continue
        }
        const [digit] = maskToDigits(board.candidates[cell])
        return stepFor(currentDefinition('naked-single'), {
            id: `naked-single-${cell}-${digit}`,
            action: 'place',
            digit,
            digits: [digit],
            cells: [cell],
            focusCells: [cell],
            relatedCells: [...peersOf(board)[cell]],
            evidence: [{ cell, digit }],
            removed: [],
            placed: { cell, digit },
            links: [],
            explanation: {
                premise: `${toCellName(cell)} 的同行、同列和同宫${board.variant === 'x' ? '以及同对角线' : ''}已经排除了其余数字。`,
                reasoning: `这个单元格只剩候选数 ${digit}。`,
                conclusion: `确定 ${toCellName(cell)} = ${digit}。`,
            },
        })
    }
    return null
}

function findHiddenSingle(board: MutableBoard): SolveStep | null {
    for (const unit of unitsOf(board)) {
        for (const digit of DIGITS) {
            if (unit.cells.some((cell) => board.values[cell] === digit))
                continue
            const cells = unit.cells.filter(
                (cell) =>
                    board.values[cell] === 0 &&
                    digitInMask(board.candidates[cell], digit),
            )
            if (cells.length !== 1) continue
            const [cell] = cells
            return stepFor(currentDefinition('hidden-single'), {
                id: `hidden-single-${unit.kind}-${unit.index}-${cell}-${digit}`,
                action: 'place',
                unit: unitRef(unit),
                digit,
                digits: [digit],
                cells: [cell],
                focusCells: [cell],
                relatedCells: [...unit.cells],
                evidence: [{ cell, digit }],
                removed: [],
                placed: { cell, digit },
                links: [],
                explanation: {
                    premise: `数字 ${digit} 在${describeUnit(unit)}中的其他位置都已排除。`,
                    reasoning: `${toCellName(cell)} 是${describeUnit(unit)}中唯一仍可放置 ${digit} 的单元格。`,
                    conclusion: `确定 ${toCellName(cell)} = ${digit}。`,
                },
            })
        }
    }
    return null
}

function findPointing(board: MutableBoard): SolveStep | null {
    for (const box of BOXES) {
        for (const digit of DIGITS) {
            const cells = box.cells.filter(
                (cell) =>
                    board.values[cell] === 0 &&
                    digitInMask(board.candidates[cell], digit),
            )
            if (cells.length < 2) continue

            const rows = uniqueNumbers(
                cells.map((cell) => Math.floor(cell / 9)),
            )
            const columns = uniqueNumbers(cells.map((cell) => cell % 9))
            const line =
                rows.length === 1
                    ? ROWS[rows[0]]
                    : columns.length === 1
                      ? COLUMNS[columns[0]]
                      : undefined
            if (!line) continue

            const removed = line.cells
                .filter(
                    (cell) =>
                        !box.cells.includes(cell) &&
                        board.values[cell] === 0 &&
                        digitInMask(board.candidates[cell], digit),
                )
                .map((cell) => ({ cell, digit }))
            if (removed.length === 0) continue

            return stepFor(currentDefinition('locked-candidate-pointing'), {
                id: `pointing-${box.index}-${line.kind}-${line.index}-${digit}`,
                action: 'eliminate',
                unit: unitRef(box),
                digit,
                digits: [digit],
                cells,
                focusCells: cells,
                relatedCells: uniqueNumbers([...box.cells, ...line.cells]),
                evidence: cells.map((cell) => ({ cell, digit })),
                removed,
                links: [],
                explanation: {
                    premise: `宫内候选数 ${digit} 全部落在同一${line.kind === 'row' ? '行' : '列'}。`,
                    reasoning: `因此 ${digit} 必须在这条宫线交叉区域内出现一次。`,
                    conclusion: `从该${line.kind === 'row' ? '行' : '列'}的宫外位置删除候选数 ${digit}。`,
                },
            })
        }
    }
    return null
}

function findClaiming(board: MutableBoard): SolveStep | null {
    for (const line of [...ROWS, ...COLUMNS]) {
        for (const digit of DIGITS) {
            const cells = line.cells.filter(
                (cell) =>
                    board.values[cell] === 0 &&
                    digitInMask(board.candidates[cell], digit),
            )
            if (cells.length < 2) continue
            const boxes = uniqueNumbers(
                cells.map(
                    (cell) =>
                        Math.floor(Math.floor(cell / 9) / 3) * 3 +
                        Math.floor((cell % 9) / 3),
                ),
            )
            if (boxes.length !== 1) continue
            const box = BOXES[boxes[0]]
            const removed = box.cells
                .filter(
                    (cell) =>
                        !line.cells.includes(cell) &&
                        board.values[cell] === 0 &&
                        digitInMask(board.candidates[cell], digit),
                )
                .map((cell) => ({ cell, digit }))
            if (removed.length === 0) continue

            return stepFor(currentDefinition('locked-candidate-claiming'), {
                id: `claiming-${line.kind}-${line.index}-${box.index}-${digit}`,
                action: 'eliminate',
                unit: unitRef(line),
                digit,
                digits: [digit],
                cells,
                focusCells: cells,
                relatedCells: uniqueNumbers([...box.cells, ...line.cells]),
                evidence: cells.map((cell) => ({ cell, digit })),
                removed,
                links: [],
                explanation: {
                    premise: `${line.kind === 'row' ? '行' : '列'}内候选数 ${digit} 全部位于同一宫。`,
                    reasoning: `这个宫中的 ${digit} 必须由这些交叉位置承担。`,
                    conclusion: `从同宫的其他位置删除候选数 ${digit}。`,
                },
            })
        }
    }
    return null
}

/**
 * 对角线指向：宫内某候选全部落在某条对角线上，
 * 则该对角线其余位置可删除该候选。（Sudoku X Pointing Pairs）
 */
export function findDiagonalPointing(board: MutableBoard): SolveStep | null {
    if (board.variant !== 'x') return null
    for (const box of BOXES) {
        for (const digit of DIGITS) {
            const cells = box.cells.filter(
                (cell) =>
                    board.values[cell] === 0 &&
                    digitInMask(board.candidates[cell], digit),
            )
            if (cells.length < 2) continue

            const diagonal = DIAGONALS.find((line) =>
                cells.every((cell) => line.cells.includes(cell)),
            )
            if (!diagonal) continue

            const removed = diagonal.cells
                .filter(
                    (cell) =>
                        !box.cells.includes(cell) &&
                        board.values[cell] === 0 &&
                        digitInMask(board.candidates[cell], digit),
                )
                .map((cell) => ({ cell, digit }))
            if (removed.length === 0) continue

            return stepFor(currentDefinition('diagonal-pointing'), {
                id: `diagonal-pointing-${box.index}-${diagonal.index}-${digit}`,
                action: 'eliminate',
                unit: unitRef(diagonal),
                digit,
                digits: [digit],
                cells,
                focusCells: cells,
                relatedCells: uniqueNumbers([...box.cells, ...diagonal.cells]),
                evidence: cells.map((cell) => ({ cell, digit })),
                removed,
                links: [],
                explanation: {
                    premise: `宫内候选数 ${digit} 全部落在${describeUnit(diagonal)}上。`,
                    reasoning: `由于 ${digit} 必须在宫内出现一次，它只能落在这条对角线与宫的交叉区域内。`,
                    conclusion: `从${describeUnit(diagonal)}上宫外的其他位置删除候选数 ${digit}。`,
                },
            })
        }
    }
    return null
}

/**
 * 对角线认领：对角线上某候选全部落在同一宫内，
 * 则该宫其余位置可删除该候选。（Sudoku X Box/Line Reduction）
 */
export function findDiagonalClaiming(board: MutableBoard): SolveStep | null {
    if (board.variant !== 'x') return null
    for (const diagonal of DIAGONALS) {
        for (const digit of DIGITS) {
            const cells = diagonal.cells.filter(
                (cell) =>
                    board.values[cell] === 0 &&
                    digitInMask(board.candidates[cell], digit),
            )
            if (cells.length < 2) continue

            const boxes = uniqueNumbers(
                cells.map(
                    (cell) =>
                        Math.floor(Math.floor(cell / 9) / 3) * 3 +
                        Math.floor((cell % 9) / 3),
                ),
            )
            if (boxes.length !== 1) continue
            const box = BOXES[boxes[0]]

            const removed = box.cells
                .filter(
                    (cell) =>
                        !diagonal.cells.includes(cell) &&
                        board.values[cell] === 0 &&
                        digitInMask(board.candidates[cell], digit),
                )
                .map((cell) => ({ cell, digit }))
            if (removed.length === 0) continue

            return stepFor(currentDefinition('diagonal-claiming'), {
                id: `diagonal-claiming-${diagonal.index}-${box.index}-${digit}`,
                action: 'eliminate',
                unit: unitRef(diagonal),
                digit,
                digits: [digit],
                cells,
                focusCells: cells,
                relatedCells: uniqueNumbers([...box.cells, ...diagonal.cells]),
                evidence: cells.map((cell) => ({ cell, digit })),
                removed,
                links: [],
                explanation: {
                    premise: `${describeUnit(diagonal)}上的候选数 ${digit} 全部位于同一宫。`,
                    reasoning: `由于 ${digit} 必须在这条对角线上出现一次，它只能由这些宫内交叉位置承担。`,
                    conclusion: `从该宫中对角线以外的其他位置删除候选数 ${digit}。`,
                },
            })
        }
    }
    return null
}

/**
 * 对角线矩形（Pointing Pairs special to Sudoku X）：
 * 对角线上两个同候选位置构成矩形对角，二者必有一真，
 * 且同时看向矩形另外两角，可从那两角删除该候选。
 */
export function findDiagonalRectangle(board: MutableBoard): SolveStep | null {
    if (board.variant !== 'x') return null
    for (const diagonal of DIAGONALS) {
        for (const digit of DIGITS) {
            const cells = diagonal.cells.filter(
                (cell) =>
                    board.values[cell] === 0 &&
                    digitInMask(board.candidates[cell], digit),
            )
            // 对角线上的该候选恰好剩两处（共轭对）时，二者必有一真。
            if (cells.length !== 2) continue
            for (const [left, right] of combinations(cells, 2)) {
                const rowLeft = Math.floor(left / 9)
                const columnLeft = left % 9
                const rowRight = Math.floor(right / 9)
                const columnRight = right % 9
                if (rowLeft === rowRight || columnLeft === columnRight) continue

                // 矩形的另外两角：与 left 同行/同列且与 right 同列/同行。
                const corners = [
                    rowLeft * 9 + columnRight,
                    rowRight * 9 + columnLeft,
                ]
                const removed = corners
                    .filter(
                        (cell) =>
                            board.values[cell] === 0 &&
                            digitInMask(board.candidates[cell], digit),
                    )
                    .map((cell) => ({ cell, digit }))
                if (removed.length === 0) continue

                return stepFor(currentDefinition('diagonal-rectangle'), {
                    id: `diagonal-rectangle-${diagonal.index}-${left}-${right}-${digit}`,
                    action: 'eliminate',
                    unit: unitRef(diagonal),
                    digit,
                    digits: [digit],
                    cells: [left, right],
                    focusCells: [left, right],
                    relatedCells: uniqueNumbers([
                        ...corners,
                        ...diagonal.cells,
                    ]),
                    evidence: [
                        { cell: left, digit },
                        { cell: right, digit },
                    ],
                    removed,
                    links: [],
                    explanation: {
                        premise: `${toCellName(left)} 与 ${toCellName(right)} 都含候选数 ${digit}，且位于${describeUnit(diagonal)}上，构成矩形的对角。`,
                        reasoning: `二者必有一个填入 ${digit}，而矩形的另外两角同时与这两个位置互见。`,
                        conclusion: `从矩形另外两角删除候选数 ${digit}。`,
                    },
                })
            }
        }
    }
    return null
}

function subsetName(size: number) {
    return size === 2 ? '数对' : size === 3 ? '三数组' : '四数组'
}
function findNakedSubset(
    board: MutableBoard,
    size: 2 | 3 | 4,
    techniqueId: TechniqueId,
): SolveStep | null {
    for (const unit of unitsOf(board)) {
        const candidateCells = unit.cells.filter((cell) => {
            const count = countBits(board.candidates[cell])
            return board.values[cell] === 0 && count >= 2 && count <= size
        })
        for (const cells of combinations(candidateCells, size)) {
            const mask = cells.reduce(
                (union, cell) => union | board.candidates[cell],
                0,
            )
            if (countBits(mask) !== size) continue
            const digits = maskToDigits(mask)
            const removed = unit.cells.flatMap((cell) => {
                if (cells.includes(cell) || board.values[cell] !== 0) return []
                return maskToDigits(board.candidates[cell] & mask).map(
                    (digit) => ({
                        cell,
                        digit,
                    }),
                )
            })
            if (removed.length === 0) continue

            return stepFor(currentDefinition(techniqueId), {
                id: `${techniqueId}-${unit.kind}-${unit.index}-${cells.join('-')}`,
                action: 'eliminate',
                unit: unitRef(unit),
                digits,
                cells,
                focusCells: cells,
                relatedCells: [...unit.cells],
                evidence: refsForCells(board, cells),
                removed,
                links: [],
                explanation: {
                    premise: `${cells.map(toCellName).join('、')} 的候选并集恰好是 ${digits.join('、')}。`,
                    reasoning: `这 ${size} 个数字必须占据这 ${size} 个单元格，构成裸${subsetName(size)}。`,
                    conclusion: `从同一单位的其他单元格删除这些候选数。`,
                },
            })
        }
    }
    return null
}

function findHiddenSubset(
    board: MutableBoard,
    size: 2 | 3 | 4,
    techniqueId: TechniqueId,
): SolveStep | null {
    for (const unit of unitsOf(board)) {
        for (const digits of combinations<Digit>(DIGITS, size)) {
            if (
                digits.some((digit) =>
                    unit.cells.some((cell) => board.values[cell] === digit),
                )
            ) {
                continue
            }
            const cells = unit.cells.filter(
                (cell) =>
                    board.values[cell] === 0 &&
                    digits.some((digit) =>
                        digitInMask(board.candidates[cell], digit),
                    ),
            )
            if (
                cells.length !== size ||
                digits.some(
                    (digit) =>
                        !cells.some((cell) =>
                            digitInMask(board.candidates[cell], digit),
                        ),
                )
            ) {
                continue
            }

            const keepMask = digits.reduce(
                (mask, digit) => mask | bit(digit),
                0,
            )
            const removed = cells.flatMap((cell) =>
                maskToDigits(board.candidates[cell] & ~keepMask).map(
                    (digit) => ({
                        cell,
                        digit,
                    }),
                ),
            )
            if (removed.length === 0) continue

            return stepFor(currentDefinition(techniqueId), {
                id: `${techniqueId}-${unit.kind}-${unit.index}-${digits.join('-')}`,
                action: 'eliminate',
                unit: unitRef(unit),
                digits,
                cells,
                focusCells: cells,
                relatedCells: [...unit.cells],
                evidence: cells.flatMap((cell) =>
                    digits
                        .filter((digit) =>
                            digitInMask(board.candidates[cell], digit),
                        )
                        .map((digit) => ({ cell, digit })),
                ),
                removed,
                links: [],
                explanation: {
                    premise: `数字 ${digits.join('、')} 在这个单位中只出现在 ${cells.map(toCellName).join('、')}。`,
                    reasoning: `它们必须占据这些单元格，构成隐性${subsetName(size)}。`,
                    conclusion: `从这些单元格删除不属于该组合的其他候选数。`,
                },
            })
        }
    }
    return null
}

function findFish(
    board: MutableBoard,
    size: 2 | 3 | 4,
    techniqueId: TechniqueId,
): SolveStep | null {
    const orientations = [
        { bases: ROWS, covers: COLUMNS, baseName: '行', coverName: '列' },
        { bases: COLUMNS, covers: ROWS, baseName: '列', coverName: '行' },
    ] as const

    for (const digit of DIGITS) {
        for (const orientation of orientations) {
            const eligible = orientation.bases.filter((unit) => {
                const count = unit.cells.filter(
                    (cell) =>
                        board.values[cell] === 0 &&
                        digitInMask(board.candidates[cell], digit),
                ).length
                return count >= 2 && count <= size
            })

            for (const bases of combinations(eligible, size)) {
                const coverIndexes = uniqueNumbers(
                    bases.flatMap((base) =>
                        base.cells
                            .filter(
                                (cell) =>
                                    board.values[cell] === 0 &&
                                    digitInMask(board.candidates[cell], digit),
                            )
                            .map((cell) =>
                                base.kind === 'row'
                                    ? cell % 9
                                    : Math.floor(cell / 9),
                            ),
                    ),
                )
                if (coverIndexes.length !== size) continue
                const baseIndexes = new Set(bases.map((base) => base.index))
                const patternCells = bases.flatMap((base) =>
                    base.cells.filter(
                        (cell) =>
                            board.values[cell] === 0 &&
                            digitInMask(board.candidates[cell], digit),
                    ),
                )
                const removed = coverIndexes.flatMap((coverIndex) =>
                    orientation.covers[coverIndex].cells
                        .filter((cell) => {
                            const baseIndex =
                                bases[0].kind === 'row'
                                    ? Math.floor(cell / 9)
                                    : cell % 9
                            return (
                                !baseIndexes.has(baseIndex) &&
                                board.values[cell] === 0 &&
                                digitInMask(board.candidates[cell], digit)
                            )
                        })
                        .map((cell) => ({ cell, digit })),
                )
                if (removed.length === 0) continue

                return stepFor(currentDefinition(techniqueId), {
                    id: `${techniqueId}-${bases[0].kind}-${digit}-${bases
                        .map((base) => base.index)
                        .join('-')}`,
                    action: 'eliminate',
                    digit,
                    digits: [digit],
                    cells: patternCells,
                    focusCells: patternCells,
                    relatedCells: uniqueNumbers([
                        ...bases.flatMap((base) => base.cells),
                        ...coverIndexes.flatMap(
                            (coverIndex) =>
                                orientation.covers[coverIndex].cells,
                        ),
                    ]),
                    evidence: patternCells.map((cell) => ({ cell, digit })),
                    removed,
                    links: [],
                    explanation: {
                        premise: `候选数 ${digit} 在 ${size} 个基础${orientation.baseName}中只分布于 ${size} 个覆盖${orientation.coverName}。`,
                        reasoning: `无论 ${digit} 在这些基础单位中如何排列，每个覆盖单位都必须承担一次。`,
                        conclusion: `从覆盖${orientation.coverName}的其他位置删除候选数 ${digit}。`,
                    },
                })
            }
        }
    }
    return null
}

function findXyWing(board: MutableBoard): SolveStep | null {
    const bivalueCells = Array.from({ length: 81 }, (_, cell) => cell).filter(
        (cell) =>
            board.values[cell] === 0 && countBits(board.candidates[cell]) === 2,
    )

    for (const pivot of bivalueCells) {
        const pivotDigits = maskToDigits(board.candidates[pivot])
        const wings = peersOf(board)[pivot].filter(
            (cell) =>
                board.values[cell] === 0 &&
                countBits(board.candidates[cell]) === 2 &&
                countBits(board.candidates[cell] & board.candidates[pivot]) ===
                    1,
        )
        for (const [left, right] of combinations(wings, 2)) {
            const leftMask = board.candidates[left]
            const rightMask = board.candidates[right]
            const union = leftMask | rightMask | board.candidates[pivot]
            const commonWingMask = leftMask & rightMask
            if (
                countBits(union) !== 3 ||
                countBits(commonWingMask) !== 1 ||
                (commonWingMask & board.candidates[pivot]) !== 0
            ) {
                continue
            }
            const [eliminationDigit] = maskToDigits(commonWingMask)
            const removed = commonPeers([left, right], board.variant)
                .filter(
                    (cell) =>
                        cell !== pivot &&
                        board.values[cell] === 0 &&
                        digitInMask(board.candidates[cell], eliminationDigit),
                )
                .map((cell) => ({ cell, digit: eliminationDigit }))
            if (removed.length === 0) continue
            const cells = [pivot, left, right]
            const links: ChainLink[] = [
                {
                    from: {
                        cell: pivot,
                        digit: pivotDigits.find((digit) =>
                            digitInMask(leftMask, digit),
                        )!,
                    },
                    to: {
                        cell: left,
                        digit: pivotDigits.find((digit) =>
                            digitInMask(leftMask, digit),
                        )!,
                    },
                    type: 'weak',
                },
                {
                    from: {
                        cell: pivot,
                        digit: pivotDigits.find((digit) =>
                            digitInMask(rightMask, digit),
                        )!,
                    },
                    to: {
                        cell: right,
                        digit: pivotDigits.find((digit) =>
                            digitInMask(rightMask, digit),
                        )!,
                    },
                    type: 'weak',
                },
            ]
            return stepFor(currentDefinition('xy-wing'), {
                id: `xy-wing-${pivot}-${left}-${right}-${eliminationDigit}`,
                action: 'eliminate',
                digit: eliminationDigit,
                digits: maskToDigits(union),
                cells,
                focusCells: cells,
                relatedCells: uniqueNumbers([
                    ...peersOf(board)[pivot],
                    ...peersOf(board)[left],
                    ...peersOf(board)[right],
                ]),
                evidence: refsForCells(board, cells),
                removed,
                links,
                explanation: {
                    premise: `${toCellName(pivot)} 是双值枢轴，两翼分别通过一个候选与它相连。`,
                    reasoning: `无论枢轴取哪个值，两翼之一都必须取 ${eliminationDigit}。`,
                    conclusion: `同时看见两翼的单元格不能再保留候选数 ${eliminationDigit}。`,
                },
            })
        }
    }
    return null
}

function findXyzWing(board: MutableBoard): SolveStep | null {
    const pivots = Array.from({ length: 81 }, (_, cell) => cell).filter(
        (cell) =>
            board.values[cell] === 0 && countBits(board.candidates[cell]) === 3,
    )

    for (const pivot of pivots) {
        const pivotMask = board.candidates[pivot]
        const wings = peersOf(board)[pivot].filter(
            (cell) =>
                board.values[cell] === 0 &&
                countBits(board.candidates[cell]) === 2 &&
                (board.candidates[cell] & ~pivotMask) === 0,
        )
        for (const [left, right] of combinations(wings, 2)) {
            const leftMask = board.candidates[left]
            const rightMask = board.candidates[right]
            const shared = leftMask & rightMask
            if (
                (leftMask | rightMask) !== pivotMask ||
                countBits(shared) !== 1 ||
                leftMask === rightMask
            ) {
                continue
            }
            const [eliminationDigit] = maskToDigits(shared)
            const removed = commonPeers([pivot, left, right], board.variant)
                .filter(
                    (cell) =>
                        board.values[cell] === 0 &&
                        digitInMask(board.candidates[cell], eliminationDigit),
                )
                .map((cell) => ({ cell, digit: eliminationDigit }))
            if (removed.length === 0) continue
            const cells = [pivot, left, right]
            return stepFor(currentDefinition('xyz-wing'), {
                id: `xyz-wing-${pivot}-${left}-${right}-${eliminationDigit}`,
                action: 'eliminate',
                digit: eliminationDigit,
                digits: maskToDigits(pivotMask),
                cells,
                focusCells: cells,
                relatedCells: uniqueNumbers([
                    ...peersOf(board)[pivot],
                    ...peersOf(board)[left],
                    ...peersOf(board)[right],
                ]),
                evidence: refsForCells(board, cells),
                removed,
                links: [],
                explanation: {
                    premise: `${toCellName(pivot)} 的三个候选由两个双值翼覆盖。`,
                    reasoning: `枢轴和两翼中至少有一个必须取共同候选 ${eliminationDigit}。`,
                    conclusion: `同时看见这三个单元格的位置可删除候选数 ${eliminationDigit}。`,
                },
            })
        }
    }
    return null
}

function strongLinksForDigit(board: MutableBoard, digit: Digit) {
    const links: Array<readonly [number, number]> = []
    const seen = new Set<string>()
    for (const unit of unitsOf(board)) {
        const cells = unit.cells.filter(
            (cell) =>
                board.values[cell] === 0 &&
                digitInMask(board.candidates[cell], digit),
        )
        if (cells.length !== 2) continue
        const ordered = [...cells].sort((left, right) => left - right)
        const key = `${ordered[0]}-${ordered[1]}`
        if (seen.has(key)) continue
        seen.add(key)
        links.push([ordered[0], ordered[1]])
    }
    return links
}

function linksForStrongGraph(
    digit: Digit,
    edges: ReadonlyArray<readonly [number, number]>,
): ChainLink[] {
    return edges.map(([left, right]) => ({
        from: { cell: left, digit },
        to: { cell: right, digit },
        type: 'strong',
    }))
}

function findSimpleColoring(board: MutableBoard): SolveStep | null {
    for (const digit of DIGITS) {
        const edges = strongLinksForDigit(board, digit)
        const adjacency = new Map<number, number[]>()
        for (const [left, right] of edges) {
            adjacency.set(left, [...(adjacency.get(left) ?? []), right])
            adjacency.set(right, [...(adjacency.get(right) ?? []), left])
        }

        const globallyVisited = new Set<number>()
        for (const start of [...adjacency.keys()].sort((a, b) => a - b)) {
            if (globallyVisited.has(start)) continue
            const colors = new Map<number, 0 | 1>([[start, 0]])
            const queue = [start]
            while (queue.length > 0) {
                const cell = queue.shift()!
                globallyVisited.add(cell)
                for (const peer of adjacency.get(cell) ?? []) {
                    if (!colors.has(peer)) {
                        colors.set(peer, colors.get(cell) === 0 ? 1 : 0)
                        queue.push(peer)
                    }
                }
            }
            if (colors.size < 3) continue
            const groups = [
                [...colors.entries()]
                    .filter(([, color]) => color === 0)
                    .map(([cell]) => cell),
                [...colors.entries()]
                    .filter(([, color]) => color === 1)
                    .map(([cell]) => cell),
            ] as const
            const componentEdges = edges.filter(
                ([left, right]) => colors.has(left) && colors.has(right),
            )

            for (let color = 0; color <= 1; color += 1) {
                const group = groups[color]
                const contradiction = combinations(group, 2).some(
                    ([left, right]) =>
                        cellsSeeEachOther(left, right, board.variant),
                )
                if (!contradiction) continue
                const removed = group
                    .filter((cell) =>
                        digitInMask(board.candidates[cell], digit),
                    )
                    .map((cell) => ({ cell, digit }))
                if (removed.length === 0) continue
                const cells = [...colors.keys()].sort((a, b) => a - b)
                return stepFor(currentDefinition('simple-coloring'), {
                    id: `simple-coloring-wrap-${digit}-${start}-${color}`,
                    action: 'eliminate',
                    digit,
                    digits: [digit],
                    cells,
                    focusCells: group,
                    relatedCells: uniqueNumbers(
                        cells.flatMap((cell) => peersOf(board)[cell]),
                    ),
                    evidence: cells.map((cell) => ({ cell, digit })),
                    removed,
                    links: linksForStrongGraph(digit, componentEdges),
                    explanation: {
                        premise: `候选数 ${digit} 的共轭对形成了两色交替链。`,
                        reasoning: `同一颜色中有两个候选互相可见，因此这一整组颜色不可能为真。`,
                        conclusion: `删除该颜色上的全部候选数 ${digit}。`,
                    },
                })
            }

            const component = new Set(colors.keys())
            const removed = Array.from({ length: 81 }, (_, cell) => cell)
                .filter(
                    (cell) =>
                        !component.has(cell) &&
                        board.values[cell] === 0 &&
                        digitInMask(board.candidates[cell], digit) &&
                        groups[0].some((colored) =>
                            cellsSeeEachOther(cell, colored, board.variant),
                        ) &&
                        groups[1].some((colored) =>
                            cellsSeeEachOther(cell, colored, board.variant),
                        ),
                )
                .map((cell) => ({ cell, digit }))
            if (removed.length === 0) continue
            const cells = [...colors.keys()].sort((a, b) => a - b)
            return stepFor(currentDefinition('simple-coloring'), {
                id: `simple-coloring-trap-${digit}-${start}`,
                action: 'eliminate',
                digit,
                digits: [digit],
                cells,
                focusCells: cells,
                relatedCells: uniqueNumbers(
                    cells.flatMap((cell) => peersOf(board)[cell]),
                ),
                evidence: cells.map((cell) => ({ cell, digit })),
                removed,
                links: linksForStrongGraph(digit, componentEdges),
                explanation: {
                    premise: `候选数 ${digit} 的共轭对形成了两色交替链。`,
                    reasoning: `目标候选同时看见两种颜色，而两色中必有一种为真。`,
                    conclusion: `这些目标位置不能保留候选数 ${digit}。`,
                },
            })
        }
    }
    return null
}

function edgeKey(left: number, right: number) {
    return left < right ? `${left}-${right}` : `${right}-${left}`
}

function findXChain(board: MutableBoard): SolveStep | null {
    for (const digit of DIGITS) {
        const nodes = Array.from({ length: 81 }, (_, cell) => cell).filter(
            (cell) =>
                board.values[cell] === 0 &&
                digitInMask(board.candidates[cell], digit),
        )
        const strongEdges = strongLinksForDigit(board, digit)
        const strongKeys = new Set(
            strongEdges.map(([left, right]) => edgeKey(left, right)),
        )

        for (const start of nodes) {
            const visit = (
                path: number[],
                expectStrong: boolean,
            ): SolveStep | null => {
                if (path.length >= 12) return null
                const current = path[path.length - 1]
                for (const next of peersOf(board)[current]) {
                    if (
                        path.includes(next) ||
                        !digitInMask(board.candidates[next], digit)
                    ) {
                        continue
                    }
                    const isStrong = strongKeys.has(edgeKey(current, next))
                    if (expectStrong && !isStrong) continue
                    const nextPath = [...path, next]
                    const nextExpectStrong = !expectStrong

                    if (!nextExpectStrong && nextPath.length >= 4) {
                        const removed = commonPeers(
                            [start, next],
                            board.variant,
                        )
                            .filter(
                                (cell) =>
                                    !nextPath.includes(cell) &&
                                    board.values[cell] === 0 &&
                                    digitInMask(board.candidates[cell], digit),
                            )
                            .map((cell) => ({ cell, digit }))
                        if (removed.length > 0) {
                            const links: ChainLink[] = nextPath
                                .slice(0, -1)
                                .map((cell, index) => ({
                                    from: { cell, digit },
                                    to: { cell: nextPath[index + 1], digit },
                                    type:
                                        index % 2 === 0
                                            ? ('strong' as const)
                                            : ('weak' as const),
                                }))
                            return stepFor(currentDefinition('x-chain'), {
                                id: `x-chain-${digit}-${nextPath.join('-')}`,
                                action: 'eliminate',
                                digit,
                                digits: [digit],
                                cells: nextPath,
                                focusCells: [start, next],
                                relatedCells: uniqueNumbers(
                                    nextPath.flatMap(
                                        (cell) => peersOf(board)[cell],
                                    ),
                                ),
                                evidence: nextPath.map((cell) => ({
                                    cell,
                                    digit,
                                })),
                                removed,
                                links,
                                explanation: {
                                    premise: `候选数 ${digit} 构成一条强链、弱链交替的 X-Chain。`,
                                    reasoning: `链的两个端点不可能同时为假，所以至少有一个端点为真。`,
                                    conclusion: `同时看见两个端点的位置可删除候选数 ${digit}。`,
                                },
                            })
                        }
                    }

                    const found = visit(nextPath, nextExpectStrong)
                    if (found) return found
                }
                return null
            }
            const found = visit([start], true)
            if (found) return found
        }
    }
    return null
}

function findXyChain(board: MutableBoard): SolveStep | null {
    const bivalue = Array.from({ length: 81 }, (_, cell) => cell).filter(
        (cell) =>
            board.values[cell] === 0 && countBits(board.candidates[cell]) === 2,
    )

    for (const start of bivalue) {
        for (const endpointDigit of maskToDigits(board.candidates[start])) {
            const [firstLinkDigit] = maskToDigits(
                board.candidates[start] & ~bit(endpointDigit),
            )
            const visit = (
                path: number[],
                linkDigits: Digit[],
                requiredDigit: Digit,
            ): SolveStep | null => {
                if (path.length >= 12) return null
                const current = path[path.length - 1]
                for (const next of bivalue) {
                    if (
                        path.includes(next) ||
                        !cellsSeeEachOther(current, next, board.variant) ||
                        !digitInMask(board.candidates[next], requiredDigit)
                    ) {
                        continue
                    }
                    const [nextRequired] = maskToDigits(
                        board.candidates[next] & ~bit(requiredDigit),
                    )
                    const nextPath = [...path, next]
                    const nextLinks = [...linkDigits, requiredDigit]

                    if (
                        nextRequired === endpointDigit &&
                        nextPath.length >= 3
                    ) {
                        const removed = commonPeers(
                            [start, next],
                            board.variant,
                        )
                            .filter(
                                (cell) =>
                                    !nextPath.includes(cell) &&
                                    board.values[cell] === 0 &&
                                    digitInMask(
                                        board.candidates[cell],
                                        endpointDigit,
                                    ),
                            )
                            .map((cell) => ({ cell, digit: endpointDigit }))
                        if (removed.length > 0) {
                            const links: ChainLink[] = []
                            for (
                                let index = 0;
                                index < nextPath.length - 1;
                                index += 1
                            ) {
                                const shared = nextLinks[index]
                                links.push({
                                    from: {
                                        cell: nextPath[index],
                                        digit: shared,
                                    },
                                    to: {
                                        cell: nextPath[index + 1],
                                        digit: shared,
                                    },
                                    type: 'weak',
                                })
                                if (index + 1 < nextPath.length - 1) {
                                    const [other] = maskToDigits(
                                        board.candidates[nextPath[index + 1]] &
                                            ~bit(shared),
                                    )
                                    links.push({
                                        from: {
                                            cell: nextPath[index + 1],
                                            digit: shared,
                                        },
                                        to: {
                                            cell: nextPath[index + 1],
                                            digit: other,
                                        },
                                        type: 'strong',
                                    })
                                }
                            }
                            return stepFor(currentDefinition('xy-chain'), {
                                id: `xy-chain-${endpointDigit}-${nextPath.join('-')}`,
                                action: 'eliminate',
                                digit: endpointDigit,
                                digits: uniqueNumbers(
                                    nextPath.flatMap((cell) =>
                                        maskToDigits(board.candidates[cell]),
                                    ),
                                ) as Digit[],
                                cells: nextPath,
                                focusCells: [start, next],
                                relatedCells: uniqueNumbers(
                                    nextPath.flatMap(
                                        (cell) => peersOf(board)[cell],
                                    ),
                                ),
                                evidence: refsForCells(board, nextPath),
                                removed,
                                links,
                                explanation: {
                                    premise: `一串双值格通过共享候选形成 XY-Chain，端点共同包含 ${endpointDigit}。`,
                                    reasoning: `若起点不取 ${endpointDigit}，链式强制会让终点取 ${endpointDigit}；反向亦然。`,
                                    conclusion: `同时看见两个端点的位置可删除候选数 ${endpointDigit}。`,
                                },
                            })
                        }
                    }
                    const found = visit(nextPath, nextLinks, nextRequired)
                    if (found) return found
                }
                return null
            }
            const found = visit([start], [], firstLinkDigit)
            if (found) return found
        }
    }
    return null
}

function candidateNodeId({ cell, digit }: CandidateRef) {
    return cell * 9 + digit - 1
}

function candidatesHaveWeakLink(
    left: CandidateRef,
    right: CandidateRef,
    variant: MutableBoard['variant'],
) {
    return (
        (left.cell === right.cell && left.digit !== right.digit) ||
        (left.digit === right.digit &&
            left.cell !== right.cell &&
            cellsSeeEachOther(left.cell, right.cell, variant))
    )
}

function findAic(board: MutableBoard): SolveStep | null {
    const nodes = Array.from({ length: 81 }, (_, cell) =>
        board.values[cell] === 0
            ? maskToDigits(board.candidates[cell]).map((digit) => ({
                  cell,
                  digit,
              }))
            : [],
    )
        .flat()
        .sort((left, right) => candidateNodeId(left) - candidateNodeId(right))
    const nodeById = new Map(
        nodes.map((candidate) => [candidateNodeId(candidate), candidate]),
    )
    const strongAdjacency = new Map<number, Set<number>>()
    const addStrongLink = (left: CandidateRef, right: CandidateRef) => {
        const leftId = candidateNodeId(left)
        const rightId = candidateNodeId(right)
        strongAdjacency.set(
            leftId,
            new Set([...(strongAdjacency.get(leftId) ?? []), rightId]),
        )
        strongAdjacency.set(
            rightId,
            new Set([...(strongAdjacency.get(rightId) ?? []), leftId]),
        )
    }

    for (let cell = 0; cell < 81; cell += 1) {
        if (
            board.values[cell] !== 0 ||
            countBits(board.candidates[cell]) !== 2
        ) {
            continue
        }
        const [left, right] = maskToDigits(board.candidates[cell])
        addStrongLink({ cell, digit: left }, { cell, digit: right })
    }

    for (const unit of unitsOf(board)) {
        for (const digit of DIGITS) {
            if (unit.cells.some((cell) => board.values[cell] === digit))
                continue
            const cells = unit.cells.filter(
                (cell) =>
                    board.values[cell] === 0 &&
                    digitInMask(board.candidates[cell], digit),
            )
            if (cells.length === 2) {
                addStrongLink(
                    { cell: cells[0], digit },
                    { cell: cells[1], digit },
                )
            }
        }
    }

    const weakAdjacency = new Map<number, number[]>()
    for (const left of nodes) {
        const linked = nodes
            .filter(
                (right) =>
                    candidateNodeId(left) !== candidateNodeId(right) &&
                    candidatesHaveWeakLink(left, right, board.variant),
            )
            .map(candidateNodeId)
            .sort((a, b) => a - b)
        weakAdjacency.set(candidateNodeId(left), linked)
    }

    const maximumNodes = 24
    for (const start of nodes) {
        const startId = candidateNodeId(start)
        const visit = (
            pathIds: number[],
            edgeTypes: Array<'strong' | 'weak'>,
            expectStrong: boolean,
        ): SolveStep | null => {
            if (pathIds.length >= maximumNodes) return null
            const currentId = pathIds[pathIds.length - 1]
            const adjacent = expectStrong
                ? [...(strongAdjacency.get(currentId) ?? [])].sort(
                      (a, b) => a - b,
                  )
                : (weakAdjacency.get(currentId) ?? [])

            for (const nextId of adjacent) {
                if (pathIds.includes(nextId)) continue
                const nextPath = [...pathIds, nextId]
                const nextEdges = [
                    ...edgeTypes,
                    expectStrong ? ('strong' as const) : ('weak' as const),
                ]
                const nextExpectStrong = !expectStrong

                // An AIC that starts and ends with a strong link has endpoints that
                // cannot both be false. Any candidate weak-linked to both is false.
                if (nextExpectStrong === false && nextPath.length >= 4) {
                    const endpoint = nodeById.get(nextId)!
                    const pathSet = new Set(nextPath)
                    const removed = nodes.filter(
                        (candidate) =>
                            !pathSet.has(candidateNodeId(candidate)) &&
                            candidatesHaveWeakLink(
                                candidate,
                                start,
                                board.variant,
                            ) &&
                            candidatesHaveWeakLink(
                                candidate,
                                endpoint,
                                board.variant,
                            ),
                    )
                    if (removed.length > 0) {
                        const path = nextPath.map((id) => nodeById.get(id)!)
                        const links: ChainLink[] = nextEdges.map(
                            (type, index) => ({
                                from: path[index],
                                to: path[index + 1],
                                type,
                            }),
                        )
                        const cells = uniqueNumbers(
                            path.map(({ cell }) => cell),
                        )
                        return stepFor(currentDefinition('aic'), {
                            id: `aic-${nextPath.join('-')}`,
                            action: 'eliminate',
                            digits: uniqueNumbers(
                                path.map(({ digit }) => digit),
                            ) as Digit[],
                            cells,
                            focusCells: [start.cell, endpoint.cell],
                            relatedCells: uniqueNumbers([
                                ...cells,
                                ...removed.map(({ cell }) => cell),
                            ]),
                            evidence: path,
                            removed,
                            links,
                            explanation: {
                                premise: `从 ${toCellName(start.cell)}(${start.digit}) 到 ${toCellName(endpoint.cell)}(${endpoint.digit}) 构成强、弱链接严格交替的 AIC。`,
                                reasoning:
                                    '链首尾都是强链接，因此两个端点不可能同时为假，至少一个端点必须为真。',
                                conclusion:
                                    '同时与两个端点弱相连的候选必为假，可以删除。',
                            },
                        })
                    }
                }

                const found = visit(nextPath, nextEdges, nextExpectStrong)
                if (found) return found
            }
            return null
        }

        const found = visit([startId], [], true)
        if (found) return found
    }
    return null
}

const TECHNIQUES: RegisteredTechnique[] = [
    define(
        {
            id: 'naked-single',
            label: '裸单',
            weight: 10,
            category: 'basic',
            description: '单元格只剩一个合法候选数。',
        },
        findNakedSingle,
    ),
    define(
        {
            id: 'hidden-single',
            label: '隐性唯一数',
            weight: 20,
            category: 'basic',
            description: '某个数字在一个单位中只剩一个可放置位置。',
        },
        findHiddenSingle,
    ),
    define(
        {
            id: 'locked-candidate-pointing',
            label: '区块摒除（指向）',
            weight: 30,
            category: 'intersection',
            description: '宫内某候选集中在同一行或列，可删除宫外同线候选。',
        },
        findPointing,
    ),
    define(
        {
            id: 'locked-candidate-claiming',
            label: '区块摒除（认领）',
            weight: 31,
            category: 'intersection',
            description: '行或列内某候选集中在同一宫，可删除宫内线外候选。',
        },
        findClaiming,
    ),
    define(
        {
            id: 'diagonal-pointing',
            label: '对角线指向',
            weight: 32,
            category: 'diagonal',
            description:
                '宫内某候选全部落在同一条对角线上，可删除该对角线宫外位置的候选。',
        },
        findDiagonalPointing,
    ),
    define(
        {
            id: 'diagonal-claiming',
            label: '对角线认领',
            weight: 33,
            category: 'diagonal',
            description:
                '对角线上某候选集中在同一宫，可删除该宫对角线外位置的候选。',
        },
        findDiagonalClaiming,
    ),
    define(
        {
            id: 'diagonal-rectangle',
            label: '对角线矩形',
            weight: 34,
            category: 'diagonal',
            description:
                '对角线上的共轭对构成矩形对角，删除矩形另外两角的同一候选。',
        },
        findDiagonalRectangle,
    ),
    define(
        {
            id: 'naked-pair',
            label: '裸数对',
            weight: 40,
            category: 'subset',
            description: '两个单元格的候选并集恰好包含两个数字。',
        },
        (board) => findNakedSubset(board, 2, 'naked-pair'),
    ),
    define(
        {
            id: 'hidden-pair',
            label: '隐性数对',
            weight: 45,
            category: 'subset',
            description: '两个数字在一个单位中只出现在两个单元格。',
        },
        (board) => findHiddenSubset(board, 2, 'hidden-pair'),
    ),
    define(
        {
            id: 'naked-triple',
            label: '裸三数组',
            weight: 50,
            category: 'subset',
            description: '三个单元格的候选并集恰好包含三个数字。',
        },
        (board) => findNakedSubset(board, 3, 'naked-triple'),
    ),
    define(
        {
            id: 'hidden-triple',
            label: '隐性三数组',
            weight: 55,
            category: 'subset',
            description: '三个数字在一个单位中只出现在三个单元格。',
        },
        (board) => findHiddenSubset(board, 3, 'hidden-triple'),
    ),
    define(
        {
            id: 'naked-quad',
            label: '裸四数组',
            weight: 60,
            category: 'subset',
            description: '四个单元格的候选并集恰好包含四个数字。',
        },
        (board) => findNakedSubset(board, 4, 'naked-quad'),
    ),
    define(
        {
            id: 'hidden-quad',
            label: '隐性四数组',
            weight: 65,
            category: 'subset',
            description: '四个数字在一个单位中只出现在四个单元格。',
        },
        (board) => findHiddenSubset(board, 4, 'hidden-quad'),
    ),
    define(
        {
            id: 'x-wing',
            label: 'X-Wing',
            weight: 80,
            category: 'fish',
            description: '两个基础单位中的同一候选锁定在两个覆盖单位。',
        },
        (board) => findFish(board, 2, 'x-wing'),
    ),
    define(
        {
            id: 'xy-wing',
            label: 'XY-Wing',
            weight: 90,
            category: 'wing',
            description: '一个双值枢轴连接两个双值翼，形成共同消除候选。',
        },
        findXyWing,
    ),
    define(
        {
            id: 'xyz-wing',
            label: 'XYZ-Wing',
            weight: 100,
            category: 'wing',
            description: '三值枢轴与两个双值翼共同锁定一个候选。',
        },
        findXyzWing,
    ),
    define(
        {
            id: 'swordfish',
            label: 'Swordfish',
            weight: 110,
            category: 'fish',
            description: '三个基础单位中的同一候选锁定在三个覆盖单位。',
        },
        (board) => findFish(board, 3, 'swordfish'),
    ),
    define(
        {
            id: 'simple-coloring',
            label: '简单染色',
            weight: 120,
            category: 'chain',
            description: '沿共轭对进行两色标记，利用颜色矛盾或颜色陷阱消除。',
        },
        findSimpleColoring,
    ),
    define(
        {
            id: 'x-chain',
            label: 'X-Chain',
            weight: 130,
            category: 'chain',
            description: '同一候选沿强弱链接交替传播。',
        },
        findXChain,
    ),
    define(
        {
            id: 'xy-chain',
            label: 'XY-Chain',
            weight: 140,
            category: 'chain',
            description: '双值格通过共享候选形成多数字交替链。',
        },
        findXyChain,
    ),
    define(
        {
            id: 'jellyfish',
            label: 'Jellyfish',
            weight: 150,
            category: 'fish',
            description: '四个基础单位中的同一候选锁定在四个覆盖单位。',
        },
        (board) => findFish(board, 4, 'jellyfish'),
    ),
    define(
        {
            id: 'aic',
            label: 'AIC 强弱链',
            weight: 160,
            category: 'chain',
            description:
                '候选文字沿强、弱链接交替连接，以首尾至少一真排除共同弱邻居。',
        },
        findAic,
    ),
]

for (const technique of TECHNIQUES) {
    definitionById.set(technique.id, technique)
}

export const TECHNIQUE_CATALOG: readonly TechniqueDefinition[] = TECHNIQUES.map(
    ({ find: _find, ...definition }) => definition,
)

export function findNextRegisteredStep(board: MutableBoard) {
    for (const technique of TECHNIQUES) {
        const step = technique.find(board)
        if (step) return step
    }
    return null
}
