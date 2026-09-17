import { describe, it, expect } from 'vitest'
import { viewAt, describeStep, nextIndex, previousIndex, indexOfCard } from './playback'
import type { RunResult, Snapshot, TraceEvent } from '../runtime/types'

const snap = (outputLength: number): Snapshot => ({
  objects: {}, scopes: [], outputLength, truncated: false,
})

const ev = (
  seq: number, phase: TraceEvent['phase'], cardId: string | null, outputLength = 0,
): TraceEvent => ({
  seq, phase, line: seq + 1, cardId, frameId: 'global', functionName: '<module>',
  snapshot: snap(outputLength),
})

const result: RunResult = {
  events: [
    ev(0, 'before-instruction', 'c1', 0),
    ev(1, 'before-instruction', 'c2', 0),
    ev(2, 'before-instruction', 'c1', 6),
    ev(3, 'end', null, 13),
  ],
  output: 'first\nsecond\n',
  outputTruncated: false,
  stoppedForBudget: false,
  error: null,
}

describe('playback position', () => {
  it('reports the executing card only while an instruction is pending', () => {
    expect(viewAt(result, 0).executingCardId).toBe('c1')
    expect(viewAt(result, 3).executingCardId).toBeNull()
  })

  it('accumulates visited cards without repeating them', () => {
    expect(viewAt(result, 2).visitedCardIds).toEqual(['c1', 'c2'])
  })

  it('shows only the output produced up to this point', () => {
    expect(viewAt(result, 0).output).toBe('')
    expect(viewAt(result, 2).output).toBe('first\n')
    expect(viewAt(result, 3).output).toBe('first\nsecond\n')
  })

  it('clamps an out-of-range index rather than crashing', () => {
    expect(viewAt(result, -5).index).toBe(0)
    expect(viewAt(result, 99).index).toBe(3)
    expect(viewAt(result, 99).atEnd).toBe(true)
  })

  it('handles having no run yet', () => {
    const v = viewAt(null, 0)
    expect(v.event).toBeNull()
    expect(v.total).toBe(0)
    expect(describeStep(v)).toBe('Nothing has run yet.')
  })
})

describe('not revealing the future', () => {
  const failing: RunResult = {
    ...result,
    error: { kind: 'IndexError', message: 'list index out of range', line: 3, cardId: 'c1' },
  }

  it('withholds the error until playback reaches the end', () => {
    expect(viewAt(failing, 0).error).toBeNull()
    expect(viewAt(failing, 2).error).toBeNull()
    expect(viewAt(failing, 3).error).toMatchObject({ kind: 'IndexError' })
  })

  it('withholds the budget notice until the end too', () => {
    const budget: RunResult = { ...result, stoppedForBudget: true }
    expect(viewAt(budget, 1).stoppedForBudget).toBe(false)
    expect(viewAt(budget, 3).stoppedForBudget).toBe(true)
  })
})

describe('stepping', () => {
  it('moves one event at a time and stops at the ends', () => {
    expect(nextIndex(result, 0)).toBe(1)
    expect(nextIndex(result, 3)).toBe(3)
    expect(previousIndex(0)).toBe(0)
    expect(previousIndex(2)).toBe(1)
  })

  it('finds the first event for a card, for jumping from the code panel', () => {
    expect(indexOfCard(result, 'c2')).toBe(1)
    expect(indexOfCard(result, 'nope')).toBeNull()
  })
})

describe('step descriptions', () => {
  it('says a line is about to run, not that it has run', () => {
    expect(describeStep(viewAt(result, 0))).toBe('About to do this instruction.')
  })

  it('reports the end plainly', () => {
    expect(describeStep(viewAt(result, 3))).toBe('Finished.')
  })
})
