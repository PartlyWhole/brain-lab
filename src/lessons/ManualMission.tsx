/**
 * A manual mission: the student *is* the robot's memory.
 *
 * Every operation is dispatched to real Python objects in the worker. The
 * command log is the whole state model — undo removes the last command and
 * replays the rest from the mission's setup, which reconstructs aliasing
 * exactly instead of trying to invert a mutation.
 *
 * Preparing an operation changes nothing. The command is only sent when the
 * student performs it, so a half-built action can never alter the brain.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Mission, ManualGoal } from './schema'
import { BrainWorkspace } from '../brain/BrainWorkspace'
import { getRuntime, type RuntimeStatus } from '../runtime/client'
import { getStore } from '../persistence/store'
import { useAutosave } from '../persistence/autosave'
import { isSelectableReference, type SelectableReference, type Snapshot } from '../runtime/types'
import {
  TOOLS, beginOperation, supply, isReady, undoLastInput, toCommand, describeOperation,
  type PreparedOperation,
} from './manualOps'
import { HintLadder } from './HintLadder'
import './mission.css'

interface ManualSnapshot extends Snapshot {
  workArea: { slotId: string; label: string; objectId: string }[]
  output: string
}

interface ManualReply {
  snapshot: ManualSnapshot
  applied: { index: number; ok: boolean; outcome: { description: string; effect: string | null } }[]
  error: { index: number; kind: string; message: string; hint: string | null } | null
  check: { done: boolean; message: string } | null
}

const EMPTY: ManualSnapshot = {
  objects: {}, scopes: [], outputLength: 0, truncated: false, workArea: [], output: '',
}

export function ManualMission({ mission }: { mission: Mission }) {
  const goal = mission.goal as ManualGoal
  const runtime = getRuntime()
  const store = getStore()

  const [commands, setCommands] = useState<Record<string, unknown>[]>([])
  const [loaded, setLoaded] = useState(false)
  const [reply, setReply] = useState<ManualReply | null>(null)
  const [operation, setOperation] = useState<PreparedOperation | null>(null)
  const [pendingText, setPendingText] = useState('')
  const [status, setStatus] = useState<RuntimeStatus>(runtime.status)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [lastMessage, setLastMessage] = useState<string | null>(null)
  const [hintLevel, setHintLevel] = useState(0)

  useEffect(() => runtime.onStatus(setStatus), [runtime])
  useEffect(() => { void runtime.start().catch(() => {}) }, [runtime])

  useEffect(() => {
    let live = true
    void (async () => {
      const progress = await store.loadProgress(mission.id)
      if (!live) return
      if (progress) {
        setCommands(progress.commands as Record<string, unknown>[])
        setHintLevel(progress.hintLevel)
      }
      setLoaded(true)
    })()
    return () => { live = false }
  }, [mission.id, store])

  // The brain is always a replay of the command log. There is no other source
  // of truth, so what is drawn cannot drift from what Python actually did.
  const replay = useCallback(async (next: Record<string, unknown>[]) => {
    setBusy(true); setFailure(null)
    try {
      const result = await runtime.manual(
        mission.setupSource, next, goal.checkSource,
      ) as unknown as ManualReply
      setReply(result)
      if (result.error) {
        setLastMessage(
          result.error.hint
            ? `${result.error.message} ${result.error.hint}`
            : result.error.message,
        )
      } else {
        const last = result.applied[result.applied.length - 1]
        setLastMessage(last ? last.outcome.description : null)
      }
      return result
    } catch (err) {
      setFailure((err as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }, [runtime, mission.setupSource, goal.checkSource])

  useEffect(() => {
    if (!loaded) return
    void replay(commands)
    // Replaying whenever the log changes keeps the view honest after undo too.
  }, [loaded, commands, replay])

  // Performing an operation is a deliberate, infrequent act, so it is saved at
  // once rather than debounced: a student who closes the tab straight after
  // their last step must not lose it.
  useAutosave(
    { commands, hintLevel, done: reply?.check?.done ?? false },
    (state) => store.saveProgress({
      missionId: mission.id,
      status: state.done ? 'complete' : 'in-progress',
      hintLevel: state.hintLevel,
      commands: state.commands,
      predictions: {},
    }),
    0,
    loaded,
  )

  const snapshot = reply?.snapshot ?? EMPTY

  const perform = async () => {
    if (!operation || !isReady(operation)) return
    const command = toCommand(operation)
    if (!command) return
    setOperation(null)
    setCommands((prev) => [...prev, command])
  }

  const onSelectReference = (ref: SelectableReference) => {
    if (!operation?.next) return
    if (operation.next.kind !== 'reference') return
    setOperation(supply(operation, ref))
  }

  const selectionPrompt = useMemo(() => {
    if (!operation?.next) return null
    if (operation.next.kind !== 'reference') return null
    return { message: operation.next.prompt, accepts: ['name', 'work', 'slot'] as const }
  }, [operation])

  const spec = operation ? TOOLS[operation.tool] : null
  const done = reply?.check?.done ?? false

  return (
    <div className="mission mission--manual">
      <header className="mission__header">
        <p className="mission__purpose"><span className="pip-badge">Pip</span> {mission.purpose}</p>
        <p className="mission__prompt">{mission.prompt}</p>
      </header>

      <section className="mission__brain" aria-label="Pip’s brain">
        <BrainWorkspace
          snapshot={snapshot}
          workArea={snapshot.workArea}
          output={snapshot.output}
          onSelectReference={onSelectReference}
          selectionPrompt={selectionPrompt}
          selectedRefs={collectRefs(operation)}
        />
      </section>

      <section className="mission__work" aria-label="Tools">
        <div className="panel">
          <h2 className="panel__title">What can I do?</h2>
          <ul className="tools">
            {mission.tools.map((tool) => {
              const t = TOOLS[tool]
              const active = operation?.tool === tool
              return (
                <li key={tool}>
                  <button
                    type="button"
                    className={`tool${active ? ' tool--active' : ''}`}
                    onClick={() => { setOperation(beginOperation(tool)); setPendingText('') }}
                    aria-pressed={active}
                  >
                    <span className="tool__label">{t.label}</span>
                    <span className="tool__summary">{t.summary}</span>
                    <span className="tool__facts">
                      gives <strong>{t.result}</strong> · changes <strong>{t.effect}</strong>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        {operation && spec && (
          <div className="panel panel--prepare">
            <h2 className="panel__title">Getting ready — nothing has happened yet</h2>
            <p className="prepare__sentence">{describeOperation(operation)}</p>

            {operation.next?.kind === 'reference' && (
              <p className="prepare__ask">{operation.next.prompt} Click it in the brain.</p>
            )}

            {operation.next && operation.next.kind !== 'reference' && (
              <form
                className="prepare__form"
                onSubmit={(e) => {
                  e.preventDefault()
                  const value = pendingText.trim()
                  if (!value) return
                  setOperation(supply(operation, value))
                  setPendingText('')
                }}
              >
                <label>
                  {operation.next.prompt}
                  {operation.next.kind === 'operator' ? (
                    <select value={pendingText} onChange={(e) => setPendingText(e.target.value)}>
                      <option value="">choose…</option>
                      <option value=">">is bigger than</option>
                      <option value="<">is smaller than</option>
                      <option value="==">is the same as</option>
                      <option value="!=">is not the same as</option>
                      <option value=">=">is bigger than or the same as</option>
                      <option value="<=">is smaller than or the same as</option>
                    </select>
                  ) : (
                    <input
                      autoFocus
                      value={pendingText}
                      onChange={(e) => setPendingText(e.target.value)}
                      inputMode={operation.next.kind === 'number' || operation.next.kind === 'slotIndex'
                        ? 'numeric' : 'text'}
                      maxLength={40}
                    />
                  )}
                </label>
                <button type="submit">Use it</button>
              </form>
            )}

            <div className="prepare__actions">
              <button type="button" className="button button--primary"
                onClick={perform} disabled={!isReady(operation) || busy}>
                Do it
              </button>
              <button type="button" onClick={() => setOperation(undoLastInput(operation))}>
                Back
              </button>
              <button type="button" onClick={() => setOperation(null)}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      <footer className="mission__controls">
        <div className="controls__group">
          <button type="button" onClick={() => setCommands((p) => p.slice(0, -1))}
            disabled={commands.length === 0 || busy}>
            Undo
          </button>
          <button type="button" onClick={() => { setCommands([]); setOperation(null) }}
            disabled={commands.length === 0 || busy}>
            Start over
          </button>
          <span className="controls__position">
            {commands.length} step{commands.length === 1 ? '' : 's'} so far
          </span>
        </div>
        <p className="controls__aside">
          Undo and Start over are lab controls. They are not things Pip’s Python can do.
        </p>
      </footer>

      <section className="mission__feedback" aria-live="polite">
        {status.state === 'starting' && <p className="note">{status.message}</p>}
        {status.state === 'failed' && (
          <p className="note note--bad">Pip’s Python did not start: {status.message}</p>
        )}
        {failure && <p className="note note--bad">{failure}</p>}
        {lastMessage && <p className="note">{lastMessage}</p>}

        {reply?.check && (
          <div className={`report ${done ? 'report--good' : 'report--bad'}`}>
            <p>{done ? goal.successMessage : reply.check.message}</p>
          </div>
        )}

        <HintLadder
          hints={mission.hints}
          level={hintLevel}
          onReveal={setHintLevel}
        />
      </section>
    </div>
  )
}

/** Only brain-pickable references highlight in the workspace; literals do not. */
function collectRefs(op: PreparedOperation | null): SelectableReference[] {
  if (!op) return []
  return Object.values(op.values).filter(isSelectableReference)
}
