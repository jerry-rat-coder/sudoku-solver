export const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

export type Digit = (typeof DIGITS)[number]
export type UnitKind = 'row' | 'column' | 'box' | 'diagonal'
export type PuzzleVariant = 'classic' | 'x' | 'antiknight'
export type TechniqueCategory =
    | 'basic'
    | 'intersection'
    | 'subset'
    | 'fish'
    | 'wing'
    | 'chain'
    | 'forcing'
    | 'diagonal'
    | 'antiknight'
    | 'killer'

export type TechniqueId =
    | 'naked-single'
    | 'hidden-single'
    | 'locked-candidate-pointing'
    | 'locked-candidate-claiming'
    | 'diagonal-pointing'
    | 'diagonal-claiming'
    | 'diagonal-rectangle'
    | 'knight-pointing'
    | 'knight-claiming'
    | 'knight-pair'
    | 'naked-pair'
    | 'hidden-pair'
    | 'naked-triple'
    | 'hidden-triple'
    | 'naked-quad'
    | 'hidden-quad'
    | 'x-wing'
    | 'swordfish'
    | 'jellyfish'
    | 'xy-wing'
    | 'xyz-wing'
    | 'simple-coloring'
    | 'x-chain'
    | 'xy-chain'
    | 'aic'
    | 'nishio-chain'
    | 'forcing-net'
    | 'killer-cage-combination'
    | 'killer-constraint-search'

export interface CandidateRef {
    cell: number
    digit: Digit
}

export interface UnitRef {
    kind: UnitKind
    index: number
}

export interface Unit extends UnitRef {
    cells: readonly number[]
}

export interface BoardSnapshot {
    values: readonly number[]
    candidates: readonly number[]
}

export interface ChainLink {
    from: CandidateRef
    to: CandidateRef
    type: 'strong' | 'weak' | 'implication'
}

export interface ProofLiteral {
    candidate: CandidateRef
    state: 'true' | 'false'
    role: 'origin' | 'derived' | 'conflict'
    reason: 'origin' | 'weak-link' | 'cell-single' | 'unit-single' | 'branch'
    parents: readonly number[]
    unit?: UnitRef
}

export interface ProofConflict {
    kind: 'candidate' | 'cell' | 'unit'
    message: string
    cells: readonly number[]
    nodeIndexes: readonly number[]
    unit?: UnitRef
    digit?: Digit
}

export interface ForcingProof {
    mode: 'nishio' | 'net'
    assumption: CandidateRef
    conclusion: CandidateRef
    contradiction: string
    path: readonly CandidateRef[]
    literals: readonly ProofLiteral[]
    conflict?: ProofConflict
    exploredBranches: number
    maxDepth: number
}

export interface StepExplanation {
    premise: string
    reasoning: string
    conclusion: string
}

export interface SolveStep {
    id: string
    technique: TechniqueId
    category: TechniqueCategory
    label: string
    weight: number
    action: 'place' | 'eliminate'
    variant?: PuzzleVariant
    unit?: UnitRef
    digit?: Digit
    digits: readonly Digit[]
    cells: readonly number[]
    focusCells: readonly number[]
    relatedCells: readonly number[]
    evidence: readonly CandidateRef[]
    removed: readonly CandidateRef[]
    placed?: CandidateRef
    links: readonly ChainLink[]
    proof?: ForcingProof
    explanation: StepExplanation
}

export interface ValidationIssue {
    message: string
    cells: readonly number[]
}

export interface SolveResult {
    status: 'solved' | 'stuck' | 'invalid'
    snapshots: readonly BoardSnapshot[]
    steps: readonly SolveStep[]
    issues: readonly ValidationIssue[]
}

export interface SolveOptions {
    candidatePolicy?: 'recompute' | 'respect'
    candidates?: readonly number[]
    variant?: PuzzleVariant
}

export interface MutableBoard {
    values: number[]
    candidates: number[]
    variant: PuzzleVariant
}

export interface TechniqueDefinition {
    id: TechniqueId
    label: string
    weight: number
    category: TechniqueCategory
    description: string
}

