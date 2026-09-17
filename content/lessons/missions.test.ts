/**
 * Content verification.
 *
 * The schema tests are cheap gates. The important ones are the Python tests
 * below: for every invention mission a hand-written correct method must pass
 * every case, and every hand-written buggy method must FAIL, on the case it
 * was aimed at, with a message that names the real problem. A case set that
 * cannot tell a good method from a bad one is decoration, and these tests are
 * what stop it from shipping as if it were teaching.
 *
 * Python runs through the same `python/session.py` and `python/contracts.py`
 * the browser worker loads, on top of the shared Pyodide instance in
 * tests/semantics/pyodideHost.ts.
 */
import { describe, expect, it } from 'vitest'
import type { PyodideInterface } from 'pyodide'

import { getPyodide } from '../../tests/semantics/pyodideHost'
import sessionSource from '../../python/session.py?raw'
import contractsSource from '../../python/contracts.py?raw'

import { parseMission, type InventGoal, type ManualGoal, type Mission } from '../../src/lessons/schema'
import { ProgramSchema } from '../../src/program/types'
import { emitProgram } from '../../src/program/emit'
import { missions, rawMissions } from './index'
import { coverage } from '../coverage/manifest'

/* ------------------------------------------------------------------ */
/* Pyodide helpers (local to this file; pyodideHost is left untouched) */
/* ------------------------------------------------------------------ */

let labRuntime: Promise<PyodideInterface> | null = null

/** The shared runtime, with session.py and contracts.py added beside observe.py. */
function getLabPyodide(): Promise<PyodideInterface> {
  if (!labRuntime) {
    labRuntime = (async () => {
      const py = await getPyodide()
      py.FS.writeFile('/rbl/session.py', sessionSource, { encoding: 'utf8' })
      py.FS.writeFile('/rbl/contracts.py', contractsSource, { encoding: 'utf8' })
      py.runPython('import session, contracts')
      return py
    })()
  }
  return labRuntime
}

interface CaseResult {
  caseId: string
  label: string
  passed: boolean
  message: string
  error: null | { kind: string; message: string; line: number | null }
  hidden: boolean
}
interface CheckReport {
  passed: boolean
  cases: CaseResult[]
  firstFailure: CaseResult | null
}

/** Grades one candidate method against a mission's cases, in real Python. */
async function gradeMethod(goal: InventGoal, source: string): Promise<CheckReport> {
  const py = await getLabPyodide()
  py.globals.set('_rbl_src', source)
  py.globals.set('_rbl_cases', JSON.stringify(goal.cases))
  py.globals.set('_rbl_check', goal.checkSource)
  const json = py.runPython(`
import json, contracts
json.dumps(contracts.check(_rbl_src, json.loads(_rbl_cases), _rbl_check))
`) as string
  return JSON.parse(json) as CheckReport
}

interface ManualResult {
  error: null | { index: number; kind: string; message: string }
  check: null | { done: boolean; message: string }
}

/** Replays a manual command list from the mission setup and grades the state. */
async function runManual(
  mission: Mission,
  commands: unknown[],
): Promise<ManualResult> {
  const goal = mission.goal as ManualGoal
  const py = await getLabPyodide()
  py.globals.set('_rbl_setup', mission.setupSource)
  py.globals.set('_rbl_cmds', JSON.stringify(commands))
  py.globals.set('_rbl_check', goal.checkSource)
  const json = py.runPython(`
import json, session
_r = session.run_commands_and_check(_rbl_setup, json.loads(_rbl_cmds), _rbl_check)
json.dumps({"error": _r["error"], "check": _r["check"]})
`) as string
  return JSON.parse(json) as ManualResult
}

/**
 * Evaluates a misconception's `when` in the invent checker's environment.
 *
 * The names are supplied as *globals*, not locals, because several conditions
 * contain comprehensions and a comprehension's body cannot see an eval frame's
 * locals. Anything that evaluates them at play time must do the same.
 */
