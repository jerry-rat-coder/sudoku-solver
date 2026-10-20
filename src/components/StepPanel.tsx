import type { CSSProperties, ReactNode } from 'react'
import {
    describeUnit,
    toCellName,
    type SolveResult,
    type SolveStep,
    type TechniqueCategory,
} from '@/lib/sudoku/engine'

interface StepPanelProps {
    result: SolveResult | null
    stepIndex: number
    onFocusCell: (cell: number) => void
}

interface StepPlayerProps {
    result: SolveResult | null
    stepIndex: number
    onStepChange: (step: number) => void
}

function CellToken({
    cell,
    onFocus,
}: {
    cell: number
    onFocus: (cell: number) => void
}) {
    return (
        <button
            type="button"
            className="explanation-token"
            onClick={() => onFocus(cell)}
            title={`定位到${toCellName(cell)}`}
        >
            {toCellName(cell)}
        </button>
    )
}

function joinCells(cells: readonly number[], onFocus: (cell: number) => void) {
    return cells.map<ReactNode>((cell, index) => (
        <span key={cell}>
            {index > 0 ? '、' : ''}
            <CellToken cell={cell} onFocus={onFocus} />
        </span>
    ))
}

function StepExplanation({
    step,
    onFocusCell,
}: {
    step: SolveStep
    onFocusCell: (cell: number) => void
}) {
    const targetCell = step.placed?.cell ?? step.cells[0]
    const removedCells = [...new Set(step.removed.map(({ cell }) => cell))]
    const digits = step.digits.join('、')

    if (step.technique === 'naked-single') {
        return (
            <>
                <p>
                    观察 <CellToken cell={targetCell} onFocus={onFocusCell} />
                    ，它的同行、同列和同宫
                    {step.variant === 'x'
                        ? '以及同对角线'
                        : step.variant === 'antiknight'
                          ? '以及马步互见的位置'
                          : ''}
                    已经排除了其他数字。
                </p>
                <p>
                    该单元格只剩候选数 <strong>{step.digit}</strong>。
                </p>
                <p className="conclusion">
                    确定 <CellToken cell={targetCell} onFocus={onFocusCell} /> ={' '}
                    <strong>{step.digit}</strong>。
                </p>
            </>
        )
    }

    if (step.technique === 'hidden-single') {
        return (
            <>
                <p>
                    观察 <strong>{describeUnit(step.unit)}</strong>，数字{' '}
                    <strong>{step.digit}</strong> 的其他候选位置都已被排除。
                </p>
                <p>
                    因此，
                    <CellToken cell={targetCell} onFocus={onFocusCell} />{' '}
                    是这个单位中唯一可以填入 <strong>{step.digit}</strong>{' '}
                    的单元格。
                </p>
                <p className="conclusion">
                    确定 <CellToken cell={targetCell} onFocus={onFocusCell} /> ={' '}
                    <strong>{step.digit}</strong>。
                </p>
            </>
        )
    }

    if (step.technique === 'naked-pair') {
        return (
            <>
                <p>
                    在 <strong>{describeUnit(step.unit)}</strong> 中，
                    {joinCells(step.cells, onFocusCell)} 都只包含候选数{' '}
                    <strong>{digits}</strong>。
                </p>
                <p>
                    这两个数字必须分别占据这两个单元格，因此同一单位中的其他单元格不能再使用它们。
                </p>
                <p className="conclusion">
                    从 {joinCells(removedCells, onFocusCell)} 删除{' '}
                    <strong>{step.removed.length}</strong> 个候选。
                </p>
            </>
        )
    }

    if (step.technique === 'hidden-pair') {
        return (
            <>
                <p>
                    在 <strong>{describeUnit(step.unit)}</strong> 中，数字{' '}
                    <strong>{digits}</strong> 只可能出现在{' '}
                    {joinCells(step.cells, onFocusCell)}。
                </p>
                <p>
                    这两个单元格必须保留这组数字，因此其中的其他候选数可以排除。
                </p>
                <p className="conclusion">
                    从 {joinCells(removedCells, onFocusCell)} 删除{' '}
                    <strong>{step.removed.length}</strong> 个候选。
                </p>
            </>
        )
    }

    if (step.technique === 'diagonal-pointing') {
        const boxIndex =
            Math.floor(Math.floor(step.cells[0] / 9) / 3) * 3 +
            Math.floor((step.cells[0] % 9) / 3)
        return (
            <>
                <p>
                    在{' '}
                    <strong>
                        {describeUnit({ kind: 'box', index: boxIndex })}
                    </strong>
                    中，候选数 <strong>{step.digit}</strong> 全部落在{' '}
                    <strong>{describeUnit(step.unit)}</strong> 上（
                    {joinCells(step.cells, onFocusCell)}）。
                </p>
                <p>
                    对角线数独要求 {step.digit}{' '}
                    在这条对角线上恰好出现一次，而宫内又必须 填一个 {step.digit}
                    ，所以 {step.digit} 只能落在宫与对角线的交叉区域内。
                </p>
                <p className="conclusion">
                    从 {describeUnit(step.unit)} 上宫外的其他位置删除候选数{' '}
                    <strong>{step.digit}</strong>（
                    {joinCells(removedCells, onFocusCell)}）。
                </p>
            </>
        )
    }

    if (step.technique === 'diagonal-claiming') {
        return (
            <>
                <p>
                    在 <strong>{describeUnit(step.unit)}</strong> 上，候选数{' '}
                    <strong>{step.digit}</strong> 只出现在同一宫内（
                    {joinCells(step.cells, onFocusCell)}）。
                </p>
                <p>
                    对角线数独要求 {step.digit}{' '}
                    在这条对角线上恰好出现一次，因此它必定
                    被这些宫内交叉位置中的一个承担。
                </p>
                <p className="conclusion">
                    从该宫中对角线以外的其他位置删除候选数{' '}
                    <strong>{step.digit}</strong>（
                    {joinCells(removedCells, onFocusCell)}）。
                </p>
            </>
        )
    }

    if (step.technique === 'diagonal-rectangle') {
        return (
            <>
                <p>
                    在 <strong>{describeUnit(step.unit)}</strong> 上，候选数{' '}
                    <strong>{step.digit}</strong> 只剩{' '}
                    {joinCells(step.cells, onFocusCell)} 两处，二者必有一个填入{' '}
                    {step.digit}。
                </p>
                <p>
                    这两个位置恰好构成一个矩形的对角，而矩形的另外两角与它们全部互见：
                    无论哪一侧填入 {step.digit}，另一角都会与它冲突。
                </p>
                <p className="conclusion">
                    从矩形另外两角删除候选数 <strong>{step.digit}</strong>（
                    {joinCells(removedCells, onFocusCell)}）。
                </p>
            </>
        )
    }

    if (step.technique === 'knight-pointing') {
        const boxIndex =
            Math.floor(Math.floor(step.cells[0] / 9) / 3) * 3 +
            Math.floor((step.cells[0] % 9) / 3)
        return (
            <>
                <p>
                    在{' '}
                    <strong>
                        {describeUnit({ kind: 'box', index: boxIndex })}
                    </strong>
                    中，候选数 <strong>{step.digit}</strong> 只出现在{' '}
                    {joinCells(step.cells, onFocusCell)}。
                </p>
                <p>
                    这些位置全部与 {joinCells(removedCells, onFocusCell)}{' '}
                    马步互见。宫内必须填入一个 {step.digit}
                    ，但无马数独规定马步互见的两格不能同数， 因此无论{' '}
                    {step.digit} 落在其中哪一格，目标格都会与它冲突。
                </p>
                <p className="conclusion">
                    从 {joinCells(removedCells, onFocusCell)} 删除候选数{' '}
                    <strong>{step.digit}</strong>。
                </p>
            </>
        )
    }

    if (step.technique === 'knight-claiming') {
        return (
            <>
                <p>
                    在 <strong>{describeUnit(step.unit)}</strong> 中，候选数{' '}
                    <strong>{step.digit}</strong> 只出现在{' '}
                    {joinCells(step.cells, onFocusCell)}。
                </p>
                <p>
                    这些位置全部与 {joinCells(removedCells, onFocusCell)}{' '}
                    马步互见。这个单位必须填入一个 {step.digit}
                    ，但无马数独规定马步互见的两格不能同数， 因此无论{' '}
                    {step.digit} 落在其中哪一格，目标格都会与它冲突。
                </p>
                <p className="conclusion">
                    从 {joinCells(removedCells, onFocusCell)} 删除候选数{' '}
                    <strong>{step.digit}</strong>。
                </p>
            </>
        )
    }

    if (step.technique === 'knight-pair') {
        return (
            <>
                <p>
                    {joinCells(step.cells, onFocusCell)}{' '}
                    是马步互见的两格，且候选都恰好是 <strong>{digits}</strong>。
                </p>
                <p>
                    无马数独规定马步互见的两格不能同数，
                    所以这两个数字必须分别占据这两格（一格填 {step.digits[0]}，
                    另一格填 {step.digits[1]}）。
                </p>
                <p className="conclusion">
                    同时与这两格互见的 {joinCells(removedCells, onFocusCell)}{' '}
                    不能再填 {digits}，删除相应候选。
                </p>
            </>
        )
    }

    return (
        <>
            <p>{step.explanation.premise}</p>
            <p>{step.explanation.reasoning}</p>
            {step.cells.length > 0 ? (
                <p className="proof-cells">
                    证据位置：{joinCells(step.cells.slice(0, 12), onFocusCell)}
                    {step.cells.length > 12 ? ' 等' : ''}
                </p>
            ) : null}
            <p className="conclusion">{step.explanation.conclusion}</p>
        </>
    )
}