export const FULL_MASK = 0b111111111
export const bit = (digit: number) => 1 << (digit - 1)

export const ROWS: readonly Unit[] = Array.from({ length: 9 }, (_, row) => ({
    kind: 'row',
    index: row,
    cells: Array.from({ length: 9 }, (_, column) => row * 9 + column),
}))

export const COLUMNS: readonly Unit[] = Array.from(
    { length: 9 },
    (_, column) => ({
        kind: 'column',
        index: column,
        cells: Array.from({ length: 9 }, (_, row) => row * 9 + column),
    }),
)

export const BOXES: readonly Unit[] = Array.from({ length: 9 }, (_, box) => {
    const rowStart = Math.floor(box / 3) * 3
    const columnStart = (box % 3) * 3
    return {
        kind: 'box',
        index: box,
        cells: Array.from(
            { length: 9 },
            (_, offset) =>
                (rowStart + Math.floor(offset / 3)) * 9 +
                columnStart +
                (offset % 3),
        ),
    }
})

/** 两条对角线：index 0 主对角线（左上→右下），index 1 副对角线（右上→左下）。 */
export const DIAGONALS: readonly Unit[] = [
    {
        kind: 'diagonal',
        index: 0,
        cells: Array.from({ length: 9 }, (_, offset) => offset * 9 + offset),
    },
    {
        kind: 'diagonal',
        index: 1,
        cells: Array.from(
            { length: 9 },
            (_, offset) => offset * 9 + (8 - offset),
        ),
    },
]

const CLASSIC_UNITS: readonly Unit[] = [...ROWS, ...COLUMNS, ...BOXES]

const X_UNITS: readonly Unit[] = [...CLASSIC_UNITS, ...DIAGONALS]

function buildCellUnits(units: readonly Unit[]) {
    return Array.from({ length: 81 }, (_, cell) =>
        units.filter((unit) => unit.cells.includes(cell)),
    )
}

function buildPeers(cellUnits: readonly (readonly Unit[])[]) {
    return Array.from({ length: 81 }, (_, cell) =>
        [...new Set(cellUnits[cell].flatMap((unit) => [...unit.cells]))]
            .filter((peer) => peer !== cell)
            .sort((left, right) => left - right),
    )
}

/** 马步（象棋日字）的 8 个偏移：行差 2 列差 1，或行差 1 列差 2。 */
export const KNIGHT_MOVE_OFFSETS: readonly (readonly [number, number])[] = [
    [-2, -1],
    [-2, 1],
    [-1, -2],
    [-1, 2],
    [1, -2],
    [1, 2],
    [2, -1],
    [2, 1],
]

/** 单元格的马步互见格（最多 8 个），按升序排列。 */
export function knightPeersOf(cell: number): readonly number[] {
    const row = Math.floor(cell / 9)
    const column = cell % 9
    return KNIGHT_MOVE_OFFSETS.flatMap(([rowOffset, columnOffset]) => {
        const nextRow = row + rowOffset
        const nextColumn = column + columnOffset
        return nextRow >= 0 && nextRow < 9 && nextColumn >= 0 && nextColumn < 9
            ? [nextRow * 9 + nextColumn]
            : []
    }).sort((left, right) => left - right)
}

/** 两个单元格是否构成马步互见。 */
export function isKnightAdjacent(left: number, right: number) {
    return knightPeersOf(left).includes(right)
}

const CLASSIC_CELL_UNITS = buildCellUnits(CLASSIC_UNITS)
const X_CELL_UNITS = buildCellUnits(X_UNITS)
const CLASSIC_PEERS = buildPeers(CLASSIC_CELL_UNITS)
const X_PEERS = buildPeers(X_CELL_UNITS)
const ANTINIGHT_PEERS: readonly (readonly number[])[] = Array.from(
    { length: 81 },
    (_, cell) =>
        [...new Set([...CLASSIC_PEERS[cell], ...knightPeersOf(cell)])].sort(
            (left, right) => left - right,
        ),
)

export const UNITS: readonly Unit[] = CLASSIC_UNITS

