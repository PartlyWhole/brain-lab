/**
 * An expression shown as a nested chip.
 *
 * A chip is a button. Clicking it (or pressing Enter on it) opens a picker that
 * replaces it with a chosen shape. An unfilled operand is a `hole`, rendered as
 * an explicit "fill this in" chip: a draft, never an error, because not having
 * finished is not a mistake.
 *
 * Everything here works by clicking or by keyboard. Nothing requires dragging.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { Expr } from '../program/types'
import { hole, newId, ARITH_OPS, COMPARE_OPS } from '../program/types'
import type { Problem } from '../program/edit'

export interface ExprChipProps {
  expr: Expr
  availableNames: string[]
  problems: Problem[]
  readOnly?: boolean
  /** What this operand is for, e.g. "the list to add to". Used in the hole label. */
  role?: string
  onReplace: (exprId: string, next: Expr) => void
}

const SHAPES = [
  { id: 'name', label: 'a name', hint: 'Use whatever this name refers to right now' },
  { id: 'int', label: 'a number', hint: 'A whole number' },
  { id: 'str', label: 'some text', hint: 'Letters and words' },
  { id: 'bool', label: 'True or False', hint: 'An answer to a comparison' },
  { id: 'list', label: 'a new list', hint: 'Starts empty' },
  { id: 'arith', label: 'add or subtract', hint: 'Work out a new number' },
  { id: 'compare', label: 'compare two things', hint: 'Answers True or False' },
  { id: 'index', label: 'a slot of a list', hint: 'Read one slot by its number' },
  { id: 'call', label: 'how many / total', hint: 'len, sum, max, min' },
] as const

/**
 * Words for the operators.
 *
 * The visual method reads as a sentence — "weight is bigger than limit" — while
 * the Python reveal shows `weight > limit`. Seeing the same instruction in both
 * notations is the point of the reveal, so the visual side is written the way a
 * child would say it out loud.
 */
const OPERATOR_WORDS: Record<string, string> = {
  '>': 'is bigger than',
  '<': 'is smaller than',
  '>=': 'is at least',
  '<=': 'is at most',
  '==': 'is the same as',
  '!=': 'is not the same as',
  '+': 'plus',
  '-': 'minus',
  '*': 'times',
  '//': 'divided by',
  '%': 'remainder of',
}

export function ExprChip(props: ExprChipProps) {
  const { expr, problems, readOnly, role, onReplace } = props
  const [picking, setPicking] = useState(false)
  const problem = problems.find((p) => p.nodeId === expr.id)

  const open = () => { if (!readOnly) setPicking(true) }

  const picker = picking ? (
    <ShapePicker
      expr={expr}
      availableNames={props.availableNames}
      onClose={() => setPicking(false)}
      onChoose={(next) => { onReplace(expr.id, next); setPicking(false) }}
    />
  ) : null

  // A comparison or a calculation reads as a phrase, so the operator sits
  // *between* its operands and is itself the control that changes it. A
  // leading wrapper chip would force "only if is weight > limit".
  if (expr.kind === 'compare' || expr.kind === 'arith') {
    return (
      <span className="chip-wrap chip-wrap--infix">
        <ExprChip {...props} expr={expr.left}
          role={expr.kind === 'compare' ? 'the first thing' : 'the first number'} />
        <span className="chip-wrap">
          <button
            type="button"
            className={`chip chip--operator${problem ? ' chip--error' : ''}`}
            onClick={open}
            disabled={readOnly}
            aria-label={`${OPERATOR_WORDS[expr.op] ?? expr.op}. Change this.`}
          >
            {OPERATOR_WORDS[expr.op] ?? expr.op}
          </button>
          {picker}
        </span>
        <ExprChip {...props} expr={expr.right}
          role={expr.kind === 'compare' ? 'the second thing' : 'the second number'} />
      </span>
    )
  }

  const label = describeChip(expr, role)
  const tone = expr.kind === 'hole' ? 'draft' : problem?.severity === 'error' ? 'error' : 'filled'

  return (
    <span className="chip-wrap">
      <button
        type="button"
        className={`chip chip--${tone} chip--${expr.kind}`}
        onClick={open}
        disabled={readOnly}
        aria-describedby={problem ? `${expr.id}-problem` : undefined}
      >
        {expr.kind === 'hole' && <span aria-hidden="true" className="chip__mark">+</span>}
        <span className="chip__label">{label}</span>
      </button>

      {/* Children render outside the button so they stay independently clickable. */}
      {renderChildren(props)}

      {problem && (
        <span id={`${expr.id}-problem`} className={`chip__problem chip__problem--${problem.severity}`}>
          {problem.message}
        </span>
      )}

      {picker}
    </span>
  )
}

function renderChildren(props: ExprChipProps) {
  const { expr } = props
  const child = (e: Expr, role: string) => (
    <ExprChip {...props} key={e.id} expr={e} role={role} />
  )
  switch (expr.kind) {
    case 'list':
      return expr.items.length === 0 ? null : (
        <span className="chip__children">{expr.items.map((e) => child(e, 'an item'))}</span>
      )
    case 'index':
      return (
        <span className="chip__children">
          {child(expr.target, 'the list')}
          <span className="chip__op" aria-hidden="true">slot</span>
          {child(expr.index, 'the slot number')}
        </span>
      )
    case 'call':
      return (
        <span className="chip__children">
          {expr.args.map((e) => child(e, 'the list'))}
        </span>
      )
    default:
      return null
  }
}

