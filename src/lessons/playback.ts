/**
 * Playback over a recorded trace.
 *
 * The whole run is computed up front and stepped through afterwards. That is
 * what makes stepping backwards possible without suspending a Python frame.
 *
 * The trace holds the future, so this module is careful never to hand the UI
 * anything past the current position: a prediction the student has not
 * committed to must not be answerable by reading ahead.
 *
 * Editing the method invalidates the trace. There is no attempt to patch a
 * recorded run — the method is re-run from the mission's starting state.
 */
import type { RunResult, Snapshot, TraceEvent } from '../runtime/types'

export interface PlaybackView {
  /** The event at the current position, or null before a run exists. */
  event: TraceEvent | null
  snapshot: Snapshot | null
  /** The card about to run. Null at the end, when nothing is executing. */
  executingCardId: string | null
  /** Cards visited up to and including now, for a faded trail. */
  visitedCardIds: string[]
  /** Output produced so far — never the output of steps not yet reached. */
  output: string
  index: number
  total: number
  atStart: boolean
  atEnd: boolean
  /** An error, but only once playback has reached the step that hit it. */
  error: RunResult['error']
  stoppedForBudget: boolean
}

export function viewAt(result: RunResult | null, index: number): PlaybackView {
  if (!result || result.events.length === 0) {
    return {
      event: null, snapshot: null, executingCardId: null, visitedCardIds: [],
      output: '', index: 0, total: 0, atStart: true, atEnd: true,
      error: result?.error ?? null,
      stoppedForBudget: result?.stoppedForBudget ?? false,
    }
  }

  const total = result.events.length
  const clamped = Math.max(0, Math.min(index, total - 1))
  const event = result.events[clamped]

  const visited: string[] = []
  for (let i = 0; i <= clamped; i += 1) {
    const id = result.events[i].cardId
    if (id && !visited.includes(id)) visited.push(id)
  }

  // Output is sliced by the byte count recorded with this snapshot, so the
  // panel shows exactly what had been printed by this point and no more.
  const output = result.output.slice(0, event.snapshot.outputLength)

  const atEnd = clamped === total - 1

  return {
    event,
    snapshot: event.snapshot,
    executingCardId: event.phase === 'before-instruction' ? event.cardId : null,
    visitedCardIds: visited,
    output,
    index: clamped,
    total,
    atStart: clamped === 0,
    atEnd,
    // The error belongs to the end of the run; showing it earlier would spoil
    // the step the student is about to take.
    error: atEnd ? result.error : null,
    stoppedForBudget: atEnd ? result.stoppedForBudget : false,
  }
}

/**
 * A short sentence describing what the current step is about to do, or did.
 * Phase labels are literal; this never claims an instruction has finished when
 * the trace only says it is about to start.
 */
export function describeStep(view: PlaybackView): string {
  if (!view.event) return 'Nothing has run yet.'
  switch (view.event.phase) {
    case 'before-instruction':
      return 'About to do this instruction.'
    case 'call':
      return `Starting ${view.event.functionName}.`
    case 'return':
      return `Finished ${view.event.functionName}.`
    case 'error':
      return view.event.error
        ? `${view.event.error.kind}: ${view.event.error.message}`
        : 'Something went wrong here.'
    case 'end':
      return view.error ? 'Pip stopped here.' : 'Finished.'
  }
}

/** Index of the next event whose card differs, so Step feels like one action. */
export function nextIndex(result: RunResult | null, index: number): number {
  if (!result) return 0
  return Math.min(index + 1, result.events.length - 1)
}

export function previousIndex(index: number): number {
  return Math.max(0, index - 1)
}

/** The first event that touched a given card, for jumping from the code panel. */
export function indexOfCard(result: RunResult | null, cardId: string): number | null {
  if (!result) return null
  const i = result.events.findIndex((e) => e.cardId === cardId)
  return i >= 0 ? i : null
}