export const CELL_UNITS: readonly (readonly Unit[])[] = CLASSIC_CELL_UNITS

export const PEERS: readonly (readonly number[])[] = CLASSIC_PEERS

export function unitsForVariant(variant: PuzzleVariant = 'classic') {
    return variant === 'x' ? X_UNITS : CLASSIC_UNITS
}

export function cellUnitsForVariant(variant: PuzzleVariant = 'classic') {
    return variant === 'x' ? X_CELL_UNITS : CLASSIC_CELL_UNITS
}

export function peersForVariant(variant: PuzzleVariant = 'classic') {
    if (variant === 'x') return X_PEERS
    if (variant === 'antiknight') return ANTINIGHT_PEERS
    return CLASSIC_PEERS
}

export function boardUnits(board: Pick<MutableBoard, 'variant'>) {
    return unitsForVariant(board.variant)
}

export function boardPeers(board: Pick<MutableBoard, 'variant'>) {
    return peersForVariant(board.variant)
}

export function toCellName(cell: number) {
    return `R${Math.floor(cell / 9) + 1}C${(cell % 9) + 1}`
}

export function describeUnit(unit?: UnitRef) {
    if (!unit) return ''
    if (unit.kind === 'diagonal') {
        return unit.index === 0 ? '主对角线' : '副对角线'
    }
    const names: Record<'row' | 'column' | 'box', string> = {
        row: '行',
        column: '列',
        box: '宫',
    }
    return `第 ${unit.index + 1} ${names[unit.kind]}`
}

export function maskToDigits(mask: number): Digit[] {
    return DIGITS.filter((digit) => (mask & bit(digit)) !== 0)
}

export function digitInMask(mask: number, digit: number) {
    return (mask & bit(digit)) !== 0
}

export function countBits(mask: number) {
    let value = mask
    let count = 0
    while (value > 0) {
        value &= value - 1
        count += 1
    }
    return count
}

export function cloneBoard(board: MutableBoard): MutableBoard {
    return {
        values: [...board.values],
        candidates: [...board.candidates],
        variant: board.variant,
    }
}

export function snapshot(board: MutableBoard): BoardSnapshot {
    return {
        values: [...board.values],
        candidates: [...board.candidates],
    }
}

export function createBoard(
    input: readonly number[],
    candidateOverrides?: readonly number[],
    variant: PuzzleVariant = 'classic',
): MutableBoard {
    const values = Array.from({ length: 81 }, (_, index) => {
        const value = Number(input[index] ?? 0)
        return Number.isInteger(value) && value >= 1 && value <= 9 ? value : 0
    })

    const peers = peersForVariant(variant)
    const candidates = values.map((value, cell) => {
        if (value !== 0) return 0
        const used = peers[cell].reduce((mask, peer) => {
            const peerValue = values[peer]
            return peerValue ? mask | bit(peerValue) : mask
        }, 0)
        const legalMask = FULL_MASK & ~used
        const override = Number(candidateOverrides?.[cell] ?? 0)
        return Number.isInteger(override) &&
            override > 0 &&
            override <= FULL_MASK
            ? legalMask & override
            : legalMask
    })

    return { values, candidates, variant }
}

export function conflictCellsForValues(
    input: readonly number[],
    variant: PuzzleVariant = 'classic',
) {
    const conflicts = new Set<number>()
    for (const unit of unitsForVariant(variant)) {
        const cellsByDigit = new Map<number, number[]>()
        for (const cell of unit.cells) {
            const value = input[cell] ?? 0
            if (!value) continue
            const cells = cellsByDigit.get(value) ?? []
            cells.push(cell)
            cellsByDigit.set(value, cells)
        }
        for (const cells of cellsByDigit.values()) {
            if (cells.length > 1) cells.forEach((cell) => conflicts.add(cell))
        }
    }
    // 无马规则：马步互见的两格不能同数（单位扫描不覆盖马步对）。
    if (variant === 'antiknight') {
        for (let cell = 0; cell < 81; cell += 1) {
            const value = input[cell] ?? 0
            if (!value) continue
            for (const peer of knightPeersOf(cell)) {
                if ((input[peer] ?? 0) === value) {
                    conflicts.add(cell)
                    conflicts.add(peer)
                }
            }
        }
    }
    return conflicts
}

