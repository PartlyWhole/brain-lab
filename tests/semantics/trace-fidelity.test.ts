/**
 * M0 trace-fidelity gate.
 *
 * Every expectation here is hand-specified from Python's documented behaviour
 * before looking at what the observer produced. Where a value is at stake the
 * test also runs the same source uninstrumented and compares, so agreement
 * between two copies of the observer can never be mistaken for evidence.
 */
import { describe, it, expect } from 'vitest'
import {
  runProgram,
  runUninstrumented,
  bindings,
  objectOf,
  ints,
  finalEvent,
  type TraceEvent,
} from './pyodideHost'

const lines = (n: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, `c${i + 1}`]))

function step(result: { events: TraceEvent[] }, card: string): TraceEvent {
  const e = result.events.find((ev) => ev.cardId === card && ev.phase === 'before-instruction')
  if (!e) throw new Error(`no before-instruction event for ${card}`)
  return e
}

describe('object identity and sharing', () => {
  it('two names on one list converge on a single object', async () => {
    const r = await runProgram(
      ['supplies = [1, 2]', 'bag = supplies'].join('\n'),
      lines(2),
    )
    const end = finalEvent(r)
    const b = bindings(end)
    expect(b.supplies).toBe(b.bag)
    expect(Object.values(end.snapshot.objects).filter((o) => o.type === 'list')).toHaveLength(1)
  })

  it('mutating through one name is visible through the other', async () => {
    const r = await runProgram(
      ['supplies = [1, 2]', 'bag = supplies', 'bag.append(3)'].join('\n'),
      lines(3),
    )
    expect(ints(finalEvent(r), 'supplies')).toEqual([1, 2, 3])
    expect(ints(finalEvent(r), 'bag')).toEqual([1, 2, 3])
    expect(await runUninstrumented(
      ['supplies = [1, 2]', 'bag = supplies', 'bag.append(3)'].join('\n'), ['supplies'],
    )).toEqual({ supplies: '[1, 2, 3]' })
  })

  it('rebinding one name leaves the other reference intact', async () => {
    const r = await runProgram(
      ['supplies = [1, 2]', 'bag = supplies', 'bag = [9]'].join('\n'),
      lines(3),
    )
    const end = finalEvent(r)
    expect(bindings(end).supplies).not.toBe(bindings(end).bag)
    expect(ints(end, 'supplies')).toEqual([1, 2])
    expect(ints(end, 'bag')).toEqual([9])
  })

  it('append adds exactly one slot and does not copy the appended object', async () => {
    const r = await runProgram(
      ['weights = [2, 8]', 'result = []', 'w = weights[1]', 'result.append(w)'].join('\n'),
      lines(4),
    )
    const end = finalEvent(r)
    const weights = objectOf(end, 'weights')!
    const result = objectOf(end, 'result')!
    expect(result.slots).toHaveLength(1)
    expect(result.length).toBe(1)
    // The input's second slot, the loop/holding name and the result's first
    // slot must all be the same represented object: no duplicate tile.
    expect(result.slots![0]).toBe(weights.slots![1])
    expect(result.slots![0]).toBe(bindings(end).w)
  })

  it('a list reports only real slots, never spare capacity', async () => {
    const r = await runProgram(['xs = []', 'xs.append(1)'].join('\n'), lines(2))
    expect(objectOf(finalEvent(r), 'xs')!.slots).toEqual([
      objectOf(finalEvent(r), 'xs')!.slots![0],
    ])
    expect(objectOf(finalEvent(r), 'xs')!.length).toBe(1)
    expect(objectOf(step(r, 'c2'), 'xs')!.slots).toEqual([])
  })

  it('two equal but separate lists are two objects', async () => {
    const r = await runProgram(['a = [1]', 'b = [1]'].join('\n'), lines(2))
    const end = finalEvent(r)
    expect(bindings(end).a).not.toBe(bindings(end).b)
  })
})

describe('historical snapshots are immutable', () => {
  it('a snapshot taken before a mutation still shows the pre-mutation state', async () => {
    const r = await runProgram(
      ['xs = [1, 2]', 'xs.append(3)', 'xs.append(4)'].join('\n'),
      lines(3),
    )
    // Snapshot attached to c2 is the state *before* the first append runs.
    expect(ints(step(r, 'c2'), 'xs')).toEqual([1, 2])
    expect(ints(step(r, 'c3'), 'xs')).toEqual([1, 2, 3])
    expect(ints(finalEvent(r), 'xs')).toEqual([1, 2, 3, 4])
    // And the earliest snapshot has not been retroactively rewritten.
    expect(ints(step(r, 'c2'), 'xs')).toEqual([1, 2])
  })

  it('object ids stay stable across snapshots of the same run', async () => {
    const r = await runProgram(['xs = [1]', 'xs.append(2)', 'y = 0'].join('\n'), lines(3))
    expect(bindings(step(r, 'c2')).xs).toBe(bindings(finalEvent(r)).xs)
  })
})