const CATEGORY_LABELS: Record<TechniqueCategory, string> = {
    basic: '基础落数',
    intersection: '区块交叉',
    subset: '候选数组',
    fish: '鱼形技巧',
    wing: '翼形技巧',
    chain: '强弱链',
    forcing: '链式反证',
    diagonal: '对角线技巧',
    antiknight: '无马技巧',
    killer: '杀手笼约束',
}

function ProofSummary({
    step,
    onFocusCell,
}: {
    step: SolveStep
    onFocusCell: (cell: number) => void
}) {
    if (!step.proof) return null
    const preview = step.proof.literals.slice(0, 14)
    return (
        <div className="proof-summary">
            <p className="section-label">
                {step.proof.mode === 'nishio' ? '真假候选因果链' : '证明树摘要'}
            </p>
            <div className="proof-path">
                {preview.map((literal, index) => (
                    <span
                        className={`proof-literal ${literal.state} ${literal.role}`}
                        key={`${literal.candidate.cell}-${literal.candidate.digit}-${literal.state}-${index}`}
                    >
                        <button
                            type="button"
                            onClick={() => onFocusCell(literal.candidate.cell)}
                            title={
                                literal.parents.length
                                    ? `由节点 ${literal.parents.map((parent) => parent + 1).join('、')} 推出`
                                    : '证明起点'
                            }
                        >
                            {toCellName(literal.candidate.cell)}
                            {literal.state === 'true' ? '=' : '≠'}
                            {literal.candidate.digit}
                        </button>
                    </span>
                ))}
                {step.proof.literals.length > preview.length ? (
                    <em>…</em>
                ) : null}
            </div>
            <p className="proof-stats">
                {step.proof.mode === 'nishio'
                    ? `共 ${step.proof.literals.length} 个可追溯候选文字；实线为强推导，虚线为弱排除。`
                    : `已核验 ${step.proof.exploredBranches} 个分支，最大嵌套深度 ${step.proof.maxDepth}`}
            </p>
            {step.proof.conflict ? (
                <p className="proof-conflict">
                    冲突：{step.proof.conflict.message}
                </p>
            ) : null}
        </div>
    )
}

