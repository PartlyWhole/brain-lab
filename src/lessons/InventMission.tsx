/**
 * An invention mission: the student builds a method and tests it on inputs
 * they did not choose.
 *
 * Running and testing are different actions and are labelled differently.
 * "Try it" runs one case the student picked so they can watch it. "Test it"
 * runs the whole case set, including cases they have not seen, which is what
 * decides whether the method is finished.
 *
 * Editing invalidates a recorded trace. Rather than patching a recorded run,
 * the trace is dropped and the method is re-run from the case's starting state.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Mission, InventGoal } from './schema'
import type { Program } from '../program/types'
import { emptyProgram } from '../program/types'
import { emitProgram, EmitError } from '../program/emit'
import { validate, canRun, type Problem } from '../program/edit'
import { MethodEditor } from '../editor/MethodEditor'
import { CodeReveal } from '../editor/CodeReveal'
import { BrainWorkspace } from '../brain/BrainWorkspace'
import { getRuntime, type ContractResult, type RuntimeStatus } from '../runtime/client'
import type { RunResult } from '../runtime/types'
import { getStore } from '../persistence/store'
import { useAutosave } from '../persistence/autosave'
import { viewAt, describeStep, nextIndex, previousIndex, indexOfCard } from './playback'
import { HintLadder } from './HintLadder'
import './mission.css'

export function InventMission({ mission }: { mission: Mission }) {
  const goal = mission.goal as InventGoal
  const runtime = getRuntime()
  const store = getStore()

  const [program, setProgram] = useState<Program>(
    () => goal.starterProgram ?? emptyProgram(mission.id),
  )
  const [loaded, setLoaded] = useState(false)
  const [caseId, setCaseId] = useState(goal.cases[0]?.id ?? '')
  const [run, setRun] = useState<RunResult | null>(null)
  const [index, setIndex] = useState(0)
  const [contract, setContract] = useState<ContractResult | null>(null)
  const [status, setStatus] = useState<RuntimeStatus>(runtime.status)
  const [busy, setBusy] = useState<null | 'run' | 'test'>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [hintLevel, setHintLevel] = useState(0)
  const [showCode, setShowCode] = useState(false)
  const [hoverCard, setHoverCard] = useState<string | null>(null)

  useEffect(() => runtime.onStatus(setStatus), [runtime])
  useEffect(() => { void runtime.start().catch(() => {}) }, [runtime])

  // Restore a saved draft, then autosave every later change.
  useEffect(() => {
    let live = true
    void (async () => {
      const [saved, progress] = await Promise.all([
        store.loadMethod(mission.id),
        store.loadProgress(mission.id),
      ])
      if (!live) return
      if (saved) setProgram(saved)
      if (progress) setHintLevel(progress.hintLevel)
      setLoaded(true)
    })()
    return () => { live = false }
  }, [mission.id, store])

  // Editing happens at keystroke rate, so writes are coalesced — but the
  // pending write is flushed when the page is hidden or the mission is left.
  useAutosave(program, (p) => store.saveMethod(mission.id, p), 400, loaded)

  const problems: Problem[] = useMemo(
    () => validate(program, goal.availableNames),
    [program, goal.availableNames],
  )
  const ready = canRun(problems)

  const emitted = useMemo(() => {
    try {
      return { ok: true as const, ...emitProgram(program) }
    } catch (err) {
      return {
        ok: false as const,
        message: err instanceof EmitError ? err.message : 'This method is not ready yet.',
      }
    }
  }, [program])

  // Any edit makes the recorded trace describe a method that no longer exists.
  const changeProgram = useCallback((next: Program) => {
    setProgram(next)
    setRun(null)
    setIndex(0)
    setContract(null)
    setFailure(null)
  }, [])

  const chosenCase = goal.cases.find((c) => c.id === caseId) ?? goal.cases[0]

  const doRun = async () => {
    if (!emitted.ok || !chosenCase) return
    setBusy('run'); setFailure(null); setContract(null)
    try {
      const result = await runtime.run(emitted.source, emitted.lineToCard, chosenCase.setup)
      setRun(result)
      setIndex(0)
    } catch (err) {
      setFailure((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const doTest = async () => {
    if (!emitted.ok) return
    setBusy('test'); setFailure(null)
    try {
      const result = await runtime.checkContract(
        emitted.source, emitted.lineToCard, goal.checkSource, goal.cases,
        mission.misconceptions,
      )
      setContract(result)
      if (result.passed) {
        await store.saveProgress({
          missionId: mission.id, status: 'complete', hintLevel,
          commands: [], predictions: {},
        })
      }
    } catch (err) {
      setFailure((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const view = viewAt(run, index)
  const executingCardId = view.executingCardId ?? hoverCard

  return (
    <div className="mission mission--invent">
      <header className="mission__header">
        <p className="mission__purpose"><span className="pip-badge">Pip</span> {mission.purpose}</p>
        <p className="mission__prompt">{mission.prompt}</p>
      </header>

      <section className="mission__brain" aria-label="Pip’s brain">
        <BrainWorkspace
          snapshot={view.snapshot ?? EMPTY_SNAPSHOT}
          output={view.output}
          executingCardId={view.executingCardId}
          readOnly
        />
        {!run && (
          <p className="mission__brain-idle">
            Pip’s brain is empty until you try the method.
          </p>
        )}
      </section>

      <section className="mission__work" aria-label="The method">
        <div className="panel">
          <h2 className="panel__title">Pip’s method</h2>
          <MethodEditor
            program={program}
            palette={goal.palette}
            availableNames={goal.availableNames}
            problems={problems}
            executingCardId={executingCardId}
            visitedCardIds={view.visitedCardIds}
            onChange={changeProgram}
          />
        </div>

        <div className="panel">
          <div className="panel__head">
            <h2 className="panel__title">The same thing in Python</h2>
            <button type="button" className="link" onClick={() => setShowCode((v) => !v)}
              aria-expanded={showCode}>
              {showCode ? 'hide' : 'show'}
            </button>
          </div>
          {showCode && (
            <CodeReveal
              program={program}
              executingCardId={executingCardId}
              inputNames={goal.availableNames}
              onHoverCard={setHoverCard}
              onSelectCard={(cardId) => {
                const i = indexOfCard(run, cardId)
                if (i !== null) setIndex(i)
              }}
            />
          )}
        </div>
      </section>

      <footer className="mission__controls">
        <div className="controls__group">
          <label className="controls__label" htmlFor="case-pick">Try it with</label>
          <select id="case-pick" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            {goal.cases.filter((c) => !c.hidden).map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <button type="button" className="button button--primary"
            onClick={doRun} disabled={!ready || busy !== null}>
            {busy === 'run' ? 'Trying…' : 'Try it'}
          </button>
        </div>

        <div className="controls__group" role="group" aria-label="Playback">
          <button type="button" onClick={() => setIndex(previousIndex(index))}
            disabled={!run || view.atStart}>◀ Back</button>
          <span className="controls__position" aria-live="polite">
            {run ? `Step ${view.index + 1} of ${view.total}` : 'No run yet'}
          </span>
          <button type="button" onClick={() => setIndex(nextIndex(run, index))}
            disabled={!run || view.atEnd}>Step ▶</button>
          <button type="button" onClick={() => { setRun(null); setIndex(0) }}
            disabled={!run}>Reset</button>
        </div>

        <div className="controls__group">
          <button type="button" className="button button--go"
            onClick={doTest} disabled={!ready || busy !== null}>
            {busy === 'test' ? 'Testing…' : 'Test it on everything'}
          </button>
          {busy !== null && (
            <button type="button" className="button button--stop"
              onClick={() => { runtime.cancel('You stopped Pip.'); setBusy(null) }}>
              Stop
            </button>
          )}
        </div>
      </footer>

      <section className="mission__feedback" aria-live="polite">
        {status.state === 'starting' && <p className="note">{status.message}</p>}
        {status.state === 'failed' && (
          <p className="note note--bad">
            Pip’s Python did not start: {status.message}{' '}
            <button type="button" className="link" onClick={() => runtime.cancel('Retrying.')}>
              Try again
            </button>
          </p>
        )}

        {!ready && problems.length > 0 && (
          <p className="note">
            {problems.filter((p) => p.severity === 'draft').length > 0
              ? 'Still some empty spaces to fill in.'
              : problems[0].message}
          </p>
        )}

        {failure && <p className="note note--bad">{failure}</p>}

        {run && (
          <p className="note">
            {describeStep(view)}
            {view.stoppedForBudget && ' Pip stopped because the method kept going.'}
            {view.error && ` ${view.error.kind}: ${view.error.message}`}
          </p>
        )}

        {contract && <ContractReport contract={contract} />}

        <HintLadder
          hints={mission.hints}
          level={hintLevel}
          onReveal={(level) => {
            setHintLevel(level)
            void store.saveProgress({
              missionId: mission.id, status: 'in-progress', hintLevel: level,
              commands: [], predictions: {},
            })
          }}
        />
      </section>
    </div>
  )
}

function ContractReport({ contract }: { contract: ContractResult }) {
  if (contract.passed) {
    return (
      <div className="report report--good">
        <p><strong>It works on every case.</strong> Including ones you had not seen.</p>
      </div>
    )
  }
  const failed = contract.cases.filter((c) => !c.passed)
  return (
    <div className="report report--bad">
      <p>
        <strong>
          {failed.length} of {contract.cases.length} cases did not work yet.
        </strong>
      </p>
      {/* An authored explanation of the actual mistake, when one matches.
          This is the difference between "wrong" and "here is what happened". */}
      {contract.misconception && (
        <p className="report__why">{contract.misconception.feedback}</p>
      )}
      <ul>
        {failed.map((c) => (
          <li key={c.caseId}>
            <strong>{c.label}</strong>: {c.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

const EMPTY_SNAPSHOT = {
  objects: {}, scopes: [], outputLength: 0, truncated: false,
}
