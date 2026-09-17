/**
 * Memory Sandbox — one screen.
 *
 * Make an object, give it a name, do something to it, watch memory change.
 * Nothing else: no missions, no grading, no saving.
 *
 * Every object is a real Python object in a worker, so binding, mutation and
 * aliasing are true because CPython made them true rather than because the
 * drawing agreed to show them.
 *
 * The whole state is the list of operations performed. Undo drops the last one
 * and replays the rest from empty, which reconstructs sharing exactly instead
 * of trying to reverse a mutation.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrainWorkspace } from '../brain/BrainWorkspace'
import type { BrainReference } from '../brain/layout'
import { dropAttr, useBrainDrag, type BrainDrag, type DragPayload, type DropTarget } from '../brain/drag'
import { getRuntime, type RuntimeStatus } from '../runtime/client'
import { describeObject, type Snapshot } from '../runtime/types'
import './sandbox.css'

type Command = Record<string, unknown>

interface WorkChip { slotId: string; label: string; objectId: string }
interface SandboxSnapshot extends Snapshot { workArea: WorkChip[]; output: string }

interface Reply {
  snapshot: SandboxSnapshot
  applied: { outcome: { description: string } }[]
  error: { message: string; hint: string | null } | null
}

const EMPTY: SandboxSnapshot = {
  objects: {}, scopes: [], outputLength: 0, truncated: false, workArea: [], output: '',
}

const OPERATORS = [
  { id: 'add', label: 'add', symbol: '+' },
  { id: '>', label: 'is bigger than', symbol: '>' },
  { id: '<', label: 'is smaller than', symbol: '<' },
  { id: '==', label: 'is the same as', symbol: '==' },
] as const

export function Sandbox() {
  const runtime = getRuntime()
  const [commands, setCommands] = useState<Command[]>([])
  const [reply, setReply] = useState<Reply | null>(null)
  const [status, setStatus] = useState<RuntimeStatus>(runtime.status)
  const [say, setSay] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // Palette values, so a number exists with the right value from the start —
  // an int cannot be edited afterwards, because ints are immutable.
  const [numberText, setNumberText] = useState('5')
  const [textValue, setTextValue] = useState('hello')

  const [naming, setNaming] = useState<{ ref: BrainReference; draft: string } | null>(null)
  /**
   * Click-to-pick-up, click-to-place: the same rules as dragging, for anyone
   * using a keyboard, a switch, or simply not wanting to drag. Dragging must
   * never be the only way to do something.
   */
  const [held, setHeld] = useState<DragPayload | null>(null)
  const [wells, setWells] = useState<(BrainReference | null)[]>([null, null])
  const [operator, setOperator] = useState<(typeof OPERATORS)[number]['id']>('add')

  useEffect(() => runtime.onStatus(setStatus), [runtime])
  useEffect(() => { void runtime.start().catch(() => {}) }, [runtime])

  const replay = useCallback(async (next: Command[]) => {
    try {
      const result = await runtime.manual('', next) as unknown as Reply
      setReply(result)
      if (result.error) {
        setProblem(result.error.hint
          ? `${result.error.message} ${result.error.hint}`
          : result.error.message)
      } else {
        setProblem(null)
        const last = result.applied[result.applied.length - 1]
        setSay(last ? last.outcome.description : null)
      }
    } catch (err) {
      setProblem((err as Error).message)
    }
  }, [runtime])

  useEffect(() => { void replay(commands) }, [commands, replay])

  const run = (command: Command) => setCommands((prev) => [...prev, command])

  const snapshot = reply?.snapshot ?? EMPTY

  /* -- what may be dropped where ------------------------------------- */

  const objectAt = (id: string) => snapshot.objects[id]

  const canDrop = useCallback((payload: DragPayload, target: DropTarget): boolean => {
    if (target.kind === 'canvas') return payload.kind === 'make'
    if (target.kind === 'well') return payload.kind === 'object' && !!payload.ref
    if (target.kind === 'slot') return payload.kind === 'object' && !!payload.ref
    if (target.kind === 'object') {
      if (payload.kind === 'name' || payload.kind === 'newName') return true
      if (payload.kind === 'object') {
        // Only a list can be appended to.
        return !!payload.ref && objectAt(target.objectId)?.type === 'list'
      }
    }
    return false
  }, [snapshot])

  const describe = useCallback((payload: DragPayload, target: DropTarget | null): string => {
    if (!target) return 'Drop it on something it can go on.'
    if (target.kind === 'canvas') return 'Make it.'
    if (target.kind === 'well') return 'Use this one in the sum.'
    if (target.kind === 'slot') return `Make slot ${target.index} point at this instead.`
    if (payload.kind === 'name') return `Point ${payload.name} at this object.`
    if (payload.kind === 'newName') return 'Give this object a name.'
    return 'Add it to the end of this list.'
  }, [])

  const onDrop = useCallback((payload: DragPayload, target: DropTarget) => {
    if (target.kind === 'canvas' && payload.kind === 'make') {
      if (payload.make === 'int') run({ op: 'makeInt', text: numberText.trim() || '0' })
      if (payload.make === 'str') run({ op: 'makeStr', value: textValue })
      if (payload.make === 'list') run({ op: 'makeList', items: [] })
      return
    }
    if (target.kind === 'object') {
      const targetRef = refForObject(target.objectId)
      if (!targetRef) return
      if (payload.kind === 'name') {
        run({ op: 'bind', name: payload.name, ref: targetRef })
      } else if (payload.kind === 'newName') {
        setNaming({ ref: targetRef, draft: '' })
      } else if (payload.kind === 'object' && payload.ref) {
        run({ op: 'append', target: targetRef, value: payload.ref })
      }
      return
    }
    if (target.kind === 'slot' && payload.kind === 'object' && payload.ref) {
      const targetRef = refForObject(target.objectId)
      if (targetRef) {
        run({ op: 'setSlot', target: targetRef, index: target.index, value: payload.ref })
      }
      return
    }
    if (target.kind === 'well' && payload.kind === 'object' && payload.ref) {
      setWells((prev) => {
        const next = [...prev]
        next[target.index] = payload.ref
        return next
      })
    }
  }, [numberText, textValue, snapshot])

  /** The shortest way to name an object: a bound name, else a work-area item. */
  const refForObject = useCallback((objectId: string): BrainReference | null => {
    for (const scope of snapshot.scopes) {
      const hit = scope.bindings.find((b) => b.objectId === objectId)
      if (hit) return { kind: 'name', name: hit.name }
    }
    const chip = snapshot.workArea.find((w) => w.objectId === objectId)
    if (chip) return { kind: 'work', slotId: chip.slotId }
    for (const obj of Object.values(snapshot.objects)) {
      if (obj.type !== 'list') continue
      const index = obj.slots.indexOf(objectId)
      if (index >= 0) {
        const parent = refForObject(obj.id)
        if (parent) return { kind: 'slot', target: parent, index }
      }
    }
    return null
  }, [snapshot])

  const objectIdForRef = useCallback((ref: BrainReference): string | null => {
    if (ref.kind === 'name') {
      for (const scope of snapshot.scopes) {
        const hit = scope.bindings.find((b) => b.name === ref.name)
        if (hit) return hit.objectId
      }
      return null
    }
    if (ref.kind === 'work') {
      return snapshot.workArea.find((w) => w.slotId === ref.slotId)?.objectId ?? null
    }
    const parentId = objectIdForRef(ref.target)
    if (!parentId) return null
    const parent = snapshot.objects[parentId]
    return parent?.type === 'list' ? parent.slots[ref.index] ?? null : null
  }, [snapshot])

  const place = useCallback((payload: DragPayload, target: DropTarget) => {
    if (!canDrop(payload, target)) {
      setProblem('That cannot go there.')
      return
    }
    onDrop(payload, target)
    setHeld(null)
  }, [canDrop, onDrop])

  /** A click in the workspace: pick something up, or put down what is held. */
  const onSelectReference = useCallback((ref: BrainReference) => {
    setProblem(null)
    // Replacing one slot is a click on that slot while holding an object.
    if (ref.kind === 'slot' && held?.kind === 'object') {
      const parentId = objectIdForRef(ref.target)
      if (parentId) place(held, { kind: 'slot', objectId: parentId, index: ref.index })
      return
    }
    const objectId = objectIdForRef(ref)
    if (!objectId) return
    if (held) {
      place(held, { kind: 'object', objectId })
      return
    }
    // Nothing held: clicking a name picks the name up, clicking anything else
    // picks up the object, which is what each one is for.
    setHeld(ref.kind === 'name'
      ? { kind: 'name', name: ref.name }
      : { kind: 'object', objectId, ref, label: describeObject(snapshot, objectId) })
  }, [held, objectIdForRef, place, snapshot])

  const dragConfig = useMemo(() => ({ canDrop, onDrop, describe }), [canDrop, onDrop, describe])
  // The sandbox owns the drag engine, so the palette and the bench start drags
  // through exactly the same mechanism the canvas uses.
  const drag = useBrainDrag(dragConfig)

  /* -- the operation bench -------------------------------------------- */

  const bothFilled = wells[0] && wells[1]
  const doOperation = () => {
    if (!wells[0] || !wells[1]) return
    run(operator === 'add'
      ? { op: 'add', left: wells[0], right: wells[1] }
      : { op: 'compare', operator, left: wells[0], right: wells[1] })
    setWells([null, null])
  }

  const describeRef = (ref: BrainReference | null): string => {
    if (!ref) return 'drop one here'
    if (ref.kind === 'name') return ref.name
    if (ref.kind === 'work') {
      return snapshot.workArea.find((w) => w.slotId === ref.slotId)?.label ?? 'that one'
    }
    return `slot ${ref.index}`
  }

  return (
    <div className="sb">
      <header className="sb__bar">
        <h1 className="sb__title">Memory Sandbox</h1>
        <p className="sb__status">{statusWords(status)}</p>
        <div className="sb__actions">
          <button type="button" onClick={() => setCommands((p) => p.slice(0, -1))}
            disabled={commands.length === 0}>Undo</button>
          <button type="button" onClick={() => { setCommands([]); setWells([null, null]) }}
            disabled={commands.length === 0}>Clear</button>
        </div>
      </header>

      <div className="sb__body">
        <aside className="sb__palette" aria-label="Things you can make">
          <h2 className="sb__heading">Make</h2>

          <Maker
            glyph="123" name="a number" payload={{ kind: 'make', make: 'int', label: numberText }}
            onClick={() => run({ op: 'makeInt', text: numberText.trim() || '0' })}
            drag={drag}
          >
            <input
              aria-label="Which number?"
              value={numberText}
              inputMode="numeric"
              onChange={(e) => setNumberText(e.target.value.replace(/[^\d-]/g, ''))}
            />
          </Maker>

          <Maker
            glyph="Aa" name="some text" payload={{ kind: 'make', make: 'str', label: textValue }}
            onClick={() => run({ op: 'makeStr', value: textValue })}
            drag={drag}
          >
            <input
              aria-label="Which text?"
              value={textValue}
              maxLength={24}
              onChange={(e) => setTextValue(e.target.value)}
            />
          </Maker>

          <Maker
            glyph="[ ]" name="an empty list" payload={{ kind: 'make', make: 'list', label: 'a list' }}
            onClick={() => run({ op: 'makeList', items: [] })}
            drag={drag}
          />

          <h2 className="sb__heading">Name</h2>
          <Maker
            glyph="→" name="a new name" tag
            payload={{ kind: 'newName' }}
            drag={drag}
            onClick={() => setHeld({ kind: 'newName' })}
            hint="Drag onto an object, or click both"
          />

          <p className="sb__tip">
            Drag a name onto a different object to move it.
            Drag an object onto a list to add it.
          </p>
        </aside>

        <main className="sb__canvas">
          <BrainWorkspace
            snapshot={snapshot}
            workArea={snapshot.workArea}
            output={snapshot.output}
            drag={drag}
            onSelectReference={onSelectReference}
            selectionPrompt={held
              ? { message: heldMessage(held), accepts: ['name', 'work', 'slot'] as const }
              : null}
            title="Memory"
            showExecution={false}
            showOutput={false}
            hint="Arrow keys move between things. Hold Alt with an arrow to slide a tile."
            emptyMessage="Nothing here yet. Drag something over from Make."
          />
        </main>
      </div>

      <footer className="sb__bench" aria-label="Work something out">
        <h2 className="sb__heading">Work it out</h2>
        <div className="bench">
          <Well index={0} label={describeRef(wells[0])} filled={!!wells[0]}
            onClear={() => setWells([null, wells[1]])}
            onPlace={held?.kind === 'object' ? () => place(held, { kind: 'well', index: 0 }) : undefined} />
          <select value={operator} aria-label="Which operation?"
            onChange={(e) => setOperator(e.target.value as typeof operator)}>
            {OPERATORS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <Well index={1} label={describeRef(wells[1])} filled={!!wells[1]}
            onClear={() => setWells([wells[0], null])}
            onPlace={held?.kind === 'object' ? () => place(held, { kind: 'well', index: 1 }) : undefined} />
          <button type="button" className="bench__go" onClick={doOperation} disabled={!bothFilled}>
            Work it out
          </button>
          <p className="bench__note">
            The answer is a <strong>new</strong> object. The two you used do not change.
          </p>
        </div>
      </footer>

      {held && (
        <p className="sb__held" role="status">
          {heldMessage(held)}
          <button type="button" onClick={() => setHeld(null)}>Put it back</button>
        </p>
      )}

      <p className="sb__say" role="status">
        {problem ? <span className="sb__problem">{problem}</span> : say}
      </p>

      {naming && (
        <NamePrompt
          draft={naming.draft}
          onCancel={() => setNaming(null)}
          onConfirm={(name) => {
            run({ op: 'bind', name, ref: naming.ref })
            setNaming(null)
          }}
        />
      )}
    </div>
  )
}

