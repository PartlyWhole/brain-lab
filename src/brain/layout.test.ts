/**
 * Layout is the part of the brain workspace that can be wrong silently, so it
 * is the part that is pinned by tests: one tile per object, only real slots,
 * no overlap, the same answer every time, and no hang on a cyclic graph.
 */
import { describe, expect, it } from 'vitest'
import type { SerializedObject, Snapshot } from '../runtime/types'
import {
  METRICS,
  applyOffsets,
  computeLayout,
  identityBadge,
  overlappingTiles,
  rowsOf,
  tileHeight,
} from './layout'

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function snap(objects: SerializedObject[], bindings: { name: string; objectId: string }[] = []): Snapshot {
  return {
    objects: Object.fromEntries(objects.map((o) => [o.id, o])),
    scopes: [{ id: 'global', kind: 'global', label: 'Brain', parentId: null, bindings }],
    outputLength: 0,
    truncated: false,
  }
}

const int = (id: string, text: string): SerializedObject => ({ id, type: 'int', text })
const list = (id: string, slots: string[]): SerializedObject =>
  ({ id, type: 'list', slots, length: slots.length, truncated: false })

const EMPTY = snap([])

const ONE_OBJECT = snap([int('o1', '7')], [{ name: 'count', objectId: 'o1' }])

const SHARED = snap(
  [list('o1', [])],
  [{ name: 'bag', objectId: 'o1' }, { name: 'sack', objectId: 'o1' }],
)

const LIST_OF_THREE = snap(
  [list('o1', ['o2', 'o3', 'o4']), int('o2', '1'), int('o3', '2'), int('o4', '3')],
  [{ name: 'bag', objectId: 'o1' }],
)

/** `ring = []; ring.append(ring)` — the list holds itself. */
const CYCLIC = snap([list('o1', ['o1'])], [{ name: 'ring', objectId: 'o1' }])

/** Two mutually referring lists, so the cycle is longer than one hop. */
const TWO_CYCLE = snap(
  [list('o1', ['o2']), list('o2', ['o1'])],
  [{ name: 'a', objectId: 'o1' }],
)

/** 6 lists of 4 ints each, plus a spine: 31 objects, 7 names. */
function bigGraph(): Snapshot {
  const objects: SerializedObject[] = []
  const bindings: { name: string; objectId: string }[] = []
  const spine: string[] = []
  let next = 1
  for (let g = 0; g < 6; g++) {
    const items: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = `o${next++}`
      objects.push(int(id, String(g * 4 + i)))
      items.push(id)
    }
    const listId = `o${next++}`
    objects.push(list(listId, items))
    bindings.push({ name: `group${g}`, objectId: listId })
    spine.push(listId)
  }
  const rootId = `o${next++}`
  objects.push(list(rootId, spine))
  bindings.push({ name: 'all', objectId: rootId })
  return snap(objects, bindings)
}

const BIG = bigGraph()

const ALL_CASES: [string, Snapshot][] = [
  ['empty', EMPTY],
  ['one object', ONE_OBJECT],
  ['two names, one object', SHARED],
  ['list of three ints', LIST_OF_THREE],
  ['self-referential list', CYCLIC],
  ['two-list cycle', TWO_CYCLE],
  ['31 objects', BIG],
]

/* ------------------------------------------------------------------ */
/* Invariants that hold for every snapshot                              */
/* ------------------------------------------------------------------ */