function describeChip(expr: Expr, role?: string): string {
  switch (expr.kind) {
    case 'hole': return role ? `${role}…` : expr.label ? `${expr.label}…` : 'fill this in…'
    case 'int': return expr.text
    case 'str': return `“${expr.value}”`
    case 'bool': return expr.value ? 'True' : 'False'
    case 'none': return 'None'
    case 'name': return expr.name || 'a name…'
    case 'list': return expr.items.length === 0 ? 'a new empty list' : 'a new list of'
    case 'arith':
    case 'compare': return OPERATOR_WORDS[expr.op] ?? expr.op
    case 'index': return 'read'
    case 'call': return CALL_LABELS[expr.fn]
  }
}

const CALL_LABELS: Record<string, string> = {
  len: 'how many in', sum: 'the total of', max: 'the biggest in',
  min: 'the smallest in', abs: 'the size of', range: 'the numbers up to',
  str: 'as text', int: 'as a number',
}

/* ------------------------------------------------------------------ */

function ShapePicker({
  expr, availableNames, onChoose, onClose,
}: {
  expr: Expr
  availableNames: string[]
  onChoose: (next: Expr) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const [stage, setStage] = useState<'shape' | 'name' | 'int' | 'str' | 'call'>('shape')
  const [draft, setDraft] = useState('')

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button, input')?.focus()
  }, [stage])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [onClose])

  const pickShape = (shape: (typeof SHAPES)[number]['id']) => {
    switch (shape) {
      case 'name':
        setStage('name'); break
      case 'int':
        setStage('int'); break
      case 'str':
        setStage('str'); break
      case 'call':
        setStage('call'); break
      case 'bool':
        onChoose({ kind: 'bool', id: newId('e'), value: true }); break
      case 'list':
        onChoose({ kind: 'list', id: newId('e'), items: [] }); break
      case 'arith':
        onChoose({ kind: 'arith', id: newId('e'), op: '+', left: hole(), right: hole() }); break
      case 'compare':
        onChoose({ kind: 'compare', id: newId('e'), op: '>', left: hole(), right: hole() }); break
      case 'index':
        onChoose({ kind: 'index', id: newId('e'), target: hole(), index: hole() }); break
    }
  }

  return (
    <div className="picker" ref={ref} role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <p className="picker__title" id={titleId}>
        {stage === 'shape' ? 'What goes here?' : 'Choose'}
      </p>

      {stage === 'shape' && (expr.kind === 'compare' || expr.kind === 'arith') && (
        <>
          <p className="picker__section">Change the question</p>
          <ul className="picker__list">
            {(expr.kind === 'compare' ? COMPARE_OPS : ARITH_OPS).map((op) => (
              <li key={op}>
                <button
                  type="button"
                  aria-pressed={op === expr.op}
                  onClick={() => onChoose({ ...expr, op } as Expr)}
                >
                  <span className="picker__label">{OPERATOR_WORDS[op] ?? op}</span>
                  <span className="picker__hint">{op}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="picker__section">Or replace it entirely</p>
        </>
      )}

      {stage === 'shape' && (
        <ul className="picker__list">
          {SHAPES.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => pickShape(s.id)}>
                <span className="picker__label">{s.label}</span>
                <span className="picker__hint">{s.hint}</span>
              </button>
            </li>
          ))}
          {expr.kind !== 'hole' && (
            <li>
              <button type="button" className="picker__clear" onClick={() => onChoose(hole())}>
                <span className="picker__label">clear this</span>
                <span className="picker__hint">Put the empty space back</span>
              </button>
            </li>
          )}
        </ul>
      )}

      {stage === 'name' && (
        <ul className="picker__list">
          {availableNames.length === 0 && <li className="picker__empty">No names yet.</li>}
          {availableNames.map((n) => (
            <li key={n}>
              <button type="button"
                onClick={() => onChoose({ kind: 'name', id: newId('e'), name: n })}>
                <span className="picker__label">{n}</span>
                <span className="picker__hint">whatever {n} refers to now</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {(stage === 'int' || stage === 'str') && (
        <form
          className="picker__form"
          onSubmit={(e) => {
            e.preventDefault()
            if (stage === 'int') {
              if (!/^-?\d+$/.test(draft.trim())) return
              onChoose({ kind: 'int', id: newId('e'), text: draft.trim() })
            } else {
              onChoose({ kind: 'str', id: newId('e'), value: draft })
            }
          }}
        >
          <label>
            {stage === 'int' ? 'Which number?' : 'Which text?'}
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              inputMode={stage === 'int' ? 'numeric' : 'text'}
              maxLength={stage === 'int' ? 12 : 60}
            />
          </label>
          <button type="submit">Use it</button>
        </form>
      )}

      {stage === 'call' && (
        <ul className="picker__list">
          {(['len', 'sum', 'max', 'min'] as const).map((fn) => (
            <li key={fn}>
              <button type="button"
                onClick={() => onChoose({ kind: 'call', id: newId('e'), fn, args: [hole()] })}>
                <span className="picker__label">{CALL_LABELS[fn]}</span>
                <span className="picker__hint">{fn}(…)</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export { ARITH_OPS, COMPARE_OPS }
