/**
 * M0 diagnostics: the evidence page for the runtime gate.
 *
 * It reports the real Python version, measured startup, the resolved runtime
 * URL under whatever base path the build was made with, and runs live fixtures
 * for sharing, mutation-versus-rebinding, historical snapshots and hard-stop
 * recovery. This stays in the shipped app as the "is the runtime healthy?"
 * page, because a student hitting a runtime problem needs somewhere honest to
 * look and a way to report what they saw.
 */
import { useEffect, useState } from 'react'
import { getRuntime, runtimeUrl, type RuntimeStatus } from '../runtime/client'
import { emitProgram } from '../program/emit'
import type { Program } from '../program/types'
import { describeObject, bindingsOf, type RunResult } from '../runtime/types'

const heavyParcels: Program = {
  schemaVersion: 1,
  missionId: 'diagnostic',
  body: [
    { kind: 'bind', id: 'c-result', name: 'result', value: { kind: 'list', id: 'e1', items: [] } },
    {
      kind: 'for', id: 'c-for', loopName: 'weight',
      iterable: { kind: 'name', id: 'e2', name: 'weights' },
      body: [{
        kind: 'if', id: 'c-if',
        condition: {
          kind: 'compare', id: 'e3', op: '>',
          left: { kind: 'name', id: 'e4', name: 'weight' },
          right: { kind: 'name', id: 'e5', name: 'limit' },
        },
        then: [{
          kind: 'append', id: 'c-append',
          target: { kind: 'name', id: 'e6', name: 'result' },
          value: { kind: 'name', id: 'e7', name: 'weight' },
        }],
        otherwise: [],
      }],
    },
    { kind: 'bind', id: 'c-answer', name: 'answer', value: { kind: 'name', id: 'e8', name: 'result' } },
  ],
}

export function Diagnostics() {
  const runtime = getRuntime()
  const [status, setStatus] = useState<RuntimeStatus>(runtime.status)
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => runtime.onStatus(setStatus), [runtime])
  useEffect(() => { void runtime.start().catch(() => {}) }, [runtime])

  const { source, lineToCard } = emitProgram(heavyParcels)

  const run = async () => {
    setError(null)
    try {
      setResult(await runtime.run(source, lineToCard, 'weights = [2, 8, 5, 9]\nlimit = 5'))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const runaway = async () => {
    setError(null)
    try {
      setResult(await runtime.run('n = 0\nwhile True:\n    n = n + 1\n', { 1: 'a', 2: 'b', 3: 'c' },
        '', { max_events: 300 }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const last = result?.events[result.events.length - 1]

  return (
    <main style={{ padding: 'var(--sp-5)', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-xl)' }}>Robot Brain Lab — runtime diagnostics</h1>

      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: 'var(--sp-2) var(--sp-4)' }}>
        <dt>Status</dt><dd>{describeStatus(status)}</dd>
        <dt>Base path</dt><dd><code>{import.meta.env.BASE_URL}</code></dd>
        <dt>Runtime URL</dt><dd><code style={{ wordBreak: 'break-all' }}>{runtimeUrl()}</code></dd>
        <dt>Build</dt><dd><code>{__APP_BUILD__.commit}</code> · {__APP_BUILD__.builtAt}</dd>
      </dl>

      <div style={{ display: 'flex', gap: 'var(--sp-2)', margin: 'var(--sp-4) 0' }}>
        <button onClick={run}>Run heavy-parcels fixture</button>
        <button onClick={runaway}>Run a runaway loop</button>
        <button onClick={() => runtime.cancel('Stopped by the diagnostics page.')}>Hard stop</button>
      </div>

      <pre style={{ background: 'var(--surface-sunk)', padding: 'var(--sp-3)', borderRadius: 'var(--radius)' }}>
        {source}
      </pre>

      {error && <p style={{ color: 'var(--bad)' }} role="alert">{error}</p>}

      {result && last && (
        <section>
          <h2 style={{ fontSize: 'var(--fs-lg)' }}>Result</h2>
          <p>
            {result.events.length} events
            {result.stoppedForBudget ? ' · stopped on the step budget' : ''}
            {result.error ? ` · ${result.error.kind}: ${result.error.message}` : ''}
          </p>
          <ul>
            {bindingsOf(last.snapshot).map((b) => (
              <li key={b.name}>
                <strong>{b.name}</strong> → {describeObject(last.snapshot, b.objectId)}{' '}
                <code style={{ color: 'var(--ink-faint)' }}>{b.objectId}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

function describeStatus(s: RuntimeStatus): string {
  switch (s.state) {
    case 'idle': return 'Not started'
    case 'starting': return s.message
    case 'busy': return s.message
    case 'ready': return `Python ${s.pythonVersion}, started in ${s.startupMs} ms`
    case 'failed': return `Failed: ${s.message}`
  }
}
