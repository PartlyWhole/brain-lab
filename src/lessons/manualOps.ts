/**
 * The manual tool palette.
 *
 * Each tool declares what it needs, in order, and how to turn the collected
 * inputs into a semantic command for python/session.py. The interaction is
 * always the same: choose an operation, supply its inputs, then perform it.
 *
 * Nothing here changes state. Building a command is not doing it — a prepared
 * action must not alter the brain until the student commits, which is why the
 * command is only sent on `perform`.
 *
 * Each tool also states its result and its effect separately, because they are
 * different things: append changes a list and produces None.
 */
import type { ManualTool } from './schema'
import type { SelectableReference } from '../runtime/types'

/** What the student is being asked to point at. */
export type InputKind = 'reference' | 'number' | 'text' | 'name' | 'slotIndex' | 'operator'

export interface ToolInput {
  id: string
  kind: InputKind
  /** Shown in the selection prompt. Short, plain. */
  prompt: string
}

export interface ToolSpec {
  id: ManualTool
  label: string
  /** One line: what it does. */
  summary: string
  /** What it produces. */
  result: string
  /** What it changes. 'nothing' is a real and important answer. */
  effect: string
  inputs: ToolInput[]
}

export const TOOLS: Record<ManualTool, ToolSpec> = {
  makeInt: {
    id: 'makeInt', label: 'Make a number', summary: 'Create a number object.',
    result: 'the new number', effect: 'nothing else',
    inputs: [{ id: 'text', kind: 'number', prompt: 'Which number?' }],
  },
  makeStr: {
    id: 'makeStr', label: 'Make some text', summary: 'Create a text object.',
    result: 'the new text', effect: 'nothing else',
    inputs: [{ id: 'value', kind: 'text', prompt: 'Which text?' }],
  },
  makeList: {
    id: 'makeList', label: 'Make an empty list', summary: 'Create a new list with no slots.',
    result: 'the new list', effect: 'nothing else',
    inputs: [],
  },
  lookup: {
    id: 'lookup', label: 'Follow a name', summary: 'Find what a name refers to right now.',
    result: 'the object the name refers to', effect: 'nothing',
    inputs: [{ id: 'ref', kind: 'reference', prompt: 'Which name or slot?' }],
  },
  bind: {
    id: 'bind', label: 'Point a name', summary: 'Make a name refer to an object.',
    result: 'nothing', effect: 'the name now refers to that object',
    inputs: [
      { id: 'ref', kind: 'reference', prompt: 'Point at which object?' },
      { id: 'name', kind: 'name', prompt: 'What should it be called?' },
    ],
  },
  append: {
    id: 'append', label: 'Add to a list', summary: 'Add one more slot at the end of a list.',
    result: 'None', effect: 'the list gets one more slot',
    inputs: [
      { id: 'target', kind: 'reference', prompt: 'Which list?' },
      { id: 'value', kind: 'reference', prompt: 'Add what?' },
    ],
  },
  setSlot: {
    id: 'setSlot', label: 'Replace a slot', summary: 'Make one slot refer to something else.',
    result: 'nothing', effect: 'that slot refers to a different object',
    inputs: [
      { id: 'target', kind: 'reference', prompt: 'Which list?' },
      { id: 'index', kind: 'slotIndex', prompt: 'Which slot number?' },
      { id: 'value', kind: 'reference', prompt: 'Put what in it?' },
    ],
  },
  readSlot: {
    id: 'readSlot', label: 'Read a slot', summary: 'Look at what one slot refers to.',
    result: 'the object in that slot', effect: 'nothing',
    inputs: [
      { id: 'target', kind: 'reference', prompt: 'Which list?' },
      { id: 'index', kind: 'slotIndex', prompt: 'Which slot number?' },
    ],
  },
  length: {
    id: 'length', label: 'How many?', summary: 'Count the slots in a list.',
    result: 'a number', effect: 'nothing',
    inputs: [{ id: 'target', kind: 'reference', prompt: 'Count what?' }],
  },
  add: {
    id: 'add', label: 'Add two things', summary: 'Work out a new value from two others.',
    result: 'a new object', effect: 'nothing — the inputs are unchanged',
    inputs: [
      { id: 'left', kind: 'reference', prompt: 'Add which one first?' },
      { id: 'right', kind: 'reference', prompt: 'And which one to it?' },
    ],
  },
  compare: {
    id: 'compare', label: 'Compare two things', summary: 'Ask a question that answers True or False.',
    result: 'True or False', effect: 'nothing',
    inputs: [
      { id: 'left', kind: 'reference', prompt: 'Compare which one?' },
      { id: 'operator', kind: 'operator', prompt: 'Which question?' },
      { id: 'right', kind: 'reference', prompt: 'With which one?' },
    ],
  },
  print: {
    id: 'print', label: 'Say it out loud', summary: 'Write something in the output panel.',
    result: 'None', effect: 'the output panel gets a new line',
    inputs: [{ id: 'ref', kind: 'reference', prompt: 'Say what?' }],
  },
  discard: {
    id: 'discard', label: 'Clear a work item', summary: 'Tidy away a work-area item.',
    result: 'nothing', effect: 'the work area loses that item',
    inputs: [{ id: 'slotId', kind: 'reference', prompt: 'Clear which work item?' }],
  },
}

