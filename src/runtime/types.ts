/**
 * The runtime contract: what the worker sends, and what the brain renders.
 *
 * Everything here is plain JSON. Python proxies never cross this boundary.
 * These types are mirrored by `python/observe.py`; the semantic suite in
 * tests/semantics pins the two together.
 */
import { z } from 'zod'

export const RUNTIME_SCHEMA_VERSION = 1

/* ------------------------------------------------------------------ */
/* Serialized object graph                                             */
/* ------------------------------------------------------------------ */

export const SerializedObjectSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('none') }),
  z.object({ id: z.string(), type: z.literal('bool'), value: z.boolean() }),
  // Decimal string: Python integers are unbounded, JS numbers are not.
  z.object({ id: z.string(), type: z.literal('int'), text: z.string() }),
  z.object({ id: z.string(), type: z.literal('float'), text: z.string() }),
  z.object({
    id: z.string(), type: z.literal('str'), text: z.string(),
    length: z.number(), truncated: z.boolean(),
  }),
  z.object({
    id: z.string(), type: z.literal('list'), slots: z.array(z.string()),
    length: z.number(), truncated: z.boolean(),
  }),
  z.object({
    id: z.string(), type: z.literal('tuple'), slots: z.array(z.string()),
    length: z.number(), truncated: z.boolean(),
  }),
  z.object({
    id: z.string(), type: z.literal('dict'),
    entries: z.array(z.object({ key: z.string(), value: z.string() })),
    length: z.number(), truncated: z.boolean(),
  }),
  z.object({
    id: z.string(), type: z.literal('set'), items: z.array(z.string()),
    length: z.number(), truncated: z.boolean(),
  }),
  z.object({ id: z.string(), type: z.literal('function'), name: z.string() }),
  z.object({ id: z.string(), type: z.literal('unsupported'), label: z.string() }),
  z.object({ id: z.string(), type: z.literal('elided') }),
])
export type SerializedObject = z.infer<typeof SerializedObjectSchema>

export const BindingSchema = z.object({ name: z.string(), objectId: z.string() })
export type Binding = z.infer<typeof BindingSchema>

export const ScopeSchema = z.object({
  id: z.string(),
  kind: z.enum(['global', 'call']),
  label: z.string(),
  parentId: z.string().nullable(),
  bindings: z.array(BindingSchema),
})
export type Scope = z.infer<typeof ScopeSchema>

export const SnapshotSchema = z.object({
  objects: z.record(z.string(), SerializedObjectSchema),
  scopes: z.array(ScopeSchema),
  outputLength: z.number(),
  truncated: z.boolean(),
})
export type Snapshot = z.infer<typeof SnapshotSchema>

/* ------------------------------------------------------------------ */
/* Trace events                                                        */
/* ------------------------------------------------------------------ */

/**
 * Phase labels are literal, not approximate.
 *
 * `before-instruction` means: this card is about to run, and the attached
 * snapshot is the state it will act on. The state a card produced is the
 * snapshot on the following event, which is why `end` always exists.
 */
export const TRACE_PHASES = ['before-instruction', 'call', 'return', 'error', 'end'] as const
export type TracePhase = (typeof TRACE_PHASES)[number]

export const RuntimeErrorSchema = z.object({
  kind: z.string(),
  message: z.string(),
  line: z.number().nullable().optional(),
  cardId: z.string().nullable().optional(),
  phase: z.string().optional(),
})
export type RuntimeError = z.infer<typeof RuntimeErrorSchema>

export const TraceEventSchema = z.object({
  seq: z.number(),
  phase: z.enum(TRACE_PHASES),
  line: z.number(),
  cardId: z.string().nullable(),
  frameId: z.string(),
  functionName: z.string(),
  snapshot: SnapshotSchema,
  returnedObjectId: z.string().optional(),
  error: z.object({ kind: z.string(), message: z.string() }).optional(),
})
export type TraceEvent = z.infer<typeof TraceEventSchema>

export const RunResultSchema = z.object({
  events: z.array(TraceEventSchema),
  output: z.string(),
  outputTruncated: z.boolean(),
  stoppedForBudget: z.boolean(),
  error: RuntimeErrorSchema.nullable(),
  globals: z.object({
    objects: z.record(z.string(), SerializedObjectSchema),
    bindings: z.array(BindingSchema),
    truncated: z.boolean(),
  }).optional(),
})
export type RunResult = z.infer<typeof RunResultSchema>

/* ------------------------------------------------------------------ */
/* Worker protocol                                                     */
/* ------------------------------------------------------------------ */

