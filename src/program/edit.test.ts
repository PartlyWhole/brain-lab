import { describe, it, expect } from 'vitest'
import type { Expr, Program, Stmt } from './types'
import {
  locate, findStmt, contains, insertStmt, removeStmt, moveStmt,
  replaceExpr, updateStmt, validate, canRun,
} from './edit'
import { emitProgram } from './emit'

const int = (n: number, id = `i${n}`): Expr => ({ kind: 'int', id, text: String(n) })
const nm = (name: string, id = `n-${name}`): Expr => ({ kind: 'name', id, name })
const bind = (id: string, name: string, value: Expr): Stmt => ({ kind: 'bind', id, name, value })

const nested: Program = {
  schemaVersion: 1,
  missionId: 'm',
  body: [
    bind('a', 'x', int(1)),
    {
      kind: 'for', id: 'loop', loopName: 'w', iterable: nm('xs'),
      body: [
        {
          kind: 'if', id: 'cond',
          condition: { kind: 'compare', id: 'cmp', op: '>', left: nm('w'), right: int(5) },
          then: [bind('b', 'y', int(2))],
          otherwise: [bind('c', 'z', int(3))],
        },
      ],
    },
    bind('d', 'answer', nm('y')),
  ],
}

describe('locating statements', () => {
  it('finds a top-level statement', () => {
    expect(locate(nested, 'a')).toEqual({ parentId: null, slot: 'body', index: 0 })
    expect(locate(nested, 'd')).toEqual({ parentId: null, slot: 'body', index: 2 })
  })

  it('finds statements in each block slot', () => {
    expect(locate(nested, 'cond')).toEqual({ parentId: 'loop', slot: 'body', index: 0 })
    expect(locate(nested, 'b')).toEqual({ parentId: 'cond', slot: 'then', index: 0 })
    expect(locate(nested, 'c')).toEqual({ parentId: 'cond', slot: 'otherwise', index: 0 })
  })

  it('reports containment', () => {
    expect(contains(nested, 'loop', 'b')).toBe(true)
    expect(contains(nested, 'cond', 'b')).toBe(true)
    expect(contains(nested, 'cond', 'a')).toBe(false)
  })
})

describe('insert and remove', () => {
  it('inserts at an index inside a block', () => {
    const next = insertStmt(nested, { parentId: 'cond', slot: 'then', index: 0 },
      bind('new', 'q', int(9)))
    expect((findStmt(next, 'cond') as Extract<Stmt, { kind: 'if' }>).then.map((s) => s.id))
      .toEqual(['new', 'b'])
  })

  it('clamps an out-of-range index instead of losing the statement', () => {
    const next = insertStmt(nested, { parentId: null, slot: 'body', index: 99 },
      bind('new', 'q', int(9)))
    expect(next.body.map((s) => s.id)).toEqual(['a', 'loop', 'd', 'new'])
  })

  it('removes a nested statement without touching its siblings', () => {
    const next = removeStmt(nested, 'b')
    expect((findStmt(next, 'cond') as Extract<Stmt, { kind: 'if' }>).then).toEqual([])
    expect((findStmt(next, 'cond') as Extract<Stmt, { kind: 'if' }>).otherwise).toHaveLength(1)
  })

  it('leaves the tree untouched when the id is unknown', () => {
    expect(removeStmt(nested, 'nope')).toEqual(nested)
  })

  it('does not mutate the original tree', () => {
    const before = JSON.stringify(nested)
    removeStmt(nested, 'b')
    insertStmt(nested, { parentId: null, slot: 'body', index: 0 }, bind('z', 'q', int(1)))
    expect(JSON.stringify(nested)).toBe(before)
  })
})

describe('moving statements', () => {
  it('moves a statement into a block', () => {
    const next = moveStmt(nested, 'a', { parentId: 'cond', slot: 'then', index: 1 })
    expect(next.body.map((s) => s.id)).toEqual(['loop', 'd'])
    expect((findStmt(next, 'cond') as Extract<Stmt, { kind: 'if' }>).then.map((s) => s.id))
      .toEqual(['b', 'a'])
  })

  it('accounts for the removed slot when moving later within one list', () => {
    // Moving index 0 to index 2 of the same list must land last, not
    // one short of it.
    const next = moveStmt(nested, 'a', { parentId: null, slot: 'body', index: 2 })
    expect(next.body.map((s) => s.id)).toEqual(['loop', 'a', 'd'])
  })

  it('moves earlier within one list without an off-by-one', () => {
    const next = moveStmt(nested, 'd', { parentId: null, slot: 'body', index: 0 })
    expect(next.body.map((s) => s.id)).toEqual(['d', 'a', 'loop'])
  })

  it('refuses to drop a block inside itself', () => {
    expect(moveStmt(nested, 'loop', { parentId: 'cond', slot: 'then', index: 0 })).toEqual(nested)
    expect(moveStmt(nested, 'cond', { parentId: 'cond', slot: 'then', index: 0 })).toEqual(nested)
  })
})