/**
 * A value an operation can take: something picked in the brain, or a literal
 * typed into the preparation panel. The pickable part is exactly the brain's
 * own reference type.
 */
export type Reference =
  | SelectableReference
  | { kind: 'literalInt'; text: string }
  | { kind: 'literalStr'; value: string }

export type InputValue = Reference | string | number

export interface PreparedOperation {
  tool: ManualTool
  /** Collected so far, keyed by input id. */
  values: Record<string, InputValue>
  /** The next input still needed, or null when the operation is ready. */
  next: ToolInput | null
}

export function beginOperation(tool: ManualTool): PreparedOperation {
  return { tool, values: {}, next: TOOLS[tool].inputs[0] ?? null }
}

export function supply(op: PreparedOperation, value: InputValue): PreparedOperation {
  if (!op.next) return op
  const values = { ...op.values, [op.next.id]: value }
  const spec = TOOLS[op.tool]
  const remaining = spec.inputs.filter((i) => !(i.id in values))
  return { tool: op.tool, values, next: remaining[0] ?? null }
}

export function isReady(op: PreparedOperation): boolean {
  return op.next === null
}

/** Removes the most recently supplied input, so a misclick is not a dead end. */
export function undoLastInput(op: PreparedOperation): PreparedOperation {
  const spec = TOOLS[op.tool]
  const supplied = spec.inputs.filter((i) => i.id in op.values)
  if (supplied.length === 0) return beginOperation(op.tool)
  const last = supplied[supplied.length - 1]
  const values = { ...op.values }
  delete values[last.id]
  const remaining = spec.inputs.filter((i) => !(i.id in values))
  return { tool: op.tool, values, next: remaining[0] ?? null }
}

/**
 * Builds the command for session.py. Returns null while inputs are missing,
 * so a half-built operation can never be sent.
 */
export function toCommand(op: PreparedOperation): Record<string, unknown> | null {
  if (!isReady(op)) return null
  const v = op.values
  switch (op.tool) {
    case 'makeInt': return { op: 'makeInt', text: String(v.text) }
    case 'makeStr': return { op: 'makeStr', value: String(v.value) }
    case 'makeList': return { op: 'makeList', items: [] }
    case 'lookup': return { op: 'lookup', ref: v.ref }
    case 'bind': return { op: 'bind', name: String(v.name), ref: v.ref }
    case 'append': return { op: 'append', target: v.target, value: v.value }
    case 'setSlot':
      return { op: 'setSlot', target: v.target, index: Number(v.index), value: v.value }
    case 'readSlot': return { op: 'readSlot', target: v.target, index: Number(v.index) }
    case 'length': return { op: 'length', target: v.target }
    case 'add': return { op: 'add', left: v.left, right: v.right }
    case 'compare':
      return { op: 'compare', operator: String(v.operator), left: v.left, right: v.right }
    case 'print': return { op: 'print', ref: v.ref }
    case 'discard': {
      const ref = v.slotId as Reference
      return { op: 'discard', slotId: ref.kind === 'work' ? ref.slotId : String(v.slotId) }
    }
  }
}

/** A plain sentence describing a prepared operation, for the confirm step. */
export function describeOperation(op: PreparedOperation): string {
  const spec = TOOLS[op.tool]
  const parts = spec.inputs
    .filter((i) => i.id in op.values)
    .map((i) => describeValue(op.values[i.id]))
  return parts.length === 0 ? spec.label : `${spec.label}: ${parts.join(', ')}`
}

function describeValue(value: InputValue): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  switch (value.kind) {
    case 'name': return value.name
    case 'work': return 'the work-area item'
    case 'slot': return `slot ${value.index}`
    case 'literalInt': return value.text
    case 'literalStr': return `“${value.value}”`
  }
}