export const WorkerRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('init'), requestId: z.string(), runtimeUrl: z.string() }),
  z.object({
    type: z.literal('run'),
    requestId: z.string(),
    source: z.string(),
    lineToCard: z.record(z.string(), z.string()),
    setup: z.string().default(''),
    budgets: z.record(z.string(), z.number()).default({}),
  }),
  z.object({
    type: z.literal('manual'),
    requestId: z.string(),
    sessionId: z.string(),
    /** Ordered semantic commands replayed from the mission setup. */
    setup: z.string().default(''),
    commands: z.array(z.unknown()),
    checkSource: z.string().default(''),
  }),
  z.object({
    type: z.literal('checkContract'),
    requestId: z.string(),
    source: z.string(),
    lineToCard: z.record(z.string(), z.string()),
    checkSource: z.string(),
    cases: z.array(z.unknown()),
    misconceptions: z.array(z.unknown()).default([]),
  }),
])
export type WorkerRequest = z.infer<typeof WorkerRequestSchema>

export const WorkerResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    requestId: z.string(),
    pythonVersion: z.string(),
    startupMs: z.number(),
  }),
  z.object({ type: z.literal('progress'), requestId: z.string(), message: z.string() }),
  z.object({ type: z.literal('runResult'), requestId: z.string(), result: RunResultSchema }),
  z.object({ type: z.literal('manualResult'), requestId: z.string(), result: z.unknown() }),
  z.object({ type: z.literal('contractResult'), requestId: z.string(), result: z.unknown() }),
  z.object({
    type: z.literal('failed'),
    requestId: z.string(),
    error: z.object({ kind: z.string(), message: z.string() }),
  }),
])
export type WorkerResponse = z.infer<typeof WorkerResponseSchema>

/* ------------------------------------------------------------------ */
/* Reading the graph                                                   */
/* ------------------------------------------------------------------ */

export function bindingsOf(snapshot: Snapshot, scopeId = 'global'): Binding[] {
  return snapshot.scopes.find((s) => s.id === scopeId)?.bindings ?? []
}

/** Human-readable one-line value, used in labels and feedback sentences. */
export function describeObject(
  snapshot: Snapshot,
  objectId: string | undefined,
  depth = 0,
): string {
  if (!objectId) return '?'
  const obj = snapshot.objects[objectId]
  if (!obj) return '?'
  if (depth > 2) return '…'
  switch (obj.type) {
    case 'none': return 'None'
    case 'bool': return obj.value ? 'True' : 'False'
    case 'int':
    case 'float': return obj.text
    case 'str': return JSON.stringify(obj.text) + (obj.truncated ? '…' : '')
    case 'list':
      return `[${obj.slots.map((s) => describeObject(snapshot, s, depth + 1)).join(', ')}${obj.truncated ? ', …' : ''}]`
    case 'tuple':
      return `(${obj.slots.map((s) => describeObject(snapshot, s, depth + 1)).join(', ')}${obj.slots.length === 1 ? ',' : ''})`
    case 'dict':
      return `{${obj.entries.map((e) => `${describeObject(snapshot, e.key, depth + 1)}: ${describeObject(snapshot, e.value, depth + 1)}`).join(', ')}}`
    case 'set':
      return obj.items.length === 0
        ? 'set()'
        : `{${obj.items.map((s) => describeObject(snapshot, s, depth + 1)).join(', ')}}`
    case 'function': return `${obj.name}()`
    case 'unsupported': return obj.label
    case 'elided': return '…'
  }
}

/** Object ids reachable from a scope's bindings, for reference-arrow drawing. */
export function reachableFrom(snapshot: Snapshot, rootIds: string[]): Set<string> {
  const seen = new Set<string>()
  const queue = [...rootIds]
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const obj = snapshot.objects[id]
    if (!obj) continue
    if (obj.type === 'list' || obj.type === 'tuple') queue.push(...obj.slots)
    else if (obj.type === 'set') queue.push(...obj.items)
    else if (obj.type === 'dict') obj.entries.forEach((e) => queue.push(e.key, e.value))
  }
  return seen
}

/** How many references point at each object; used to show real sharing. */
export function referenceCounts(snapshot: Snapshot): Record<string, number> {
  const counts: Record<string, number> = {}
  const bump = (id: string) => { counts[id] = (counts[id] ?? 0) + 1 }
  for (const scope of snapshot.scopes) for (const b of scope.bindings) bump(b.objectId)
  for (const obj of Object.values(snapshot.objects)) {
    if (obj.type === 'list' || obj.type === 'tuple') obj.slots.forEach(bump)
    else if (obj.type === 'set') obj.items.forEach(bump)
    else if (obj.type === 'dict') obj.entries.forEach((e) => { bump(e.key); bump(e.value) })
  }
  return counts
}

/* ------------------------------------------------------------------ */
/* References the student can point at                                 */
/* ------------------------------------------------------------------ */

/**
 * The canonical shape of a reference into the brain, mirroring the reference
 * kinds `python/session.py` resolves. The brain's own `BrainReference` is
 * structurally identical, so the two are interchangeable without either module
 * importing the other.
 */
export type SelectableReference =
  | { kind: 'name'; name: string }
  | { kind: 'work'; slotId: string }
  | { kind: 'slot'; target: SelectableReference; index: number }

export function isSelectableReference(value: unknown): value is SelectableReference {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return false
  const kind = (value as { kind: unknown }).kind
  return kind === 'name' || kind === 'work' || kind === 'slot'
}