describe('editing expressions', () => {
  it('replaces a deeply nested operand', () => {
    const next = replaceExpr(nested, 'i5', int(7, 'i7'))
    expect(emitProgram(next).source).toContain('if w > 7:')
  })

  it('replaces an operand inside a list literal', () => {
    const p: Program = {
      schemaVersion: 1, missionId: 'm',
      body: [bind('a', 'xs', { kind: 'list', id: 'L', items: [int(1), int(2)] })],
    }
    expect(emitProgram(replaceExpr(p, 'i2', int(9, 'i9'))).source).toBe('xs = [1, 9]\n')
  })

  it('updates a statement field', () => {
    const next = updateStmt(nested, 'loop', { loopName: 'parcel' })
    expect(emitProgram(next).source).toContain('for parcel in xs:')
  })
})

describe('validation', () => {
  const runnable: Program = {
    schemaVersion: 1, missionId: 'm',
    body: [
      bind('r', 'result', { kind: 'list', id: 'L', items: [] }),
      {
        kind: 'for', id: 'f', loopName: 'w', iterable: nm('weights'),
        body: [{
          kind: 'append', id: 'ap',
          target: nm('result', 'nr'), value: nm('w', 'nw'),
        }],
      },
    ],
  }

  it('accepts a complete method whose names are all available', () => {
    expect(validate(runnable, ['weights'])).toEqual([])
    expect(canRun(validate(runnable, ['weights']))).toBe(true)
  })

  it('treats an unfilled operand as a draft, not a mistake', () => {
    const p: Program = {
      schemaVersion: 1, missionId: 'm',
      body: [bind('a', 'x', { kind: 'hole', id: 'h1', label: 'a number' })],
    }
    const problems = validate(p)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ nodeId: 'h1', severity: 'draft' })
    expect(problems[0].message).toContain('a number')
  })

  it('reports a name nothing has been bound to', () => {
    const p: Program = {
      schemaVersion: 1, missionId: 'm',
      body: [bind('a', 'x', nm('mystery'))],
    }
    expect(validate(p, [])).toEqual([
      { nodeId: 'n-mystery', severity: 'error', message: 'Nothing is called "mystery" yet.' },
    ])
  })

  it('counts a loop name as bound inside its own loop', () => {
    expect(validate(runnable, ['weights']).filter((p) => p.nodeId === 'nw')).toEqual([])
  })

  it('rejects a name that is not a Python identifier', () => {
    const p: Program = {
      schemaVersion: 1, missionId: 'm', body: [bind('a', 'my name', int(1))],
    }
    expect(validate(p)[0]).toMatchObject({ severity: 'error' })
  })

  it('reports an empty block as a draft', () => {
    const p: Program = {
      schemaVersion: 1, missionId: 'm',
      body: [{ kind: 'for', id: 'f', loopName: 'w', iterable: nm('xs'), body: [] }],
    }
    expect(validate(p, ['xs'])).toEqual([
      { nodeId: 'f', severity: 'draft', message: 'This for has no instructions inside it yet.' },
    ])
  })

  it('rejects stop-loop outside a loop and accepts it inside one', () => {
    const outside: Program = {
      schemaVersion: 1, missionId: 'm', body: [{ kind: 'break', id: 'b' }],
    }
    expect(validate(outside)[0]).toMatchObject({ nodeId: 'b', severity: 'error' })

    const inside: Program = {
      schemaVersion: 1, missionId: 'm',
      body: [{
        kind: 'for', id: 'f', loopName: 'w', iterable: nm('xs'),
        body: [{ kind: 'break', id: 'b' }],
      }],
    }
    expect(validate(inside, ['xs'])).toEqual([])
  })
})

describe('a method that is not written yet', () => {
  const empty: Program = { schemaVersion: 1, missionId: 'm', body: [] }

  it('reports an empty method as a draft, so it cannot be tested', () => {
    const problems = validate(empty, ['weights'], 'answer')
    expect(canRun(problems)).toBe(false)
    expect(problems[0].message).toBe('Pip has no instructions yet.')
  })

  it('reports a method that never binds the answer', () => {
    const p: Program = {
      schemaVersion: 1, missionId: 'm',
      body: [bind('a', 'result', { kind: 'list', id: 'L', items: [] })],
    }
    const problems = validate(p, [], 'answer')
    expect(canRun(problems)).toBe(false)
    expect(problems.map((x) => x.message))
      .toContain('Nothing points answer at the result yet.')
  })

  it('accepts a method that does bind the answer, including inside a block', () => {
    const p: Program = {
      schemaVersion: 1, missionId: 'm',
      body: [
        bind('a', 'result', { kind: 'list', id: 'L', items: [] }),
        bind('b', 'answer', nm('result', 'nr')),
      ],
    }
    expect(validate(p, [], 'answer')).toEqual([])
  })

  it('does not ask for an answer when the mission does not name one', () => {
    const p: Program = {
      schemaVersion: 1, missionId: 'm',
      body: [bind('a', 'x', int(1))],
    }
    expect(validate(p)).toEqual([])
  })
})