describe('invariants across every fixture', () => {
  it.each(ALL_CASES)('%s: draws each object exactly once', (_name, snapshot) => {
    const layout = computeLayout({ snapshot })
    const ids = layout.tiles.map((t) => t.objectId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ids)).toEqual(new Set(Object.keys(snapshot.objects)))
  })

  it.each(ALL_CASES)('%s: no two tiles overlap', (_name, snapshot) => {
    expect(overlappingTiles(computeLayout({ snapshot }))).toEqual([])
  })

  it.each(ALL_CASES)('%s: is deterministic', (_name, snapshot) => {
    expect(computeLayout({ snapshot })).toEqual(computeLayout({ snapshot }))
  })

  it.each(ALL_CASES)('%s: every arrow points at a tile that exists', (_name, snapshot) => {
    const layout = computeLayout({ snapshot })
    const ids = new Set(layout.tiles.map((t) => t.objectId))
    for (const arrow of layout.arrows) expect(ids.has(arrow.targetObjectId)).toBe(true)
  })

  it.each(ALL_CASES)('%s: leaves the snapshot untouched', (_name, snapshot) => {
    const before = JSON.stringify(snapshot)
    computeLayout({ snapshot, workArea: [], draftNames: [] })
    expect(JSON.stringify(snapshot)).toBe(before)
  })

  it.each(ALL_CASES)('%s: every tile sits inside the reported canvas', (_name, snapshot) => {
    const layout = computeLayout({ snapshot })
    for (const tile of layout.tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(0)
      expect(tile.y).toBeGreaterThanOrEqual(0)
      expect(tile.x + tile.width).toBeLessThanOrEqual(layout.width)
      expect(tile.y + tile.height).toBeLessThanOrEqual(layout.height)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Case by case                                                         */
/* ------------------------------------------------------------------ */

describe('empty snapshot', () => {
  const layout = computeLayout({ snapshot: EMPTY })

  it('has nothing to draw but still has a usable canvas', () => {
    expect(layout.tiles).toEqual([])
    expect(layout.arrows).toEqual([])
    expect(layout.names).toEqual([])
    expect(layout.columns).toEqual([])
    expect(layout.width).toBe(METRICS.minWidth)
    expect(layout.height).toBe(METRICS.minHeight)
  })

  it('still shows the scope so the names column is not a void', () => {
    expect(layout.scopeHeaders.map((h) => h.label)).toEqual(['Brain'])
  })
})

describe('one object', () => {
  const layout = computeLayout({ snapshot: ONE_OBJECT })

  it('puts the name in the names column and the object to its right', () => {
    expect(layout.names).toHaveLength(1)
    expect(layout.names[0].x).toBe(METRICS.pad)
    expect(layout.tiles).toHaveLength(1)
    expect(layout.tiles[0].x).toBeGreaterThan(layout.names[0].x + layout.names[0].width)
  })

  it('draws one name arrow, left to right', () => {
    expect(layout.arrows).toHaveLength(1)
    const [arrow] = layout.arrows
    expect(arrow.kind).toBe('name')
    expect(arrow.to.x).toBeGreaterThan(arrow.from.x)
    expect(arrow.description).toBe('count refers to number 7')
  })

  it('gives the tile a canonical reference the student could click', () => {
    expect(layout.tiles[0].reference).toEqual({ kind: 'name', name: 'count' })
  })
})

describe('two names on one object', () => {
  const layout = computeLayout({ snapshot: SHARED })

  it('draws one tile, not two', () => {
    expect(layout.tiles).toHaveLength(1)
  })

  it('converges both arrows on the same tile', () => {
    expect(layout.arrows).toHaveLength(2)
    const targets = layout.arrows.map((a) => a.to)
    expect(targets[0]).toEqual(targets[1])
    expect(targets[0]).toEqual(layout.tiles[0].inAnchor)
  })

  it('reports the sharing in words as well as in arrows', () => {
    expect(layout.refCounts.o1).toBe(2)
    expect(layout.tiles[0].refCount).toBe(2)
    expect(layout.arrows[0].description).toBe('bag refers to list #1, which 2 references point at')
  })

  it('shows no slots at all for an empty list', () => {
    expect(layout.tiles[0].slots).toEqual([])
    expect(rowsOf(layout.tiles[0].object)).toEqual([])
  })
})

describe('a list referencing three ints', () => {
  const layout = computeLayout({ snapshot: LIST_OF_THREE })

  it('gives the list exactly three slots', () => {
    const bag = layout.tiles.find((t) => t.objectId === 'o1')!
    expect(bag.slots.map((s) => s.label)).toEqual(['0', '1', '2'])
    expect(bag.slots.map((s) => s.targetId)).toEqual(['o2', 'o3', 'o4'])
  })

  it('sizes the tile from the real slot count', () => {
    const three = tileHeight(LIST_OF_THREE.objects.o1)
    const empty = tileHeight(SHARED.objects.o1)
    expect(three).toBeGreaterThan(empty)
  })

  it('places the ints one column right of the list', () => {
    const bag = layout.tiles.find((t) => t.objectId === 'o1')!
    for (const id of ['o2', 'o3', 'o4']) {
      const tile = layout.tiles.find((t) => t.objectId === id)!
      expect(tile.column).toBe(bag.column + 1)
      expect(tile.x).toBeGreaterThan(bag.x + bag.width)
    }
  })

  it('keeps the ints in slot order down the column', () => {
    const ys = ['o2', 'o3', 'o4'].map((id) => layout.tiles.find((t) => t.objectId === id)!.y)
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
  })

  it('offers each slot as a clickable slot reference', () => {
    const bag = layout.tiles.find((t) => t.objectId === 'o1')!
    expect(bag.slots[1].reference).toEqual({
      kind: 'slot',
      target: { kind: 'name', name: 'bag' },
      index: 1,
    })
    expect(bag.slots.every((s) => s.selectable)).toBe(true)
  })

  it('draws one arrow per slot plus the name arrow', () => {
    expect(layout.arrows.filter((a) => a.kind === 'slot')).toHaveLength(3)
    expect(layout.arrows.filter((a) => a.kind === 'name')).toHaveLength(1)
  })
})

describe('cyclic graphs', () => {
  it('terminates on a list that holds itself', () => {
    const layout = computeLayout({ snapshot: CYCLIC })
    expect(layout.tiles).toHaveLength(1)
    expect(layout.tiles[0].slots).toHaveLength(1)
  })

  it('draws the self reference as a loop, not a zero-length path', () => {
    const layout = computeLayout({ snapshot: CYCLIC })
    const loop = layout.arrows.find((a) => a.kind === 'slot')!
    expect(loop.selfLoop).toBe(true)
    expect(loop.side).toBe('right')
    expect(loop.from).not.toEqual(loop.to)
    expect(loop.description).toContain('refers back to that same object')
  })

  it('terminates on a two-list cycle and still draws each list once', () => {
    const layout = computeLayout({ snapshot: TWO_CYCLE })
    expect(layout.tiles.map((t) => t.objectId).sort()).toEqual(['o1', 'o2'])
    expect(layout.arrows.filter((a) => a.kind === 'slot')).toHaveLength(2)
  })

  it('still gives the back-referenced object a usable reference path', () => {
    const layout = computeLayout({ snapshot: TWO_CYCLE })
    const second = layout.tiles.find((t) => t.objectId === 'o2')!
    expect(second.reference).toEqual({
      kind: 'slot',
      target: { kind: 'name', name: 'a' },
      index: 0,
    })
  })
})

describe('a 31-object graph', () => {
  const layout = computeLayout({ snapshot: BIG })

  it('draws every object exactly once', () => {
    expect(layout.tiles).toHaveLength(31)
  })

  it('uses three columns: root list, group lists, numbers', () => {
    expect(layout.columns.map((c) => c.index)).toEqual([0, 1, 2])
    expect(layout.tiles.find((t) => t.objectId === 'o31')!.column).toBe(0)
    expect(layout.tiles.find((t) => t.objectId === 'o5')!.column).toBe(1)
    expect(layout.tiles.find((t) => t.objectId === 'o1')!.column).toBe(2)
  })

  it('never lets a column overlap the next one', () => {
    for (let i = 1; i < layout.columns.length; i++) {
      const prev = layout.columns[i - 1]
      expect(layout.columns[i].x).toBeGreaterThanOrEqual(prev.x + prev.width)
    }
  })

  it('draws an arrow for every reference', () => {
    // 7 names + 6 spine slots + 24 number slots.
    expect(layout.arrows).toHaveLength(7 + 6 + 24)
  })
})

/* ------------------------------------------------------------------ */
/* Work area, drafts, nudging                                           */
/* ------------------------------------------------------------------ */

describe('work area', () => {
  const layout = computeLayout({
    snapshot: LIST_OF_THREE,
    workArea: [{ slotId: 'w1', label: 'new list', objectId: 'o1' }],
  })

  it('sits below everything else and arrows up to the shared tile', () => {
    expect(layout.workStripY).not.toBeNull()
    const chip = layout.work[0]
    for (const tile of layout.tiles) expect(chip.y).toBeGreaterThan(tile.y)
    const arrow = layout.arrows.find((a) => a.kind === 'work')!
    expect(arrow.targetObjectId).toBe('o1')
    expect(arrow.side).toBe('bottom')
  })

  it('does not create a second tile for an object the work area already holds', () => {
    expect(layout.tiles.filter((t) => t.objectId === 'o1')).toHaveLength(1)
  })
})

describe('draft names', () => {
  const layout = computeLayout({
    snapshot: ONE_OBJECT,
    draftNames: [{ id: 'd1', name: 'total' }],
  })

  it('marks the draft as a draft and binds it to nothing', () => {
    const draft = layout.names.find((n) => n.draft)!
    expect(draft.name).toBe('total')
    expect(draft.objectId).toBeNull()
    expect(draft.reference).toBeNull()
  })

  it('draws no arrow from a draft, because a draft refers to nothing', () => {
    expect(layout.arrows.filter((a) => a.sourceKey.startsWith('draft:'))).toEqual([])
    expect(layout.arrows).toHaveLength(1)
  })

  it('keeps drafts under their own heading, below the real names', () => {
    const heading = layout.scopeHeaders.find((h) => h.label === 'Drafts')!
    const real = layout.names.find((n) => !n.draft)!
    expect(heading.y).toBeGreaterThan(real.y)
  })
})

describe('nudging a tile', () => {
  const base = computeLayout({ snapshot: LIST_OF_THREE })
  const moved = applyOffsets(base, { o2: { dx: 40, dy: 25 } })

  it('moves the tile, its slots and both ends of its arrows together', () => {
    const before = base.tiles.find((t) => t.objectId === 'o2')!
    const after = moved.tiles.find((t) => t.objectId === 'o2')!
    expect(after.x).toBe(before.x + 40)
    expect(after.y).toBe(before.y + 25)
    const arrow = moved.arrows.find((a) => a.targetObjectId === 'o2')!
    expect(arrow.to).toEqual(after.inAnchor)
  })

  it('leaves everything else exactly where it was', () => {
    const untouched = moved.tiles.find((t) => t.objectId === 'o3')!
    expect(untouched).toEqual(base.tiles.find((t) => t.objectId === 'o3'))
  })

  it('does not mutate the layout it was given', () => {
    expect(base.tiles.find((t) => t.objectId === 'o2')!.x)
      .toBe(computeLayout({ snapshot: LIST_OF_THREE }).tiles.find((t) => t.objectId === 'o2')!.x)
  })

  it('is a no-op when nothing has been nudged', () => {
    expect(applyOffsets(base, {})).toBe(base)
  })
})

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

describe('identity badge', () => {
  it('reads as a short number a child can say out loud', () => {
    expect(identityBadge('o3')).toBe('#3')
    expect(identityBadge('o142')).toBe('#142')
  })

  it('falls back to the whole id when there is no number', () => {
    expect(identityBadge('weird')).toBe('#weird')
  })
})

describe('rowsOf', () => {
  it('gives a list exactly as many rows as it has slots, never more', () => {
    expect(rowsOf(list('o1', []))).toHaveLength(0)
    expect(rowsOf(list('o1', ['a']))).toHaveLength(1)
    expect(rowsOf(list('o1', ['a', 'b', 'c']))).toHaveLength(3)
  })

  it('gives a dictionary one row for the key and one for the value', () => {
    const rows = rowsOf({
      id: 'o1', type: 'dict', length: 1, truncated: false,
      entries: [{ key: 'o2', value: 'o3' }],
    })
    expect(rows.map((r) => r.targetId)).toEqual(['o2', 'o3'])
    expect(rows.every((r) => !r.selectable)).toBe(true)
  })

  it('gives a scalar no rows', () => {
    expect(rowsOf(int('o1', '5'))).toEqual([])
  })
})
