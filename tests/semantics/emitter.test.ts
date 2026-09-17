/**
 * Emitter cases: precedence, escaping, indentation and source mapping.
 *
 * Expected Python text is hand-written here. Where meaning is at stake the
 * emitted source is also executed by real Python and compared against a value
 * computed independently, so a wrong-but-consistent emitter cannot pass.
 */
import { describe, it, expect } from 'vitest'
import type { Expr, Program, Stmt } from '../../src/program/types'
import { emitProgram, emitExpr, pythonString, EmitError } from '../../src/program/emit'
import { runProgram, runUninstrumented, finalEvent, objectOf } from './pyodideHost'

let seq = 0
const id = () => `t${(seq += 1)}`

const int = (n: number | string): Expr => ({ kind: 'int', id: id(), text: String(n) })
const name = (n: string): Expr => ({ kind: 'name', id: id(), name: n })
const list = (...items: Expr[]): Expr => ({ kind: 'list', id: id(), items })
const arith = (op: '+' | '-' | '*' | '//' | '%', left: Expr, right: Expr): Expr =>
  ({ kind: 'arith', id: id(), op, left, right })
const cmp = (op: '>' | '<' | '>=' | '<=' | '==' | '!=', left: Expr, right: Expr): Expr =>
  ({ kind: 'compare', id: id(), op, left, right })
const call = (fn: 'len' | 'sum' | 'max', ...args: Expr[]): Expr =>
  ({ kind: 'call', id: id(), fn, args })
const index = (target: Expr, i: Expr): Expr => ({ kind: 'index', id: id(), target, index: i })

const bind = (n: string, value: Expr, nodeId = id()): Stmt =>
  ({ kind: 'bind', id: nodeId, name: n, value })
const append = (target: Expr, value: Expr, nodeId = id()): Stmt =>
  ({ kind: 'append', id: nodeId, target, value })
const forEach = (loopName: string, iterable: Expr, body: Stmt[], nodeId = id()): Stmt =>
  ({ kind: 'for', id: nodeId, loopName, iterable, body })
const iff = (condition: Expr, then: Stmt[], otherwise: Stmt[] = [], nodeId = id()): Stmt =>
  ({ kind: 'if', id: nodeId, condition, then, otherwise })

const program = (...body: Stmt[]): Program =>
  ({ schemaVersion: 1, missionId: 'test', body })

describe('expression precedence', () => {
  it('parenthesises a sum used as a factor', () => {
    expect(emitExpr(arith('*', arith('+', int(1), int(2)), int(3)))).toBe('(1 + 2) * 3')
  })

  it('does not parenthesise a product used as a term', () => {
    expect(emitExpr(arith('+', arith('*', int(1), int(2)), int(3)))).toBe('1 * 2 + 3')
  })

  it('keeps subtraction left-associative', () => {
    expect(emitExpr(arith('-', arith('-', int(10), int(3)), int(2)))).toBe('10 - 3 - 2')
    expect(emitExpr(arith('-', int(10), arith('-', int(3), int(2))))).toBe('10 - (3 - 2)')
  })

  it('parenthesises a comparison used inside arithmetic', () => {
    expect(emitExpr(arith('+', cmp('>', int(1), int(2)), int(1)))).toBe('(1 > 2) + 1')
  })

  it('parenthesises a negative literal used as an operand, for readability', () => {
    expect(emitExpr(arith('*', int(5), int(-3)))).toBe('5 * (-3)')
    expect(emitExpr(arith('-', int(5), int(-3)))).toBe('5 - (-3)')
    // On its own it needs no parentheses.
    expect(emitExpr(int(-3))).toBe('-3')
  })

  it('emits trailers without spurious parentheses', () => {
    expect(emitExpr(index(name('xs'), arith('+', name('i'), int(1))))).toBe('xs[i + 1]')
    expect(emitExpr(call('len', name('xs')))).toBe('len(xs)')
  })

  it('agrees with Python on every precedence case', async () => {
    const cases: [Expr, number][] = [
      [arith('*', arith('+', int(1), int(2)), int(3)), 9],
      [arith('+', arith('*', int(1), int(2)), int(3)), 5],
      [arith('-', arith('-', int(10), int(3)), int(2)), 5],
      [arith('-', int(10), arith('-', int(3), int(2))), 9],
      [arith('*', int(5), int(-3)), -15],
      [arith('-', int(5), int(-3)), 8],
      [arith('+', int(-5), int(3)), -2],
      [arith('%', arith('+', int(7), int(3)), int(4)), 2],
      [arith('//', arith('+', int(7), int(3)), int(4)), 2],
    ]
    for (const [expr, expected] of cases) {
      const src = `answer = ${emitExpr(expr)}\n`
      const out = await runUninstrumented(src, ['answer'])
      expect({ src, value: out.answer }).toEqual({ src, value: String(expected) })
    }
  })
})