function CandidateChanges({
    step,
    onFocusCell,
}: {
    step: SolveStep
    onFocusCell: (cell: number) => void
}) {
    if (step.placed) {
        return (
            <div className="change-row">
                <span>确定数字</span>
                <button
                    type="button"
                    onClick={() => onFocusCell(step.placed!.cell)}
                >
                    {toCellName(step.placed.cell)}
                </button>
                <strong>→ {step.placed.digit}</strong>
            </div>
        )
    }

    const grouped = new Map<number, number[]>()
    for (const { cell, digit } of step.removed) {
        grouped.set(cell, [...(grouped.get(cell) ?? []), digit])
    }

    return (
        <div className="change-list">
            {[...grouped.entries()].slice(0, 4).map(([cell, digits]) => (
                <div className="change-row" key={cell}>
                    <span>删除候选</span>
                    <button type="button" onClick={() => onFocusCell(cell)}>
                        {toCellName(cell)}
                    </button>
                    <strong>{digits.join('、')}</strong>
                </div>
            ))}
            {grouped.size > 4 ? (
                <p className="change-more">另有 {grouped.size - 4} 个单元格</p>
            ) : null}
        </div>
    )
}

export function StepPanel({ result, stepIndex, onFocusCell }: StepPanelProps) {
    const total = result?.steps.length ?? 0
    const step = result && stepIndex > 0 ? result.steps[stepIndex - 1] : null
    const atFinalStep = Boolean(result && stepIndex === total)

    return (
        <aside className="step-panel" aria-label="推演步骤">
            <div className="step-panel-header">
                <div>
                    <p className="eyebrow">HUMAN LOGIC</p>
                    <h2>
                        {result ? `步骤 ${stepIndex} / ${total}` : '等待推演'}
                    </h2>
                </div>
                <span className={`technique-badge ${step ? 'active' : ''}`}>
                    {step?.label ?? '基础技巧'}
                </span>
            </div>

            <div className="step-panel-body">
                {!result ? (
                    <div className="empty-explanation">
                        <span className="empty-mark">01</span>
                        <h3>从当前最简单的一步开始</h3>
                        <p>填写题目或载入示例后点击“开始推演”。</p>
                        <div className="technique-list" aria-label="当前技巧库">
                            <span>唯一数</span>
                            <span>区块摒除</span>
                            <span>2–4 数组</span>
                            <span>鱼形</span>
                            <span>翼形</span>
                            <span>AIC 强弱链</span>
                            <span>对角线技巧</span>
                            <span>无马技巧</span>
                            <span>西尾链</span>
                            <span>强制网</span>
                        </div>
                    </div>
                ) : result.status === 'invalid' ? (
                    <div className="result-message invalid">
                        <p className="eyebrow">INPUT CHECK</p>
                        <h3>盘面暂时无法推演</h3>
                        {result.issues.map((issue) => (
                            <p key={issue.message}>{issue.message}</p>
                        ))}
                        <p>返回编辑模式，修改红色标记的单元格后再试。</p>
                    </div>
                ) : result.status === 'stuck' && total === 0 ? (
                    <div className="result-message stuck">
                        <p className="eyebrow">LOGIC BOUNDARY</p>
                        <h3>当前局面没有可证明的下一步</h3>
                        <p>
                            盘面没有直接矛盾，但可能存在多个解，或需要比当前资源范围更深的证明网。
                        </p>
                    </div>
                ) : step ? (
                    <>
                        <div className="step-meta">
                            <span>复杂度权重 {step.weight}</span>
                            <span>{CATEGORY_LABELS[step.category]}</span>
                        </div>
                        <div className="reasoning-card">
                            <p className="eyebrow">本步推理</p>
                            <StepExplanation
                                step={step}
                                onFocusCell={onFocusCell}
                            />
                        </div>
                        <ProofSummary step={step} onFocusCell={onFocusCell} />
                        <div className="candidate-changes">
                            <p className="section-label">盘面变化</p>
                            <CandidateChanges
                                step={step}
                                onFocusCell={onFocusCell}
                            />
                        </div>
                        {atFinalStep ? (
                            <div
                                className={`result-strip ${
                                    result.status === 'solved'
                                        ? 'solved'
                                        : 'stuck'
                                }`}
                            >
                                <strong>
                                    {result.status === 'solved'
                                        ? '推演完成'
                                        : '当前技巧库已到边界'}
                                </strong>
                                <span>
                                    {result.status === 'solved'
                                        ? '每一步均由当前最低权重的可用逻辑技巧推出。'
                                        : '盘面有效，但没有找到可证明的下一步。'}
                                </span>
                            </div>
                        ) : null}
                    </>
                ) : (
                    <div className="empty-explanation initial">
                        <span className="empty-mark">00</span>
                        <h3>初始候选盘面</h3>
                        <p>
                            候选数已根据题目重新计算。向右移动一步即可查看第一条可验证推理。
                        </p>
                    </div>
                )}
            </div>
        </aside>
    )
}