export function validateBoard(
    board: MutableBoard,
    rawInput?: readonly number[],
): ValidationIssue[] {
    const issues: ValidationIssue[] = []

    if (
        rawInput &&
        (rawInput.length !== 81 ||
            rawInput.some(
                (value) =>
                    !Number.isInteger(Number(value)) ||
                    Number(value) < 0 ||
                    Number(value) > 9,
            ))
    ) {
        issues.push({
            message: '题目必须恰好包含 81 个 0 到 9 之间的整数。',
            cells: [],
        })
    }

    const conflicts = conflictCellsForValues(board.values, board.variant)
    if (conflicts.size > 0) {
        issues.push({
            message:
                board.variant === 'x'
                    ? '盘面中存在同行、同列、同宫或同对角线的重复数字。'
                    : board.variant === 'antiknight'
                      ? '盘面中存在同行、同列、同宫或马步互见的重复数字。'
                      : '盘面中存在同行、同列或同宫的重复数字。',
            cells: [...conflicts].sort((left, right) => left - right),
        })
    }

    const impossible = board.values
        .map((value, cell) => ({ value, cell }))
        .filter(
            ({ value, cell }) => value === 0 && board.candidates[cell] === 0,
        )
        .map(({ cell }) => cell)
    if (impossible.length > 0) {
        issues.push({
            message: '部分空格已经没有合法候选数，请检查题目或推理链。',
            cells: impossible,
        })
    }

    const missingPlaces = unitsForVariant(board.variant).flatMap((unit) =>
        DIGITS.filter(
            (digit) =>
                !unit.cells.some((cell) => board.values[cell] === digit) &&
                !unit.cells.some(
                    (cell) =>
                        board.values[cell] === 0 &&
                        digitInMask(board.candidates[cell], digit),
                ),
        ).map(() => unit),
    )
    if (missingPlaces.length > 0) {
        issues.push({
            message: '至少一个单位中的数字已经没有可放置的位置。',
            cells: [
                ...new Set(missingPlaces.flatMap((unit) => unit.cells)),
            ].sort((left, right) => left - right),
        })
    }

    return issues
}

export function applyStep(board: MutableBoard, step: SolveStep): MutableBoard {
    const next = cloneBoard(board)
    const peers = peersForVariant(board.variant)

    if (step.action === 'place' && step.placed) {
        const { cell, digit } = step.placed
        next.values[cell] = digit
        next.candidates[cell] = 0
        for (const peer of peers[cell]) {
            if (next.values[peer] === 0) {
                next.candidates[peer] &= ~bit(digit)
            }
        }
        return next
    }

    for (const { cell, digit } of step.removed) {
        if (next.values[cell] === 0) {
            next.candidates[cell] &= ~bit(digit)
        }
    }
    return next
}

export function isSolved(board: MutableBoard) {
    if (board.values.some((value) => value === 0)) return false
    return conflictCellsForValues(board.values, board.variant).size === 0
}

export function cellsSeeEachOther(
    left: number,
    right: number,
    variant: PuzzleVariant = 'classic',
) {
    return peersForVariant(variant)[left].includes(right)
}

export function commonPeers(
    cells: readonly number[],
    variant: PuzzleVariant = 'classic',
) {
    if (cells.length === 0) return []
    const peers = peersForVariant(variant)
    return peers[cells[0]].filter((peer) =>
        cells.slice(1).every((cell) => peers[cell].includes(peer)),
    )
}

export function combinations<T>(values: readonly T[], size: number): T[][] {
    const result: T[][] = []
    const build = (start: number, selected: T[]) => {
        if (selected.length === size) {
            result.push([...selected])
            return
        }
        for (
            let index = start;
            index <= values.length - (size - selected.length);
            index += 1
        ) {
            selected.push(values[index])
            build(index + 1, selected)
            selected.pop()
        }
    }
    build(0, [])
    return result
}
