/**
 * Main-thread client for the Python worker.
 *
 * Cancellation is worker termination. A cooperative budget cannot interrupt
 * every long-running operation, so the hard stop has to be able to kill a
 * worker that is no longer reading messages. Terminating loses the runtime, so
 * the client immediately starts a fresh one and reports honest status while it
 * warms up; the student's method lives in the app, never in the worker.
 */
import {
  WorkerResponseSchema,
  RunResultSchema,
  type RunResult,
  type WorkerResponse,
} from './types'

export type RuntimeStatus =
  | { state: 'idle' }
  | { state: 'starting'; message: string }
  | { state: 'ready'; pythonVersion: string; startupMs: number }
  | { state: 'busy'; message: string }
  | { state: 'failed'; message: string }

export interface ManualResult {
  snapshot: unknown
  applied: unknown[]
  error: { index: number; kind: string; message: string; hint: string | null } | null
  /** Present when the mission supplied a state check. */
  check: { done: boolean; message: string } | null
}

export interface Misconception {
  id: string
  feedback: string
}

export interface ContractResult {
  passed: boolean
  cases: {
    caseId: string
    label: string
    passed: boolean
    message: string
    error: { kind: string; message: string; line: number | null } | null
    hidden: boolean
    misconception: Misconception | null
  }[]
  firstFailure: ContractResult['cases'][number] | null
  /** The authored explanation for the first failure, when one matches. */
  misconception: Misconception | null
}

/** Absolute URL of the self-hosted runtime directory, honouring the base path. */
export function runtimeUrl(): string {
  const base = import.meta.env.BASE_URL || '/'
  return new URL(`${base}runtime/pyodide/`, window.location.href).toString()
}

type Pending = {
  resolve: (value: never) => void
  reject: (reason: Error) => void
  expect: WorkerResponse['type']
}

export class PythonRuntime {
  private worker: Worker | null = null
  private pending = new Map<string, Pending>()
  private seq = 0
  private listeners = new Set<(s: RuntimeStatus) => void>()
  private statusValue: RuntimeStatus = { state: 'idle' }
  private initPromise: Promise<void> | null = null

  get status(): RuntimeStatus {
    return this.statusValue
  }

  onStatus(fn: (s: RuntimeStatus) => void): () => void {
    this.listeners.add(fn)
    fn(this.statusValue)
    return () => this.listeners.delete(fn)
  }

  private setStatus(s: RuntimeStatus) {
    this.statusValue = s
    this.listeners.forEach((fn) => fn(s))
  }

  private nextId(): string {
    this.seq += 1
    return `r${this.seq}`
  }

  private spawn(): Worker {
    const worker = new Worker(new URL('./python.worker.ts', import.meta.url), {
      type: 'module',
      name: 'robot-brain-lab-python',
    })
    worker.onmessage = (event) => this.receive(event.data)
    worker.onerror = (event) => {
      const message = event.message || 'The Python runtime stopped unexpectedly.'
      this.failAll(message)
      this.setStatus({ state: 'failed', message })
    }
    return worker
  }

  private receive(data: unknown) {
    const parsed = WorkerResponseSchema.safeParse(data)
    if (!parsed.success) return
    const msg = parsed.data

    if (msg.type === 'progress') {
      if (this.statusValue.state !== 'ready') {
        this.setStatus({ state: 'starting', message: msg.message })
      }
      return
    }

    const entry = this.pending.get(msg.requestId)
    // A response for a superseded run: the request was cancelled, so drop it.
    if (!entry) return
    this.pending.delete(msg.requestId)

    if (msg.type === 'failed') {
      entry.reject(new Error(msg.error.message))
      return
    }
    if (msg.type === 'ready') {
      this.setStatus({
        state: 'ready',
        pythonVersion: msg.pythonVersion,
        startupMs: msg.startupMs,
      })
      ;(entry.resolve as (v: unknown) => void)(msg)
      return
    }
    if (this.statusValue.state === 'busy') {
      this.setStatus({ ...(this.readyStatus ?? { state: 'idle' }) } as RuntimeStatus)
    }
    ;(entry.resolve as (v: unknown) => void)(
      msg.type === 'runResult' ? msg.result : (msg as { result: unknown }).result,
    )
  }

  private readyStatus: RuntimeStatus | null = null

  private failAll(message: string) {
    for (const [, entry] of this.pending) entry.reject(new Error(message))
    this.pending.clear()
  }

  private send<T>(payload: Record<string, unknown>, expect: WorkerResponse['type']): Promise<T> {
    if (!this.worker) this.worker = this.spawn()
    const requestId = this.nextId()
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as Pending['resolve'],
        reject,
        expect,
      })
    })
    this.worker.postMessage({ ...payload, requestId, runtimeUrl: runtimeUrl() })
    return promise
  }

  /** Starts the runtime. Safe to call repeatedly; only one start happens. */
  start(): Promise<void> {
    if (!this.initPromise) {
      this.setStatus({ state: 'starting', message: 'Loading Pip’s Python…' })
      this.initPromise = this.send<{ pythonVersion: string; startupMs: number }>(
        { type: 'init' },
        'ready',
      )
        .then((ready) => {
          this.readyStatus = {
            state: 'ready',
            pythonVersion: ready.pythonVersion,
            startupMs: ready.startupMs,
          }
          this.setStatus(this.readyStatus)
        })
        .catch((err: Error) => {
          this.setStatus({ state: 'failed', message: err.message })
          this.initPromise = null
          throw err
        })
    }
    return this.initPromise
  }

  async run(
    source: string,
    lineToCard: Record<number, string>,
    setup = '',
    budgets: Record<string, number> = {},
  ): Promise<RunResult> {
    await this.start()
    this.setStatus({ state: 'busy', message: 'Pip is working…' })
    const raw = await this.send<unknown>(
      { type: 'run', source, lineToCard, setup, budgets },
      'runResult',
    )
    return RunResultSchema.parse(raw)
  }

  async manual(
    setup: string,
    commands: unknown[],
    checkSource = '',
  ): Promise<ManualResult> {
    await this.start()
    return this.send<ManualResult>(
      { type: 'manual', setup, commands, checkSource },
      'manualResult',
    )
  }

  async checkContract(
    source: string,
    lineToCard: Record<number, string>,
    checkSource: string,
    cases: unknown[],
    misconceptions: unknown[] = [],
  ): Promise<ContractResult> {
    await this.start()
    this.setStatus({ state: 'busy', message: 'Testing Pip’s method…' })
    return this.send<ContractResult>(
      { type: 'checkContract', source, lineToCard, checkSource, cases, misconceptions },
      'contractResult',
    )
  }

  /**
   * Hard stop. Terminates the worker, rejects everything in flight, and starts
   * a fresh runtime so the next action is possible without a page reload.
   */
  cancel(reason = 'Stopped.'): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.failAll(reason)
    this.initPromise = null
    this.readyStatus = null
    this.setStatus({ state: 'starting', message: 'Restarting Pip’s Python…' })
    void this.start()
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.pending.clear()
    this.listeners.clear()
  }
}

/** One runtime per page; lessons share it. */
let singleton: PythonRuntime | null = null
export function getRuntime(): PythonRuntime {
  if (!singleton) singleton = new PythonRuntime()
  return singleton
}