export function StepPlayer({
    result,
    stepIndex,
    onStepChange,
}: StepPlayerProps) {
    const total = result?.steps.length ?? 0
    const sliderMax = Math.max(total, 1)

    return (
        <div className="player replay-player" aria-label="步骤播放控制">
            <input
                className="step-range"
                type="range"
                min={0}
                max={sliderMax}
                value={result ? stepIndex : 0}
                disabled={!result || total === 0}
                onChange={(event) => onStepChange(Number(event.target.value))}
                style={
                    {
                        '--progress': result
                            ? `${(stepIndex / sliderMax) * 100}%`
                            : '0%',
                    } as CSSProperties
                }
                aria-label="步骤进度"
            />
            <div className="range-label">
                <span>
                    {stepIndex === 0 ? '初始盘面' : `第 ${stepIndex} 步`}
                </span>
                <span>{total} 步</span>
            </div>

            <div className="player-buttons">
                <button
                    type="button"
                    onClick={() => onStepChange(total > 0 ? 1 : 0)}
                    disabled={!result || total === 0 || stepIndex === 1}
                    aria-label="跳到第一步"
                >
                    <span aria-hidden="true">|◀</span>
                    <small>第一步</small>
                </button>
                <button
                    type="button"
                    onClick={() => onStepChange(Math.max(0, stepIndex - 1))}
                    disabled={!result || stepIndex === 0}
                    aria-label="上一步"
                >
                    <span aria-hidden="true">‹</span>
                    <small>上一步</small>
                </button>
                <button
                    type="button"
                    className="primary"
                    onClick={() => onStepChange(Math.min(total, stepIndex + 1))}
                    disabled={!result || stepIndex >= total}
                    aria-label="下一步"
                >
                    <span aria-hidden="true">›</span>
                    <small>下一步</small>
                </button>
                <button
                    type="button"
                    onClick={() => onStepChange(total)}
                    disabled={!result || total === 0 || stepIndex === total}
                    aria-label="跳到最后一步"
                >
                    <span aria-hidden="true">▶|</span>
                    <small>最后一步</small>
                </button>
            </div>

            <p className="shortcut-hint">
                <kbd>←</kbd>
                <kbd>→</kbd> 切换步骤 · <kbd>Home</kbd>
                <kbd>End</kbd> 跳转
            </p>
        </div>
    )
}