describe('statement boundaries and source mapping', () => {
  it('a line event is before that line runs, not after', async () => {
    const r = await runProgram(['x = 1', 'x = 2'].join('\n'), lines(2))
    expect(bindings(step(r, 'c1'))).toEqual({})           // nothing bound yet
    expect(Number(objectOf(step(r, 'c2'), 'x')!.text)).toBe(1)
    expect(Number(objectOf(finalEvent(r), 'x')!.text)).toBe(2)
  })

  it('the terminal event highlights no card', async () => {
    const r = await runProgram('x = 1', lines(1))
    expect(finalEvent(r).phase).toBe('end')
    expect(finalEvent(r).cardId).toBeNull()
  })

  it('every executed event maps to the card on its line', async () => {
    const r = await runProgram(['a = 1', 'b = 2'].join('\n'), { 1: 'cardA', 2: 'cardB' })
    const cards = r.events.filter((e) => e.phase === 'before-instruction').map((e) => e.cardId)
    expect(cards).toEqual(['cardA', 'cardB'])
  })
})

describe('control flow', () => {
  it('an empty loop runs its body zero times and binds no loop name', async () => {
    const src = ['total = 0', 'for n in []:', '    total = total + n'].join('\n')
    const r = await runProgram(src, lines(3))
    const end = finalEvent(r)
    expect(Object.keys(bindings(end))).toEqual(['n_absent'].slice(0, 0).concat(['total']))
    expect(bindings(end).n).toBeUndefined()
    expect(r.events.some((e) => e.cardId === 'c3')).toBe(false)
  })

  it('a for statement is revisited once per item plus once to finish', async () => {
    const src = ['t = 0', 'for n in [1, 2]:', '    t = t + n'].join('\n')
    const r = await runProgram(src, lines(3))
    const forVisits = r.events.filter((e) => e.cardId === 'c2').length
    const bodyVisits = r.events.filter((e) => e.cardId === 'c3').length
    expect(bodyVisits).toBe(2)
    expect(forVisits).toBe(3)                 // two items, then exhaustion
    expect(Number(objectOf(finalEvent(r), 't')!.text)).toBe(3)
  })

  it('the last loop binding survives the loop', async () => {
    const r = await runProgram(['for n in [1, 2]:', '    pass'].join('\n'), lines(2))
    expect(Number(objectOf(finalEvent(r), 'n')!.text)).toBe(2)
  })

  it('rebinding the loop name does not write into the source list', async () => {
    const src = ['xs = [1, 2]', 'for n in xs:', '    n = n + 100'].join('\n')
    const r = await runProgram(src, lines(3))
    expect(ints(finalEvent(r), 'xs')).toEqual([1, 2])
    expect(Number(objectOf(finalEvent(r), 'n')!.text)).toBe(102)
    expect(await runUninstrumented(src, ['xs'])).toEqual({ xs: '[1, 2]' })
  })

  it('mutating through the loop name does reach the source list', async () => {
    const src = ['rows = [[1], [2]]', 'for row in rows:', '    row.append(0)'].join('\n')
    const r = await runProgram(src, lines(3))
    const end = finalEvent(r)
    const rows = objectOf(end, 'rows')!
    const first = end.snapshot.objects[rows.slots![0]]
    expect(first.slots).toHaveLength(2)
    expect(await runUninstrumented(src, ['rows'])).toEqual({ rows: '[[1, 0], [2, 0]]' })
  })

  it('a skipped branch produces no events for its body', async () => {
    const src = ['x = 1', 'if x > 5:', '    x = 99', 'y = 2'].join('\n')
    const r = await runProgram(src, lines(4))
    expect(r.events.some((e) => e.cardId === 'c3')).toBe(false)
    expect(Number(objectOf(finalEvent(r), 'x')!.text)).toBe(1)
  })
})