interface WhenRow {
  when: string
  caseId: string
  value: unknown
  isBool: boolean
  error: string | null
}

async function evalInventWhens(
  goal: InventGoal,
  source: string,
  whens: string[],
): Promise<WhenRow[]> {
  const py = await getLabPyodide()
  py.globals.set('_rbl_src', source)
  py.globals.set('_rbl_cases', JSON.stringify(goal.cases))
  py.globals.set('_rbl_whens', JSON.stringify(whens))
  const json = py.runPython(`
import json, contracts
_out = []
for _case in json.loads(_rbl_cases):
    _run = contracts.run_case(_rbl_src, _case)
    for _w in json.loads(_rbl_whens):
        _env = {"__builtins__": __builtins__, "case": _case, "ns": _run["ns"],
                "original": _run["original"], "identities": _run["identities"],
                "error": _run["error"]}
        try:
            _v = eval(_w, _env)
            _out.append({"when": _w, "caseId": _case["id"],
                         "value": _v if isinstance(_v, bool) else repr(_v),
                         "isBool": isinstance(_v, bool), "error": None})
        except Exception as _e:
            _out.append({"when": _w, "caseId": _case["id"], "value": None,
                         "isBool": False, "error": repr(_e)})
json.dumps(_out)
`) as string
  return JSON.parse(json) as WhenRow[]
}

/** Evaluates a manual misconception's `when` against a replayed command list. */
async function evalManualWhens(
  mission: Mission,
  commands: unknown[],
  whens: string[],
): Promise<{ when: string; isBool: boolean; error: string | null }[]> {
  const py = await getLabPyodide()
  py.globals.set('_rbl_setup', mission.setupSource)
  py.globals.set('_rbl_cmds', JSON.stringify(commands))
  py.globals.set('_rbl_whens', JSON.stringify(whens))
  const json = py.runPython(`
import json, session
_s = session.Session(_rbl_setup)
for _c in json.loads(_rbl_cmds):
    _s.apply(_c)

def _aliases(a, b):
    return (a in _s.bindings and b in _s.bindings
            and _s.bindings[a] is _s.bindings[b])

_names = dict(_s.bindings)
_work = [{"slotId": e["slotId"], "label": e["label"], "object": e["object"]}
         for e in _s.work_area]
_out = []
for _w in json.loads(_rbl_whens):
    _env = {"__builtins__": __builtins__, "names": _names, "work": _work,
            "output": _s.recorder.text(), "aliases": _aliases}
    try:
        _v = eval(_w, _env)
        _out.append({"when": _w, "isBool": isinstance(_v, bool), "error": None})
    except Exception as _e:
        _out.append({"when": _w, "isBool": False, "error": repr(_e)})
json.dumps(_out)
`) as string
  return JSON.parse(json) as { when: string; isBool: boolean; error: string | null }[]
}

function inventGoal(id: string): InventGoal {
  const m = missions.find((x) => x.id === id)
  if (!m || m.goal.kind !== 'invent') throw new Error(`${id} is not an invention mission`)
  return m.goal
}

function manualMission(id: string): Mission {
  const m = missions.find((x) => x.id === id)
  if (!m || m.goal.kind !== 'manual') throw new Error(`${id} is not a manual mission`)
  return m
}

/** Case ids that failed, in case order. */
function failed(report: CheckReport): string[] {
  return report.cases.filter((c) => !c.passed).map((c) => c.caseId)
}

function messageFor(report: CheckReport, caseId: string): string {
  const c = report.cases.find((x) => x.caseId === caseId)
  if (!c) throw new Error(`no case ${caseId}`)
  return c.message
}

/* ------------------------------------------------------------------ */
/* 1-3. Schema, ids, hint ladders                                      */
/* ------------------------------------------------------------------ */

