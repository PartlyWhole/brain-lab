import { describe, it, expect } from 'vitest'
import {
  TOOLS, beginOperation, supply, isReady, undoLastInput, toCommand, describeOperation,
  type Reference,
} from './manualOps'

const listRef: Reference = { kind: 'name', name: 'supplies' }
const workRef: Reference = { kind: 'work', slotId: 'w1' }

describe('preparing an operation', () => {
  it('asks for inputs in order and is not ready until they are all supplied', () => {
    let op = beginOperation('append')
    expect(op.next?.prompt).toBe('Which list?')
    expect(isReady(op)).toBe(false)
    expect(toCommand(op)).toBeNull()

    op = supply(op, listRef)
    expect(op.next?.prompt).toBe('Add what?')
    expect(isReady(op)).toBe(false)
    expect(toCommand(op)).toBeNull()

    op = supply(op, workRef)
    expect(isReady(op)).toBe(true)
    expect(toCommand(op)).toEqual({ op: 'append', target: listRef, value: workRef })
  })

  it('is ready immediately when a tool needs nothing', () => {
    const op = beginOperation('makeList')
    expect(isReady(op)).toBe(true)
    expect(toCommand(op)).toEqual({ op: 'makeList', items: [] })
  })

  it('lets a misclick be taken back without starting over', () => {
    let op = beginOperation('setSlot')
    op = supply(op, listRef)
    op = supply(op, 2)
    expect(op.next?.prompt).toBe('Put what in it?')

    op = undoLastInput(op)
    expect(op.next?.prompt).toBe('Which slot number?')
    expect(op.values.target).toEqual(listRef)

    op = undoLastInput(op)
    expect(op.next?.prompt).toBe('Which list?')
    expect(op.values).toEqual({})
  })

  it('undoing past the start returns a clean operation', () => {
    expect(undoLastInput(beginOperation('append'))).toEqual(beginOperation('append'))
  })
})

describe('building commands', () => {
  it('builds every tool command in the shape session.py resolves', () => {
    const ready = (tool: Parameters<typeof beginOperation>[0], ...values: unknown[]) => {
      let op = beginOperation(tool)
      for (const v of values) op = supply(op, v as never)
      return toCommand(op)
    }

    expect(ready('makeInt', '42')).toEqual({ op: 'makeInt', text: '42' })
    expect(ready('bind', workRef, 'bag')).toEqual({ op: 'bind', name: 'bag', ref: workRef })
    expect(ready('readSlot', listRef, '1')).toEqual({ op: 'readSlot', target: listRef, index: 1 })
    expect(ready('compare', listRef, '>', workRef))
      .toEqual({ op: 'compare', operator: '>', left: listRef, right: workRef })
    expect(ready('discard', workRef)).toEqual({ op: 'discard', slotId: 'w1' })
  })

  it('coerces slot numbers to numbers, not strings', () => {
    let op = beginOperation('setSlot')
    op = supply(op, listRef)
    op = supply(op, '2')
    op = supply(op, workRef)
    expect(toCommand(op)).toMatchObject({ index: 2 })
  })
})

describe('what each tool claims about itself', () => {
  it('states result and effect separately for every tool', () => {
    for (const spec of Object.values(TOOLS)) {
      expect(spec.result.length).toBeGreaterThan(0)
      expect(spec.effect.length).toBeGreaterThan(0)
    }
  })

  it('says append produces None while changing the list', () => {
    expect(TOOLS.append.result).toBe('None')
    expect(TOOLS.append.effect).toContain('one more slot')
  })

  it('says reading and comparing change nothing', () => {
    expect(TOOLS.readSlot.effect).toBe('nothing')
    expect(TOOLS.compare.effect).toBe('nothing')
    expect(TOOLS.add.effect).toContain('unchanged')
  })
})

describe('describing a prepared operation', () => {
  it('reads as a sentence before it is performed', () => {
    let op = beginOperation('bind')
    op = supply(op, { kind: 'name', name: 'supplies' })
    op = supply(op, 'bag')
    expect(describeOperation(op)).toBe('Point a name: supplies, bag')
  })
})