describe('calls and returns', () => {
  it('defining a function binds a name without running the body', async () => {
    const src = ['def f():', '    return 1', 'g = f'].join('\n')
    const r = await runProgram(src, lines(3))
    expect(r.events.some((e) => e.cardId === 'c2')).toBe(false)
    expect(objectOf(finalEvent(r), 'f')!.type).toBe('function')
  })

  it('a call opens a separate scope and an explicit return reports its object', async () => {
    const src = ['def f(a):', '    b = a + 1', '    return b', 'out = f(2)'].join('\n')
    const r = await runProgram(src, lines(4))
    const call = r.events.find((e) => e.phase === 'call')!
    expect(call.functionName).toBe('f')
    const local = call.snapshot.scopes.find((s) => s.kind === 'call')!
    expect(local.bindings.map((x) => x.name)).toEqual(['a'])
    const ret = r.events.find((e) => e.phase === 'return')!
    expect(Number(ret.snapshot.objects[ret.returnedObjectId!].text)).toBe(3)
    expect(Number(objectOf(finalEvent(r), 'out')!.text)).toBe(3)
  })

  it('falling off the end returns None', async () => {
    const src = ['def f():', '    x = 1', 'out = f()'].join('\n')
    const r = await runProgram(src, lines(3))
    const ret = r.events.find((e) => e.phase === 'return')!
    expect(ret.snapshot.objects[ret.returnedObjectId!].type).toBe('none')
  })

  it('a nested call reports both frames in order', async () => {
    const src = [
      'def inner(n):', '    return n * 2',
      'def outer(n):', '    return inner(n) + 1',
      'out = outer(3)',
    ].join('\n')
    const r = await runProgram(src, lines(5))
    const calls = r.events.filter((e) => e.phase === 'call').map((e) => e.functionName)
    expect(calls).toEqual(['outer', 'inner'])
    expect(Number(objectOf(finalEvent(r), 'out')!.text)).toBe(7)
  })

  it('a returned object is shared, not copied', async () => {
    const src = ['def f(xs):', '    return xs', 'a = [1]', 'b = f(a)'].join('\n')
    const r = await runProgram(src, lines(4))
    expect(bindings(finalEvent(r)).a).toBe(bindings(finalEvent(r)).b)
  })
})

describe('errors, effects and output', () => {
  it('effects performed before an error are preserved', async () => {
    const src = ['xs = [1]', 'xs.append(2)', 'boom = xs[9]'].join('\n')
    const r = await runProgram(src, lines(3))
    expect(r.error!.kind).toBe('IndexError')
    expect(r.error!.line).toBe(3)
    expect(r.error!.cardId).toBe('c3')
    expect(ints(finalEvent(r), 'xs')).toEqual([1, 2])
  })

  it('a syntax error is reported at compile time with no events', async () => {
    const r = await runProgram('x = = 1', lines(1))
    expect(r.error!.kind).toBe('SyntaxError')
    expect(r.error!.phase).toBe('compile')
    expect(r.events).toHaveLength(0)
  })

  it('printing goes to output and the expression result stays None', async () => {
    const src = ['r = print("hi")'].join('\n')
    const r = await runProgram(src, lines(1))
    expect(r.output).toBe('hi\n')
    expect(objectOf(finalEvent(r), 'r')!.type).toBe('none')
  })

  it('append returns None while changing the list', async () => {
    const src = ['xs = [1]', 'r = xs.append(2)'].join('\n')
    const r = await runProgram(src, lines(2))
    expect(objectOf(finalEvent(r), 'r')!.type).toBe('none')
    expect(ints(finalEvent(r), 'xs')).toEqual([1, 2])
  })
})

describe('serialization limits', () => {
  it('large integers keep full precision as decimal strings', async () => {
    const r = await runProgram('big = 2 ** 70', lines(1))
    expect(objectOf(finalEvent(r), 'big')!.text).toBe((2n ** 70n).toString())
  })

  it('booleans are distinguished from integers', async () => {
    const r = await runProgram(['t = True', 'o = 1'].join('\n'), lines(2))
    const end = finalEvent(r)
    expect(objectOf(end, 't')!.type).toBe('bool')
    expect(objectOf(end, 'o')!.type).toBe('int')
    expect(bindings(end).t).not.toBe(bindings(end).o)
  })

  it('a runaway loop stops on the event budget and keeps what it recorded', async () => {
    const src = ['n = 0', 'while True:', '    n = n + 1'].join('\n')
    const r = await runProgram(src, lines(3), '', { max_events: 50 })
    expect(r.stoppedForBudget).toBe(true)
    expect(r.events.length).toBeLessThanOrEqual(51)
    expect(r.error!.kind).toBe('ExecutionBudgetExceeded')
    expect(Number(objectOf(finalEvent(r), 'n')!.text)).toBeGreaterThan(0)
  })

  it('a cyclic structure serializes without recursing forever', async () => {
    const r = await runProgram(['xs = [1]', 'xs.append(xs)'].join('\n'), lines(2))
    const end = finalEvent(r)
    const xs = objectOf(end, 'xs')!
    expect(xs.slots![1]).toBe(xs.id)
  })
})