function Maker({
  glyph, name, payload, onClick, drag, children, tag, hint,
}: {
  glyph: string
  name: string
  payload: DragPayload
  onClick?: () => void
  drag: BrainDrag
  children?: React.ReactNode
  tag?: boolean
  hint?: string
}) {
  return (
    <div className={`maker${tag ? ' maker--tag' : ''}`}>
      <button
        type="button"
        className="maker__grab"
        onPointerDown={(event) => drag.start(payload, event)}
        onClick={onClick}
        aria-label={onClick ? `Make ${name}` : `${name}. Drag onto an object.`}
      >
        <span className="maker__glyph" aria-hidden="true">{glyph}</span>
        <span className="maker__name">{name}</span>
      </button>
      {children}
      {hint && <span className="maker__hint">{hint}</span>}
    </div>
  )
}

function Well({ index, label, filled, onClear, onPlace }: {
  index: number
  label: string
  filled: boolean
  onClear: () => void
  /** Set while something is held, so a click can place it without dragging. */
  onPlace?: () => void
}) {
  return (
    <div
      className="well"
      data-drop={dropAttr({ kind: 'well', index })}
      data-filled={filled}
      data-placeable={!!onPlace}
    >
      {onPlace
        ? <button type="button" className="well__place" onClick={onPlace}>put it here</button>
        : <span>{label}</span>}
      {filled && (
        <button type="button" className="well__clear" onClick={onClear}
          aria-label={`Take ${label} out`}>×</button>
      )}
    </div>
  )
}