describe('string escaping', () => {
  it('escapes quotes, backslashes and control characters', () => {
    expect(pythonString('say "hi"')).toBe('"say \\"hi\\""')
    expect(pythonString('a\\b')).toBe('"a\\\\b"')
    expect(pythonString('line\nnext')).toBe('"line\\nnext"')
    expect(pythonString('tab\there')).toBe('"tab\\there"')
  })

  it('round-trips awkward text through real Python unchanged', async () => {
    const awkward = 'quote " backslash \\ newline \n tab \t end'
    const src = `answer = ${pythonString(awkward)}\n`
    const r = await runProgram(src, { 1: 'c1' })
    expect(objectOf(finalEvent(r), 'answer')!.text).toBe(awkward)
  })

  it('cannot be escaped out of by student text', async () => {
    const attack = '" + __import__("os").name + "'
    const src = `answer = ${pythonString(attack)}\n`
    const r = await runProgram(src, { 1: 'c1' })
    expect(objectOf(finalEvent(r), 'answer')!.text).toBe(attack)
  })
})

describe('statements, indentation and source mapping', () => {
  const heavy = program(
    bind('result', list(), 'card-result'),
    forEach('weight', name('weights'), [
      iff(cmp('>', name('weight'), name('limit')), [
        append(name('result'), name('weight'), 'card-append'),
      ], [], 'card-if'),
    ], 'card-for'),
    bind('answer', name('result'), 'card-answer'),
  )

  it('emits the expected Python', () => {
    expect(emitProgram(heavy).source).toBe(
      [
        'result = []',
        'for weight in weights:',
        '    if weight > limit:',
        '        result.append(weight)',
        'answer = result',
        '',
      ].join('\n'),
    )
  })

  it('maps each line to the card that produced it', () => {
    const { lineToCard } = emitProgram(heavy)
    expect(lineToCard).toEqual({
      1: 'card-result', 2: 'card-for', 3: 'card-if', 4: 'card-append', 5: 'card-answer',
    })
  })

  it('emits pass for an empty block without claiming a card', () => {
    const p = program(forEach('n', list(int(1)), [], 'card-for'))
    const { source, lineToCard } = emitProgram(p)
    expect(source).toBe('for n in [1]:\n    pass\n')
    expect(lineToCard).toEqual({ 1: 'card-for' })
  })

  it('emits else as part of the same if card', () => {
    const p = program(iff(cmp('>', int(1), int(2)),
      [bind('x', int(1), 'card-then')], [bind('x', int(2), 'card-else')], 'card-if'))
    expect(emitProgram(p).source).toBe(
      'if 1 > 2:\n    x = 1\nelse:\n    x = 2\n',
    )
    expect(emitProgram(p).lineToCard).toEqual({ 1: 'card-if', 2: 'card-then', 4: 'card-else' })
  })

  it('produces a source map that real execution actually follows', async () => {
    const { source, lineToCard } = emitProgram(heavy)
    const r = await runProgram(source, lineToCard, 'weights = [2, 8, 5, 9]\nlimit = 5')
    const visited = r.events
      .filter((e) => e.phase === 'before-instruction')
      .map((e) => e.cardId)
    expect(visited[0]).toBe('card-result')
    expect(visited).toContain('card-append')
    expect(visited[visited.length - 1]).toBe('card-answer')
    expect(visited.every((c) => c !== null)).toBe(true)
    // Two of the four weights qualify, so the append card runs exactly twice.
    expect(visited.filter((c) => c === 'card-append')).toHaveLength(2)
  })
})

describe('emission refuses incomplete or unsafe programs', () => {
  it('rejects a hole with the offending node id', () => {
    const h: Expr = { kind: 'hole', id: 'hole-1' }
    expect(() => emitProgram(program(bind('x', h)))).toThrowError(EmitError)
    try {
      emitProgram(program(bind('x', h)))
    } catch (e) {
      expect((e as EmitError).nodeId).toBe('hole-1')
    }
  })

  it('rejects a name that is not a Python identifier', () => {
    expect(() => emitProgram(program(bind('my name', int(1))))).toThrowError(EmitError)
    expect(() => emitProgram(program(bind('for', int(1))))).toThrowError(EmitError)
    expect(() => emitProgram(program(bind('x); import os; (', int(1))))).toThrowError(EmitError)
  })

  it('rejects an invalid loop name', () => {
    expect(() => emitProgram(program(forEach('1bad', list(), [])))).toThrowError(EmitError)
  })
})
