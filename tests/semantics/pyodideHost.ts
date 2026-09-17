/**
 * Test-only Pyodide host.
 *
 * Boots one Pyodide instance for the whole semantic suite and loads the exact
 * same `python/observe.py` that the browser worker loads, so these tests
 * exercise the shipped observer rather than a copy of it.
 */
import { loadPyodide, type PyodideInterface } from 'pyodide'
import observeSource from '../../python/observe.py?raw'

export interface SerializedObject {
  id: string
  type: string
  text?: string
  value?: boolean
  slots?: string[]
  entries?: { key: string; value: string }[]
  items?: string[]
  length?: number
  truncated?: boolean
  name?: string
  label?: string
}

export interface Snapshot {
  objects: Record<string, SerializedObject>
  scopes: {
    id: string
    kind: string
    label: string
    parentId: string | null
    bindings: { name: string; objectId: string }[]
  }[]
  outputLength: number
  truncated: boolean
}

export interface TraceEvent {
  seq: number
  phase: 'before-instruction' | 'call' | 'return' | 'error' | 'end'
  line: number
  cardId: string | null
  frameId: string
  functionName: string
  snapshot: Snapshot
  returnedObjectId?: string
  error?: { kind: string; message: string }
}

export interface RunResult {
  events: TraceEvent[]
  output: string
  outputTruncated: boolean
  stoppedForBudget: boolean
  error: null | {
    kind: string
    message: string
    line: number | null
    cardId: string | null
    phase: string
  }
  globals: {
    objects: Record<string, SerializedObject>
    bindings: { name: string; objectId: string }[]
    truncated: boolean
  }
}

let cached: Promise<PyodideInterface> | null = null

export function getPyodide(): Promise<PyodideInterface> {
  if (!cached) {
    cached = (async () => {
      const py = await loadPyodide()
      py.FS.mkdirTree('/rbl')
      py.FS.writeFile('/rbl/observe.py', observeSource, { encoding: 'utf8' })
      py.runPython(`import sys\nsys.path.insert(0, '/rbl')\nimport observe`)
      return py
    })()
  }
  return cached
}

/** Runs a student program through the observer and returns plain data. */
export async function runProgram(
  source: string,
  lineToCard: Record<number, string> = {},
  setup = '',
  budgets: Record<string, number> = {},
): Promise<RunResult> {
  const py = await getPyodide()
  py.globals.set('_rbl_source', source)
  py.globals.set('_rbl_map', JSON.stringify(lineToCard))
  py.globals.set('_rbl_setup', setup)
  py.globals.set('_rbl_budgets', JSON.stringify(budgets))
  const json = py.runPython(`
import json, observe
_m = {int(k): v for k, v in json.loads(_rbl_map).items()}
_setup_ns = {}
if _rbl_setup:
    exec(_rbl_setup, {'__builtins__': __builtins__}, _setup_ns)
_b = observe.Budgets(**json.loads(_rbl_budgets))
json.dumps(observe.run_program(_rbl_source, _m, _setup_ns, _b))
`) as string
  return JSON.parse(json) as RunResult
}

/**
 * Independent oracle: runs the same source with no tracer, no restricted
 * builtins and no serializer, then reports plain values via repr. Used to show
 * the observer does not alter the behaviour it claims to describe.
 */
export async function runUninstrumented(
  source: string,
  names: string[],
): Promise<Record<string, string>> {
  const py = await getPyodide()
  py.globals.set('_rbl_source', source)
  py.globals.set('_rbl_names', JSON.stringify(names))
  const json = py.runPython(`
import json
_ns = {}
exec(_rbl_source, _ns)
json.dumps({n: repr(_ns.get(n)) for n in json.loads(_rbl_names)})
`) as string
  return JSON.parse(json) as Record<string, string>
}

// -- helpers the tests read the graph with ---------------------------------

export function bindings(event: TraceEvent, scopeId = 'global'): Record<string, string> {
  const scope = event.snapshot.scopes.find((s) => s.id === scopeId)
  if (!scope) return {}
  return Object.fromEntries(scope.bindings.map((b) => [b.name, b.objectId]))
}

export function objectOf(event: TraceEvent, name: string, scopeId = 'global') {
  const id = bindings(event, scopeId)[name]
  return id ? event.snapshot.objects[id] : undefined
}

/** Reads a list binding back as plain JS values, following slot references. */
export function listValues(event: TraceEvent, name: string, scopeId = 'global') {
  const obj = objectOf(event, name, scopeId)
  if (!obj || !obj.slots) return undefined
  return obj.slots.map((sid) => scalar(event.snapshot.objects[sid]))
}

export function scalar(obj: SerializedObject | undefined): unknown {
  if (!obj) return undefined
  switch (obj.type) {
    case 'int':
      return BigInt(obj.text!)
    case 'float':
      return Number(obj.text)
    case 'str':
      return obj.text
    case 'bool':
      return obj.value
    case 'none':
      return null
    default:
      return obj.id
  }
}

export function ints(event: TraceEvent, name: string, scopeId = 'global') {
  const vals = listValues(event, name, scopeId)
  return vals?.map((v) => Number(v as bigint))
}

export function finalEvent(result: RunResult): TraceEvent {
  return result.events[result.events.length - 1]
}