describe('mission definitions', () => {
  it('every mission satisfies MissionSchema', () => {
    expect(rawMissions).toHaveLength(8)
    for (const raw of rawMissions) {
      expect(() => parseMission(raw)).not.toThrow()
    }
    expect(missions.map((m) => m.id)).toEqual([
      'bind-a-name',
      'shared-list',
      'rebind-vs-mutate',
      'swap-keep-the-value',
      'heavy-parcels',
      'heavy-parcels-repair',
      'charge-total',
      'strongest-battery',
    ])
  })

  it('mission ids are unique and prerequisites name real missions', () => {
    const ids = missions.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of missions) {
      for (const p of m.prerequisites) {
        expect(ids, `${m.id} requires ${p}`).toContain(p)
      }
    }
  })

  it('a prerequisite always comes earlier in the order', () => {
    const seen = new Set<string>()
    for (const m of missions) {
      for (const p of m.prerequisites) {
        expect(seen, `${m.id} requires ${p}, which comes later`).toContain(p)
      }
      seen.add(m.id)
    }
  })

  it('every hint ladder is levels 1 to 5 in order', () => {
    for (const m of missions) {
      expect(m.hints.map((h) => h.level), m.id).toEqual([1, 2, 3, 4, 5])
      for (const h of m.hints) expect(h.text.length, `${m.id} hint ${h.level}`).toBeGreaterThan(20)
    }
  })

  it('purpose and prompt stay to one short line', () => {
    for (const m of missions) {
      for (const line of [m.purpose, m.prompt]) {
        expect(line, m.id).not.toContain('\n')
        expect(line.length, `${m.id}: ${line}`).toBeLessThanOrEqual(110)
      }
    }
  })

  it('every misconception names an event rather than saying "wrong"', () => {
    for (const m of missions) {
      expect(m.misconceptions.length, m.id).toBeGreaterThan(0)
      for (const mc of m.misconceptions) {
        expect(mc.feedback, `${m.id}/${mc.id}`).not.toMatch(/\b(wrong|incorrect|try again)\b/i)
        expect(mc.feedback.length).toBeGreaterThan(30)
      }
    }
  })

  it('a prediction, where present, has a real correct option', () => {
    for (const m of missions) {
      if (!m.prediction) continue
      const ids = m.prediction.options.map((o) => o.id)
      expect(ids, m.id).toContain(m.prediction.correctOptionId)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('every declared case input is bound by that case setup', () => {
    for (const m of missions) {
      if (m.goal.kind !== 'invent') continue
      for (const c of m.goal.cases) {
        expect(c.inputs.length, `${m.id}/${c.id} declares no inputs`).toBeGreaterThan(0)
        for (const name of c.inputs) {
          expect(c.setup, `${m.id}/${c.id}`).toContain(`${name} =`)
        }
      }
    }
  })
})

/* ------------------------------------------------------------------ */
/* Coverage manifest                                                   */
/* ------------------------------------------------------------------ */

describe('coverage manifest', () => {
  it('lists every source item exactly once', () => {
    expect(coverage).toHaveLength(214)
    const ids = coverage.map((c) => c.sourceId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('marks every source a mission adapts, and nothing it does not', () => {
    const byId = new Map(coverage.map((c) => [c.sourceId, c]))
    const adapted = new Set(missions.flatMap((m) => m.sourceIds))
    expect(adapted.size).toBeGreaterThan(0)
    for (const sourceId of adapted) {
      const item = byId.get(sourceId)
      expect(item, `${sourceId} is cited by a mission but missing from the manifest`).toBeDefined()
      expect(item!.status, sourceId).not.toBe('inventoried')
    }
    for (const item of coverage) {
      if (adapted.has(item.sourceId)) continue
      expect(item.status, `${item.sourceId} is marked ${item.status} but no mission cites it`)
        .toBe('inventoried')
    }
  })

  it('claims no status the project has not earned', () => {
    // Nothing has been through the UI or in front of a learner yet.
    for (const item of coverage) {
      expect(item.status).not.toBe('interaction-checked')
      expect(item.status).not.toBe('learner-piloted')
    }
  })
})

/* ------------------------------------------------------------------ */
/* 4. Invention missions: do the cases discriminate?                   */
/* ------------------------------------------------------------------ */

const HEAVY_PARCELS_CORRECT = `
result = []
for weight in weights:
    if weight > limit:
        result.append(weight)
answer = result
`

/** The 5.12 bug: rebinding result to a one-item list instead of appending. */
const HEAVY_PARCELS_REBIND_BUG = `
result = []
for weight in weights:
    if weight > limit:
        result = [weight]
answer = result
`

/** Off by one comparison: >= keeps the parcel that ties the limit. */
const HEAVY_PARCELS_GTE_BUG = `
result = []
for weight in weights:
    if weight > limit or weight == limit:
        result.append(weight)
answer = result
`

/** Right contents on some inputs, but the input list handed straight back. */
const HEAVY_PARCELS_ALIAS_BUG = `
answer = weights
`

/** Sorts the delivery before reading it, so the input does not survive. */
const HEAVY_PARCELS_MUTATES_INPUT_BUG = `
weights.sort()
result = []
for weight in weights:
    if weight > limit:
        result.append(weight)
answer = result
`

/** Walks one slot too far and falls off the end of the list. */
const HEAVY_PARCELS_INDEX_BUG = `
result = []
for i in range(len(weights) + 1):
    if weights[i] > limit:
        result.append(weights[i])
answer = result
`

describe('heavy-parcels cases discriminate', () => {
  it('the reference method passes every case', async () => {
    const report = await gradeMethod(inventGoal('heavy-parcels'), HEAVY_PARCELS_CORRECT)
    expect(failed(report)).toEqual([])
    expect(report.passed).toBe(true)
  })

  it('catches the 5.12 rebind bug, and says what it threw away', async () => {
    const report = await gradeMethod(inventGoal('heavy-parcels'), HEAVY_PARCELS_REBIND_BUG)
    expect(report.passed).toBe(false)
    expect(failed(report)).toContain('duplicates')
    expect(report.firstFailure?.caseId).toBe('example')
    const msg = messageFor(report, 'duplicates')
    expect(msg).toMatch(/only the last heavy parcel/)
    expect(msg).toMatch(/\[6, 6, 6\]/)
    // The cases that do not depend on collecting more than one parcel still pass.
    expect(failed(report)).not.toContain('empty')
    expect(failed(report)).not.toContain('none-qualify')
  })

  it('catches >= instead of >, and names the parcel on the line', async () => {
    const report = await gradeMethod(inventGoal('heavy-parcels'), HEAVY_PARCELS_GTE_BUG)
    expect(report.passed).toBe(false)
    expect(failed(report)).toContain('equal-to-limit')
    const msg = messageFor(report, 'equal-to-limit')
    expect(msg).toMatch(/exactly the limit/)
    expect(msg).toMatch(/\[6\]/)
    // A limit that no weight ties is unaffected, which is why the tie case exists.
    expect(failed(report)).not.toContain('negatives')
    expect(failed(report)).not.toContain('empty')
  })

  it('catches handing the input list back as the answer', async () => {
    const report = await gradeMethod(inventGoal('heavy-parcels'), HEAVY_PARCELS_ALIAS_BUG)
    expect(report.passed).toBe(false)
    // hand-it-back is the case whose *contents* are right, so only identity can catch it.
    expect(failed(report)).toContain('hand-it-back')
    expect(messageFor(report, 'hand-it-back')).toMatch(/the parcel list itself, not a new list/)
  })

  it('catches a method that changes the delivery', async () => {
    const report = await gradeMethod(inventGoal('heavy-parcels'), HEAVY_PARCELS_MUTATES_INPUT_BUG)
    expect(report.passed).toBe(false)
    expect(failed(report)).toContain('example')
    const msg = messageFor(report, 'example')
    expect(msg).toMatch(/It started as \[2, 8, 5, 9\]/)
    expect(msg).toMatch(/left exactly as it arrived/)
  })

  it('reports an error as the error Python actually raised', async () => {
    const report = await gradeMethod(inventGoal('heavy-parcels'), HEAVY_PARCELS_INDEX_BUG)
    expect(report.passed).toBe(false)
    const msg = messageFor(report, 'example')
    expect(msg).toMatch(/Python reported IndexError/)
    expect(msg).toMatch(/list index out of range/)
    expect(report.cases[0].error?.kind).toBe('IndexError')
  })

  it('its misconception conditions evaluate to booleans on every case', async () => {
    const m = missions.find((x) => x.id === 'heavy-parcels')!
    const rows = await evalInventWhens(
      inventGoal('heavy-parcels'),
      HEAVY_PARCELS_REBIND_BUG,
      m.misconceptions.map((mc) => mc.when),
    )
    for (const r of rows) {
      expect(r.error, `${r.when} on ${r.caseId}`).toBeNull()
      expect(r.isBool, `${r.when} on ${r.caseId}`).toBe(true)
    }
    // The rebind misconception is the one that should actually fire here.
    const fired = rows.filter(
      (r) => r.when.includes('len(ns["answer"]) == 1') && r.value === true,
    )
    expect(fired.map((r) => r.caseId)).toContain('duplicates')
  })
})

describe('heavy-parcels-repair', () => {
  it('its starter method is the faulty 5.12 method, and the cases catch it', async () => {
    const mission = missions.find((m) => m.id === 'heavy-parcels-repair')!
    const goal = mission.goal as InventGoal
    expect(goal.starterProgram).toBeDefined()
    const program = ProgramSchema.parse(goal.starterProgram)
    const { source } = emitProgram(program)

    expect(source).toContain('result = [weight]')
    expect(source).not.toContain('result.append(weight)')

    const report = await gradeMethod(goal, source)
    expect(report.passed).toBe(false)
    expect(failed(report)).toContain('duplicates')
    expect(messageFor(report, 'duplicates')).toMatch(/only the last heavy parcel/)
    // The starter is faulty, not broken: it runs, and the easy cases still pass.
    expect(report.cases.every((c) => c.error === null)).toBe(true)
    expect(failed(report)).not.toContain('empty')
  })

  it('the repair the hint ladder demonstrates makes it pass', async () => {
    const goal = inventGoal('heavy-parcels-repair')
    const report = await gradeMethod(goal, HEAVY_PARCELS_CORRECT)
    expect(failed(report)).toEqual([])
  })
})

const CHARGE_TOTAL_CORRECT = `
total = 0
for charge in charges:
    total = total + charge
answer = total
`

/** The accumulator set up inside the loop, so only the last charge survives. */
const CHARGE_TOTAL_RESET_BUG = `
for charge in charges:
    total = 0
    total = total + charge
answer = total
`

/** 5.16: no accumulator before the loop at all. */
const CHARGE_TOTAL_UNBOUND_BUG = `
for charge in charges:
    total = total + charge
answer = total
`

/** Counts the charges instead of adding them up. */
const CHARGE_TOTAL_COUNT_BUG = `
total = 0
for charge in charges:
    total = total + 1
answer = total
`

/** Starts from the first charge, so the empty list falls over. */
const CHARGE_TOTAL_FIRST_ITEM_BUG = `
total = charges[0]
for charge in charges:
    total = total + charge
answer = total - charges[0]
`

describe('charge-total cases discriminate', () => {
  it('the reference method passes every case', async () => {
    const report = await gradeMethod(inventGoal('charge-total'), CHARGE_TOTAL_CORRECT)
    expect(failed(report)).toEqual([])
    expect(report.passed).toBe(true)
  })

  it('catches the accumulator reset inside the loop', async () => {
    const report = await gradeMethod(inventGoal('charge-total'), CHARGE_TOTAL_RESET_BUG)
    expect(report.passed).toBe(false)
    expect(failed(report)).toContain('reset-each-turn')
    const msg = messageFor(report, 'reset-each-turn')
    expect(msg).toMatch(/just the last charge/)
    expect(msg).toMatch(/Pip needs 6/)
  })

  it('catches an accumulator that was never bound before the loop', async () => {
    const report = await gradeMethod(inventGoal('charge-total'), CHARGE_TOTAL_UNBOUND_BUG)
    expect(report.passed).toBe(false)
    const msg = messageFor(report, 'example')
    expect(msg).toMatch(/Python reported a NameError/)
    expect(msg).toMatch(/named before the loop starts/)
  })

  it('catches counting instead of adding', async () => {
    const report = await gradeMethod(inventGoal('charge-total'), CHARGE_TOTAL_COUNT_BUG)
    expect(report.passed).toBe(false)
    // [2, 2, 2] is the case built for it: 3 charges, total 6.
    expect(failed(report)).toContain('counts-instead')
    expect(messageFor(report, 'counts-instead')).toMatch(/how many charges there are/)
  })

  it('catches a method that cannot handle no charges at all', async () => {
    const report = await gradeMethod(inventGoal('charge-total'), CHARGE_TOTAL_FIRST_ITEM_BUG)
    expect(report.passed).toBe(false)
    expect(failed(report)).toEqual(['empty'])
    const msg = messageFor(report, 'empty')
    expect(msg).toMatch(/Python reported an IndexError/)
    expect(msg).toMatch(/should just be 0/)
  })

  it('its misconception conditions evaluate to booleans on every case', async () => {
    const m = missions.find((x) => x.id === 'charge-total')!
    for (const src of [CHARGE_TOTAL_RESET_BUG, CHARGE_TOTAL_FIRST_ITEM_BUG]) {
      const rows = await evalInventWhens(inventGoal('charge-total'), src, m.misconceptions.map((mc) => mc.when))
      for (const r of rows) {
        expect(r.error, `${r.when} on ${r.caseId}`).toBeNull()
        expect(r.isBool, `${r.when} on ${r.caseId}`).toBe(true)
      }
    }
  })
})

const STRONGEST_CORRECT = `
best = charges[0]
for charge in charges:
    if charge > best:
        best = charge
answer = best
`

/** Best-so-far initialised to 0 instead of the first charge. */
const STRONGEST_ZERO_BUG = `
best = 0
for charge in charges:
    if charge > best:
        best = charge
answer = best
`

/** Best-so-far replaced every turn, so the last charge wins. */
const STRONGEST_NO_TEST_BUG = `
best = charges[0]
for charge in charges:
    best = charge
answer = best
`

/** Answers the first charge and never moves on. */
const STRONGEST_FIRST_BUG = `
best = charges[0]
for charge in charges:
    if charge > best:
        best = best
answer = best
`

describe('strongest-battery cases discriminate', () => {
  it('the reference method passes every case', async () => {
    const report = await gradeMethod(inventGoal('strongest-battery'), STRONGEST_CORRECT)
    expect(failed(report)).toEqual([])
    expect(report.passed).toBe(true)
  })

  it('catches best-so-far starting at 0, on the all-negative cases', async () => {
    const report = await gradeMethod(inventGoal('strongest-battery'), STRONGEST_ZERO_BUG)
    expect(report.passed).toBe(false)
    // Exactly the cases where 0 is not a real charge and beats every real one.
    expect(failed(report)).toEqual(['all-negative', 'negative-pair'])
    const msg = messageFor(report, 'all-negative')
    expect(msg).toMatch(/not one of the charges/)
    expect(msg).toMatch(/Pip needs -2/)
    // A crate whose best really is 0 must still pass, or the message would be a lie.
    expect(failed(report)).not.toContain('zero-and-below')
  })

  it('catches best-so-far replaced on every turn', async () => {
    const report = await gradeMethod(inventGoal('strongest-battery'), STRONGEST_NO_TEST_BUG)
    expect(report.passed).toBe(false)
    expect(failed(report)).toContain('best-first')
    expect(messageFor(report, 'best-first')).toMatch(/simply the last charge/)
    // best-last would pass this bug, which is why best-first exists.
    expect(failed(report)).not.toContain('best-last')
  })

  it('catches a comparison that never replaces best-so-far', async () => {
    const report = await gradeMethod(inventGoal('strongest-battery'), STRONGEST_FIRST_BUG)
    expect(report.passed).toBe(false)
    expect(failed(report)).toContain('best-last')
    expect(messageFor(report, 'best-last')).toMatch(/the first charge, and never moved on/)
    expect(failed(report)).not.toContain('best-first')
  })

  it('its misconception conditions evaluate to booleans on every case', async () => {
    const m = missions.find((x) => x.id === 'strongest-battery')!
    for (const src of [STRONGEST_ZERO_BUG, STRONGEST_NO_TEST_BUG]) {
      const rows = await evalInventWhens(inventGoal('strongest-battery'), src, m.misconceptions.map((mc) => mc.when))
      for (const r of rows) {
        expect(r.error, `${r.when} on ${r.caseId}`).toBeNull()
        expect(r.isBool, `${r.when} on ${r.caseId}`).toBe(true)
      }
    }
  })
})

/* ------------------------------------------------------------------ */
/* 5. Manual missions through session.run_commands_and_check            */
/* ------------------------------------------------------------------ */

const name = (n: string) => ({ kind: 'name', name: n })
const work = (slotId: string) => ({ kind: 'work', slotId })
const int = (text: string) => ({ kind: 'literalInt', text })
const slot = (target: unknown, index: number) => ({ kind: 'slot', target, index })

describe('bind-a-name', () => {
  const mission = manualMission('bind-a-name')

  it('is satisfied by making the number and naming it', async () => {
    const result = await runManual(mission, [
      { op: 'makeInt', text: '12' },
      { op: 'bind', name: 'charge', ref: work('w1') },
    ])
    expect(result.error).toBeNull()
    expect(result.check?.done, result.check?.message).toBe(true)
  })

  it('is not satisfied by making the number and stopping', async () => {
    const result = await runManual(mission, [{ op: 'makeInt', text: '12' }])
    expect(result.error).toBeNull()
    expect(result.check?.done).toBe(false)
    expect(result.check?.message).toMatch(/Nothing is called charge yet/)
  })

  it('is not satisfied by naming the wrong number', async () => {
    const result = await runManual(mission, [
      { op: 'makeInt', text: '21' },
      { op: 'bind', name: 'charge', ref: work('w1') },
    ])
    expect(result.check?.done).toBe(false)
    expect(result.check?.message).toMatch(/points at the number 21/)
  })
})

describe('shared-list', () => {
  const mission = manualMission('shared-list')

  const correct = [
    { op: 'lookup', ref: name('supplies') },
    { op: 'bind', name: 'bag', ref: work('w1') },
    { op: 'makeStr', value: 'lamp' },
    { op: 'append', target: name('bag'), value: work('w2') },
  ]

  /** Rebuilds a list that looks the same, which equality alone would accept. */
  const copyInstead = [
    {
      op: 'makeList',
      items: [slot(name('supplies'), 0), slot(name('supplies'), 1)],
    },
    { op: 'bind', name: 'bag', ref: work('w1') },
    { op: 'makeStr', value: 'lamp' },
    { op: 'append', target: name('bag'), value: work('w2') },
  ]

  it('is satisfied by sharing the one list and appending through it', async () => {
    const result = await runManual(mission, correct)
    expect(result.error).toBeNull()
    expect(result.check?.done, result.check?.message).toBe(true)
  })

  it('is not satisfied by a second list that merely looks the same', async () => {
    const result = await runManual(mission, copyInstead)
    expect(result.error).toBeNull()
    expect(result.check?.done).toBe(false)
    expect(result.check?.message).toMatch(/two different lists/)
  })

  it('is not satisfied by sharing without adding the lamp', async () => {
    const result = await runManual(mission, correct.slice(0, 2))
    expect(result.check?.done).toBe(false)
    expect(result.check?.message).toMatch(/nothing has been added to it yet/)
  })

  it('its misconception conditions evaluate to booleans', async () => {
    const rows = await evalManualWhens(mission, copyInstead, mission.misconceptions.map((m) => m.when))
    for (const r of rows) {
      expect(r.error, r.when).toBeNull()
      expect(r.isBool, r.when).toBe(true)
    }
  })
})

describe('rebind-vs-mutate', () => {
  const mission = manualMission('rebind-vs-mutate')

  // append stages its None result as w1, so the new list lands in w2.
  const correct = [
    { op: 'append', target: name('crate'), value: int('3') },
    { op: 'makeList', items: [int('9'), int('4')] },
    { op: 'bind', name: 'spare', ref: work('w2') },
  ]

  /** Rebuilds crate instead of growing it: hold is left behind. */
  const rebindCrate = [
    { op: 'makeList', items: [int('1'), int('2'), int('3')] },
    { op: 'bind', name: 'crate', ref: work('w1') },
    { op: 'makeList', items: [int('9'), int('4')] },
    { op: 'bind', name: 'spare', ref: work('w2') },
  ]

  /** Grows the shared spare list instead of moving the name: backup sees it. */
  const mutateSpare = [
    { op: 'append', target: name('crate'), value: int('3') },
    { op: 'append', target: name('spare'), value: int('4') },
  ]

  it('is satisfied by mutating one pair and rebinding the other', async () => {
    const result = await runManual(mission, correct)
    expect(result.error).toBeNull()
    expect(result.check?.done, result.check?.message).toBe(true)
  })

  it('is not satisfied when crate is rebuilt rather than grown', async () => {
    const result = await runManual(mission, rebindCrate)
    expect(result.check?.done).toBe(false)
    expect(result.check?.message).toMatch(/no longer reach the same list/)
  })

  it('is not satisfied when the spare list is changed instead of replaced', async () => {
    const result = await runManual(mission, mutateSpare)
    expect(result.check?.done).toBe(false)
    expect(result.check?.message).toMatch(/backup now holds \[9, 4\]/)
  })

  it('its misconception conditions evaluate to booleans', async () => {
    for (const cmds of [rebindCrate, mutateSpare]) {
      const rows = await evalManualWhens(mission, cmds, mission.misconceptions.map((m) => m.when))
      for (const r of rows) {
        expect(r.error, r.when).toBeNull()
        expect(r.isBool, r.when).toBe(true)
      }
    }
  })
})

describe('swap-keep-the-value', () => {
  const mission = manualMission('swap-keep-the-value')

  const correct = [
    { op: 'lookup', ref: name('left') },
    { op: 'bind', name: 'left', ref: name('right') },
    { op: 'bind', name: 'right', ref: work('w1') },
  ]

  /** 1.8 exactly: no holding step, so the red flag loses its only name. */
  const naive = [
    { op: 'bind', name: 'left', ref: name('right') },
    { op: 'bind', name: 'right', ref: name('left') },
  ]

  it('is satisfied when the red flag is held before either name moves', async () => {
    const result = await runManual(mission, correct)
    expect(result.error).toBeNull()
    expect(result.check?.done, result.check?.message).toBe(true)
  })

  it('is not satisfied by the naive two-step swap', async () => {
    const result = await runManual(mission, naive)
    expect(result.error).toBeNull()
    expect(result.check?.done).toBe(false)
    expect(result.check?.message).toMatch(/reach the same flag/)
  })

  it('is not satisfied before anything moves', async () => {
    const result = await runManual(mission, [])
    expect(result.check?.done).toBe(false)
    expect(result.check?.message).toMatch(/Nothing has swapped yet/)
  })

  it('its misconception conditions evaluate to booleans', async () => {
    const rows = await evalManualWhens(mission, naive, mission.misconceptions.map((m) => m.when))
    for (const r of rows) {
      expect(r.error, r.when).toBeNull()
      expect(r.isBool, r.when).toBe(true)
    }
  })
})