function NamePrompt({ draft, onConfirm, onCancel }: {
  draft: string
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(draft)
  const ok = /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
  return (
    <div className="prompt" role="dialog" aria-label="Name this object">
      <form onSubmit={(e) => { e.preventDefault(); if (ok) onConfirm(value) }}>
        <label htmlFor="new-name">Call it</label>
        <input id="new-name" autoFocus value={value} maxLength={24}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }} />
        <button type="submit" disabled={!ok}>Name it</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </form>
      {value && !ok && (
        <p className="prompt__bad">
          A name starts with a letter and uses letters, digits or _.
        </p>
      )}
    </div>
  )
}

function heldMessage(held: DragPayload): string {
  switch (held.kind) {
    case 'name': return `Holding the name ${held.name}. Click the object it should point at.`
    case 'newName': return 'Holding a new name. Click the object it should point at.'
    case 'object': return `Holding ${held.label}. Click a list to add it, or a slot to replace it.`
    case 'make': return 'Holding a new object.'
  }
}

function statusWords(s: RuntimeStatus): string {
  switch (s.state) {
    case 'ready': return `Real Python ${s.pythonVersion}`
    case 'starting': return s.message
    case 'busy': return 'Working…'
    case 'failed': return `Python did not start: ${s.message}`
    case 'idle': return 'Starting…'
  }
}
