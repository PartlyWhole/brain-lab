/**
 * Pure layout for the brain workspace.
 *
 * Given a snapshot (plus the work area and any draft labels) this produces
 * absolute positions for every name tag, object tile, list slot, work-area chip
 * and reference arrow. It touches no DOM, measures no text and holds no state,
 * so the same snapshot always lays out the same way and a historical snapshot
 * lays out exactly as it did when it was live.
 *
 * Two invariants are enforced here rather than left to the renderer:
 *
 *  * **One object, one tile.** Tiles are keyed by object id and every reference
 *    to that id produces an arrow converging on that single tile. Nothing is
 *    ever inlined into a parent, so an object cannot appear twice.
 *  * **Only real slots exist.** A container's rows come from the serialized
 *    slot/entry/item arrays, so a list of length 0 gets zero rows and an
 *    explicit empty marker instead. Spare capacity is not representable.
 */
import type { SerializedObject, Snapshot } from '../runtime/types'
import { referenceCounts } from '../runtime/types'

/* ------------------------------------------------------------------ */
/* Public shapes                                                       */
/* ------------------------------------------------------------------ */

/** The distinct places a reference to one object can come from. */
export interface ReferenceSources {
  /** Names bound to this object, in the order the scopes report them. */
  names: string[]
  /** References held by containers (list slots, dict entries, set items). */
  containers: number
  /** Work-area items holding it: real references, but not bindings. */
  work: number
}

export type BrainReference =
  | { kind: 'name'; name: string }
  | { kind: 'work'; slotId: string }
  | { kind: 'slot'; target: BrainReference; index: number }

export interface WorkAreaEntry {
  slotId: string
  label: string
  objectId: string
}

export interface DraftName {
  id: string
  name: string
}

export interface Point {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface NameTagLayout extends Box {
  /** Stable React key. Scoped, because two scopes may hold the same name. */
  key: string
  name: string
  scopeId: string
  scopeLabel: string
  /** Null for a draft: a draft is not a binding and points at nothing. */
  objectId: string | null
  draft: boolean
  reference: BrainReference | null
  /** Right edge, vertically centred: where this tag's arrow leaves. */
  anchor: Point
}

export interface ScopeHeaderLayout extends Box {
  scopeId: string
  label: string
}

export interface SlotLayout extends Box {
  /** Position in the container's own row list. */
  index: number
  label: string
  targetId: string
  /** True only where Python would accept `container[index]`: lists and tuples. */
  selectable: boolean
  reference: BrainReference | null
  /** Right edge, vertically centred: where this slot's arrow leaves. */
  anchor: Point
}

export interface TileLayout extends Box {
  objectId: string
  object: SerializedObject
  column: number
  row: number
  headerHeight: number
  footerHeight: number
  slots: SlotLayout[]
  /** Serialiser dropped later slots; shown as a note, never as a slot. */
  truncated: boolean
  /** How many references point at this object right now. */
  refCount: number
  /** Canonical way to name this object, used for `slot` references. */
  reference: BrainReference | null
  /** Left edge at header height: where every incoming arrow converges. */
  inAnchor: Point
  /** Right edge at header height: the landing point for a self reference. */
  selfAnchor: Point
  /** Bottom edge, horizontally centred: where work-area arrows land. */
  bottomAnchor: Point
}

export interface WorkChipLayout extends Box {
  slotId: string
  label: string
  objectId: string
  reference: BrainReference
  /** Top edge, horizontally centred: where this chip's arrow leaves. */
  anchor: Point
}

export type ArrowKind = 'name' | 'work' | 'slot'
export type ArrowSide = 'left' | 'right' | 'bottom'

export interface ArrowLayout {
  id: string
  kind: ArrowKind
  /** Key of the thing doing the referring (name key, slot id, tile slot key). */
  sourceKey: string
  /** Set for a slot arrow: the container the arrow leaves from. */
  sourceObjectId: string | null
  targetObjectId: string
  from: Point
  to: Point
  /** Which edge of the target tile the arrow lands on. */
  side: ArrowSide
  /** A container that refers to itself. Drawn as a loop, never a zero path. */
  selfLoop: boolean
  /** Screen-reader sentence for this relationship. */
  description: string
}

export interface ColumnLayout {
  index: number
  x: number
  width: number
}

export interface BrainLayout {
  width: number
  height: number
  names: NameTagLayout[]
  scopeHeaders: ScopeHeaderLayout[]
  tiles: TileLayout[]
  arrows: ArrowLayout[]
  work: WorkChipLayout[]
  columns: ColumnLayout[]
  /** Reference counts for the whole snapshot, so sharing can be stated. */
  refCounts: Record<string, number>
  /**
   * Where each object's references actually come from. A bare total lumps
   * together things a student must tell apart: two *names* on one list is the
   * teaching point, while a work-area hold is scaffolding. Keeping them
   * separate lets the spoken description say which is which.
   */
  refSources: Record<string, ReferenceSources>
  /** Top of the work-area strip, or null when there is no work area. */
  workStripY: number | null
}

export interface LayoutInput {
  snapshot: Snapshot
  workArea?: WorkAreaEntry[]
  draftNames?: DraftName[]
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

/** Every size the layout uses. Exported so the CSS and the tests agree. */
export const METRICS = {
  pad: 16,
  nameWidth: 136,
  nameHeight: 34,
  nameGap: 8,
  scopeHeaderHeight: 22,
  scopeHeaderGap: 6,
  columnGap: 76,
  tileGap: 18,
  tileWidthScalar: 158,
  tileWidthContainer: 198,
  headerHeight: 34,
  valueHeight: 28,
  footerHeight: 20,
  tilePad: 8,
  slotsGapTop: 6,
  slotHeight: 28,
  slotGap: 4,
  emptyHeight: 30,
  truncatedHeight: 18,
  workGapTop: 30,
  workChipWidth: 152,
  workChipHeight: 48,
  workChipGap: 12,
  minWidth: 420,
  minHeight: 220,
} as const

/* ------------------------------------------------------------------ */
/* Reading objects                                                     */
/* ------------------------------------------------------------------ */

interface Row {
  index: number
  label: string
  targetId: string
  selectable: boolean
}

/**
 * The rows a container actually has. Never padded, never rounded up: the
 * length of this array is the number of slots Python reports.
 */
export function rowsOf(object: SerializedObject): Row[] {
  switch (object.type) {
    case 'list':
    case 'tuple':
      return object.slots.map((targetId, index) => ({
        index,
        label: String(index),
        targetId,
        selectable: true,
      }))
    case 'set':
      return object.items.map((targetId, index) => ({
        index,
        label: 'item',
        targetId,
        selectable: false,
      }))
    case 'dict':
      // Keys are objects too, so each entry is two rows rather than one row
      // with the key painted inside it. Painting it inside would draw the key
      // object a second time.
      return object.entries.flatMap((entry, i) => [
        { index: i * 2, label: `key ${i}`, targetId: entry.key, selectable: false },
        { index: i * 2 + 1, label: `value ${i}`, targetId: entry.value, selectable: false },
      ])
    default:
      return []
  }
}

export function isContainer(object: SerializedObject): boolean {
  return object.type === 'list' || object.type === 'tuple'
    || object.type === 'dict' || object.type === 'set'
}

/** Only these can be changed in place, so only these need an identity badge. */
export function isMutable(object: SerializedObject): boolean {
  return object.type === 'list' || object.type === 'dict' || object.type === 'set'
}

export function isTruncated(object: SerializedObject): boolean {
  return 'truncated' in object ? object.truncated : false
}

/** "#3" from "o3". Short enough for a child to read out loud. */
export function identityBadge(objectId: string): string {
  const digits = /(\d+)\s*$/.exec(objectId)
  return `#${digits ? digits[1] : objectId}`
}

/** Plain-words type name, used in every spoken sentence. */
export function typeWord(object: SerializedObject): string {
  switch (object.type) {
    case 'none': return 'nothing'
    case 'bool': return 'yes-or-no'
    case 'int': return 'number'
    case 'float': return 'number'
    case 'str': return 'text'
    case 'list': return 'list'
    case 'tuple': return 'tuple'
    case 'dict': return 'dictionary'
    case 'set': return 'set'
    case 'function': return 'machine'
    case 'unsupported': return 'thing'
    case 'elided': return 'thing'
  }
}

/** A short handle for an object in a sentence: "list #3", "number 7". */
export function shortLabel(snapshot: Snapshot, objectId: string): string {
  const object = snapshot.objects[objectId]
  if (!object) return 'a missing object'
  if (isMutable(object)) return `${typeWord(object)} ${identityBadge(objectId)}`
  switch (object.type) {
    case 'int':
    case 'float': return `number ${object.text}`
    case 'str': return `text ${JSON.stringify(object.text)}`
    case 'bool': return object.value ? 'True' : 'False'
    case 'none': return 'None'
    case 'function': return `machine ${object.name}()`
    default: return `${typeWord(object)} ${identityBadge(objectId)}`
  }
}

/**
 * Structural equality for references, so "is this the one I already picked?"
 * is answered by what the reference means and not by object identity.
 */
export function sameReference(a: BrainReference | null, b: BrainReference | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'name') return a.name === (b as { name: string }).name
  if (a.kind === 'work') return a.slotId === (b as { slotId: string }).slotId
  const other = b as { target: BrainReference; index: number }
  return a.index === other.index && sameReference(a.target, other.target)
}

/* ------------------------------------------------------------------ */
/* Sizing                                                              */
/* ------------------------------------------------------------------ */

export function tileWidth(object: SerializedObject): number {
  return isContainer(object) ? METRICS.tileWidthContainer : METRICS.tileWidthScalar
}

export function tileHeight(object: SerializedObject): number {
  const m = METRICS
  const chrome = m.tilePad * 2 + m.headerHeight + m.footerHeight
  if (!isContainer(object)) return chrome + m.valueHeight
  const rows = rowsOf(object)
  const body = rows.length === 0
    ? m.emptyHeight
    : rows.length * m.slotHeight + (rows.length - 1) * m.slotGap
  return chrome + m.slotsGapTop + body + (isTruncated(object) ? m.truncatedHeight : 0)
}

/* ------------------------------------------------------------------ */
/* Graph walk                                                          */
/* ------------------------------------------------------------------ */

interface GraphWalk {
  /** Every object id, in deterministic discovery order. */
  order: string[]
  /** Shortest reference path to each object, used for `slot` references. */
  reference: Map<string, BrainReference | null>
  /** Non-back-edge parents, used for depth and for barycentre ordering. */
  parents: Map<string, string[]>
  depth: Map<string, number>
}

function walkGraph(snapshot: Snapshot, workArea: WorkAreaEntry[]): GraphWalk {
  const order: string[] = []
  const reference = new Map<string, BrainReference | null>()
  const discovered = new Set<string>()
  const queue: string[] = []

  const push = (id: string, ref: BrainReference | null) => {
    if (discovered.has(id) || !snapshot.objects[id]) return
    discovered.add(id)
    order.push(id)
    reference.set(id, ref)
    queue.push(id)
  }

  for (const scope of snapshot.scopes) {
    for (const binding of scope.bindings) push(binding.objectId, { kind: 'name', name: binding.name })
  }
  for (const entry of workArea) push(entry.objectId, { kind: 'work', slotId: entry.slotId })

  // Breadth-first, so the reference path recorded for each object is the
  // shortest one. Anything left over (not reachable from a name or the work
  // area) is seeded afterwards in id order rather than silently dropped.
  const leftovers = Object.keys(snapshot.objects).sort()
  let cursor = 0
  for (;;) {
    while (cursor < queue.length) {
      const id = queue[cursor++]
      const object = snapshot.objects[id]
      if (!object) continue
      const parentRef = reference.get(id) ?? null
      for (const row of rowsOf(object)) {
        const childRef: BrainReference | null = parentRef && row.selectable
          ? { kind: 'slot', target: parentRef, index: row.index }
          : null
        push(row.targetId, childRef)
      }
    }
    const next = leftovers.find((id) => !discovered.has(id))
    if (next === undefined) break
    push(next, null)
  }

  const childrenOf = (id: string): string[] => {
    const object = snapshot.objects[id]
    if (!object) return []
    return rowsOf(object).map((r) => r.targetId).filter((t) => discovered.has(t))
  }

  // Classify back edges with an iterative depth-first search so a cyclic graph
  // cannot hang the layout. Removing back edges always leaves a DAG.
  const colour = new Map<string, number>() // 0 unseen, 1 on stack, 2 done
  const backEdges = new Set<string>()
  for (const start of order) {
    if (colour.get(start)) continue
    colour.set(start, 1)
    const stack: { id: string; next: number }[] = [{ id: start, next: 0 }]
    while (stack.length) {
      const top = stack[stack.length - 1]
      const kids = childrenOf(top.id)
      if (top.next < kids.length) {
        const child = kids[top.next++]
        const state = colour.get(child) ?? 0
        if (state === 1) backEdges.add(`${top.id}|${child}`)
        else if (state === 0) {
          colour.set(child, 1)
          stack.push({ id: child, next: 0 })
        }
      } else {
        colour.set(top.id, 2)
        stack.pop()
      }
    }
  }

  // Longest-path depth over the remaining DAG, so a container always sits to
  // the left of everything it holds and arrows mostly flow one way.
  const parents = new Map<string, string[]>()
  const forward = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const id of order) {
    if (!parents.has(id)) parents.set(id, [])
    if (!indegree.has(id)) indegree.set(id, 0)
  }
  for (const id of order) {
    const seen = new Set<string>()
    for (const child of childrenOf(id)) {
      if (seen.has(child) || backEdges.has(`${id}|${child}`) || child === id) continue
      seen.add(child)
      forward.set(id, [...(forward.get(id) ?? []), child])
      parents.set(child, [...(parents.get(child) ?? []), id])
      indegree.set(child, (indegree.get(child) ?? 0) + 1)
    }
  }

  const depth = new Map<string, number>()
  const ready = order.filter((id) => (indegree.get(id) ?? 0) === 0)
  for (const id of ready) depth.set(id, 0)
  let head = 0
  while (head < ready.length) {
    const id = ready[head++]
    const base = depth.get(id) ?? 0
    for (const child of forward.get(id) ?? []) {
      depth.set(child, Math.max(depth.get(child) ?? 0, base + 1))
      const left = (indegree.get(child) ?? 0) - 1
      indegree.set(child, left)
      if (left === 0) ready.push(child)
    }
  }
  for (const id of order) if (!depth.has(id)) depth.set(id, 0)

  return { order, reference, parents, depth }
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function computeLayout(input: LayoutInput): BrainLayout {
  const m = METRICS
  const { snapshot } = input
  const workArea = input.workArea ?? []
  const draftNames = input.draftNames ?? []
  // Python's own reference count for each object, plus the work area, which
  // holds real references too even though it is not a scope.
  const refCounts: Record<string, number> = { ...referenceCounts(snapshot) }
  const refSources: Record<string, ReferenceSources> = {}
  const sourcesFor = (id: string): ReferenceSources => {
    if (!refSources[id]) refSources[id] = { names: [], containers: 0, work: 0 }
    return refSources[id]
  }
  for (const scope of snapshot.scopes) {
    for (const binding of scope.bindings) sourcesFor(binding.objectId).names.push(binding.name)
  }
  for (const object of Object.values(snapshot.objects)) {
    if (object.type === 'list' || object.type === 'tuple') {
      object.slots.forEach((slotId) => { sourcesFor(slotId).containers += 1 })
    } else if (object.type === 'set') {
      object.items.forEach((itemId) => { sourcesFor(itemId).containers += 1 })
    } else if (object.type === 'dict') {
      object.entries.forEach((entry) => {
        sourcesFor(entry.key).containers += 1
        sourcesFor(entry.value).containers += 1
      })
    }
  }
  for (const entry of workArea) {
    if (snapshot.objects[entry.objectId]) {
      refCounts[entry.objectId] = (refCounts[entry.objectId] ?? 0) + 1
      sourcesFor(entry.objectId).work += 1
    }
  }

  /* -- names column ------------------------------------------------ */
  const names: NameTagLayout[] = []
  const scopeHeaders: ScopeHeaderLayout[] = []
  let nameY: number = m.pad
  for (const scope of snapshot.scopes) {
    scopeHeaders.push({
      scopeId: scope.id,
      label: scope.label,
      x: m.pad,
      y: nameY,
      width: m.nameWidth,
      height: m.scopeHeaderHeight,
    })
    nameY += m.scopeHeaderHeight + m.scopeHeaderGap
    for (const binding of scope.bindings) {
      names.push({
        key: `${scope.id}:${binding.name}`,
        name: binding.name,
        scopeId: scope.id,
        scopeLabel: scope.label,
        objectId: binding.objectId,
        draft: false,
        reference: { kind: 'name', name: binding.name },
        x: m.pad,
        y: nameY,
        width: m.nameWidth,
        height: m.nameHeight,
        anchor: { x: m.pad + m.nameWidth, y: nameY + m.nameHeight / 2 },
      })
      nameY += m.nameHeight + m.nameGap
    }
  }
  if (draftNames.length) {
    scopeHeaders.push({
      scopeId: '__drafts__',
      label: 'Drafts',
      x: m.pad,
      y: nameY,
      width: m.nameWidth,
      height: m.scopeHeaderHeight,
    })
    nameY += m.scopeHeaderHeight + m.scopeHeaderGap
    for (const draft of draftNames) {
      names.push({
        key: `draft:${draft.id}`,
        name: draft.name,
        scopeId: '__drafts__',
        scopeLabel: 'Drafts',
        objectId: null,
        draft: true,
        reference: null,
        x: m.pad,
        y: nameY,
        width: m.nameWidth,
        height: m.nameHeight,
        anchor: { x: m.pad + m.nameWidth, y: nameY + m.nameHeight / 2 },
      })
      nameY += m.nameHeight + m.nameGap
    }
  }
  const namesBottom = Math.max(m.pad, nameY - m.nameGap)

  /* -- object tiles ------------------------------------------------- */
  const walk = walkGraph(snapshot, workArea)
  const discoveryIndex = new Map(walk.order.map((id, i) => [id, i]))

  const byColumn = new Map<number, string[]>()
  for (const id of walk.order) {
    const column = walk.depth.get(id) ?? 0
    byColumn.set(column, [...(byColumn.get(column) ?? []), id])
  }
  const columnIndexes = [...byColumn.keys()].sort((a, b) => a - b)

  const columns: ColumnLayout[] = []
  let columnX = m.pad + m.nameWidth + m.columnGap
  for (const index of columnIndexes) {
    const ids = byColumn.get(index) ?? []
    const width = ids.reduce((w, id) => Math.max(w, tileWidth(snapshot.objects[id]!)), 0)
    columns.push({ index, x: columnX, width })
    columnX += width + m.columnGap
  }
  const columnAt = new Map(columns.map((c) => [c.index, c]))

  // Name tags feed the first column's ordering; after that each column is
  // ordered by the average height of its already-placed parents, which keeps
  // arrows from crossing without making the result depend on anything but the
  // snapshot itself.
  const nameCentres = new Map<string, number[]>()
  for (const tag of names) {
    if (!tag.objectId) continue
    nameCentres.set(tag.objectId, [...(nameCentres.get(tag.objectId) ?? []), tag.anchor.y])
  }

  const tiles: TileLayout[] = []
  const tileById = new Map<string, TileLayout>()
  let objectsBottom: number = m.pad

  for (const columnIndex of columnIndexes) {
    const column = columnAt.get(columnIndex)!
    const ids = [...(byColumn.get(columnIndex) ?? [])]
    const barycentre = new Map<string, number>()
    for (const id of ids) {
      const ys: number[] = []
      for (const parent of walk.parents.get(id) ?? []) {
        const tile = tileById.get(parent)
        if (tile) ys.push(tile.y + tile.height / 2)
      }
      for (const y of nameCentres.get(id) ?? []) ys.push(y)
      if (ys.length) barycentre.set(id, ys.reduce((a, b) => a + b, 0) / ys.length)
    }
    ids.sort((a, b) => {
      const ba = barycentre.get(a)
      const bb = barycentre.get(b)
      if (ba !== undefined && bb !== undefined && ba !== bb) return ba - bb
      if (ba !== undefined && bb === undefined) return -1
      if (ba === undefined && bb !== undefined) return 1
      return (discoveryIndex.get(a) ?? 0) - (discoveryIndex.get(b) ?? 0)
    })

    let y: number = m.pad
    ids.forEach((id, row) => {
      const object = snapshot.objects[id]!
      const width = tileWidth(object)
      const height = tileHeight(object)
      const rows = rowsOf(object)
      const slotsTop = y + m.tilePad + m.headerHeight + m.slotsGapTop
      const slots: SlotLayout[] = rows.map((r, i) => {
        const slotY = slotsTop + i * (m.slotHeight + m.slotGap)
        const tileRef = walk.reference.get(id) ?? null
        return {
          index: r.index,
          label: r.label,
          targetId: r.targetId,
          selectable: r.selectable,
          reference: r.selectable && tileRef
            ? { kind: 'slot', target: tileRef, index: r.index }
            : null,
          x: column.x + m.tilePad,
          y: slotY,
          width: width - m.tilePad * 2,
          height: m.slotHeight,
          anchor: { x: column.x + width, y: slotY + m.slotHeight / 2 },
        }
      })
      const tile: TileLayout = {
        objectId: id,
        object,
        column: columnIndex,
        row,
        x: column.x,
        y,
        width,
        height,
        headerHeight: m.headerHeight,
        footerHeight: m.footerHeight,
        slots,
        truncated: isTruncated(object),
        refCount: refCounts[id] ?? 0,
        reference: walk.reference.get(id) ?? null,
        inAnchor: { x: column.x, y: y + m.tilePad + m.headerHeight / 2 },
        selfAnchor: { x: column.x + width, y: y + m.tilePad + m.headerHeight / 2 },
        bottomAnchor: { x: column.x + width / 2, y: y + height },
      }
      tiles.push(tile)
      tileById.set(id, tile)
      y += height + m.tileGap
    })
    objectsBottom = Math.max(objectsBottom, y - m.tileGap)
  }

  const contentRight = columns.length
    ? columns[columns.length - 1].x + columns[columns.length - 1].width
    : m.pad + m.nameWidth
  const contentBottom = Math.max(namesBottom, objectsBottom)

  /* -- work area strip ---------------------------------------------- */
  const work: WorkChipLayout[] = []
  let workStripY: number | null = null
  let workBottom = contentBottom
  if (workArea.length) {
    workStripY = contentBottom + m.workGapTop
    const usable = Math.max(m.workChipWidth, contentRight - m.pad)
    const perRow = Math.max(1, Math.floor((usable + m.workChipGap) / (m.workChipWidth + m.workChipGap)))
    workArea.forEach((entry, i) => {
      const col = i % perRow
      const row = Math.floor(i / perRow)
      const x = m.pad + col * (m.workChipWidth + m.workChipGap)
      const y = workStripY! + row * (m.workChipHeight + m.workChipGap)
      work.push({
        slotId: entry.slotId,
        label: entry.label,
        objectId: entry.objectId,
        reference: { kind: 'work', slotId: entry.slotId },
        x,
        y,
        width: m.workChipWidth,
        height: m.workChipHeight,
        anchor: { x: x + m.workChipWidth / 2, y },
      })
      workBottom = Math.max(workBottom, y + m.workChipHeight)
    })
  }

  /* -- arrows -------------------------------------------------------- */
  const arrows: ArrowLayout[] = []
  const sharedSuffix = (objectId: string) => {
    const count = refCounts[objectId] ?? 0
    return count > 1 ? `, which ${count} references point at` : ''
  }

  for (const tag of names) {
    if (!tag.objectId) continue
    const tile = tileById.get(tag.objectId)
    if (!tile) continue
    arrows.push({
      id: `name:${tag.key}`,
      kind: 'name',
      sourceKey: tag.key,
      sourceObjectId: null,
      targetObjectId: tag.objectId,
      from: tag.anchor,
      to: tile.inAnchor,
      side: 'left',
      selfLoop: false,
      description: `${tag.name} refers to ${shortLabel(snapshot, tag.objectId)}${sharedSuffix(tag.objectId)}`,
    })
  }

  for (const chip of work) {
    const tile = tileById.get(chip.objectId)
    if (!tile) continue
    arrows.push({
      id: `work:${chip.slotId}`,
      kind: 'work',
      sourceKey: chip.slotId,
      sourceObjectId: null,
      targetObjectId: chip.objectId,
      from: chip.anchor,
      to: tile.bottomAnchor,
      side: 'bottom',
      selfLoop: false,
      description: `work item ${chip.label} refers to ${shortLabel(snapshot, chip.objectId)}${sharedSuffix(chip.objectId)}`,
    })
  }

  for (const tile of tiles) {
    for (const slot of tile.slots) {
      const target = tileById.get(slot.targetId)
      if (!target) continue
      const selfLoop = target.objectId === tile.objectId
      arrows.push({
        id: `slot:${tile.objectId}:${slot.index}`,
        kind: 'slot',
        sourceKey: `${tile.objectId}:${slot.index}`,
        sourceObjectId: tile.objectId,
        targetObjectId: slot.targetId,
        from: slot.anchor,
        to: selfLoop ? tile.selfAnchor : target.inAnchor,
        side: selfLoop ? 'right' : 'left',
        selfLoop,
        description: selfLoop
          ? `slot ${slot.label} of ${shortLabel(snapshot, tile.objectId)} refers back to that same object`
          : `slot ${slot.label} of ${shortLabel(snapshot, tile.objectId)} refers to ${shortLabel(snapshot, slot.targetId)}${sharedSuffix(slot.targetId)}`,
      })
    }
  }

  const width = Math.max(m.minWidth, contentRight + m.pad)
  const height = Math.max(m.minHeight, workBottom + m.pad)

  return {
    width,
    height,
    names,
    scopeHeaders,
    tiles,
    arrows,
    work,
    columns,
    refCounts,
    refSources,
    workStripY,
  }
}

/* ------------------------------------------------------------------ */
/* Nudging                                                             */
/* ------------------------------------------------------------------ */

export type TileOffsets = Record<string, { dx: number; dy: number }>

/**
 * Applies the student's own tile nudges on top of a computed layout.
 *
 * This is presentation only: it moves a tile, its slots and every arrow that
 * touches it, and returns a new layout. Nothing semantic is derived from it,
 * which is why nudging can never emit a callback.
 */
export function applyOffsets(layout: BrainLayout, offsets: TileOffsets): BrainLayout {
  const keys = Object.keys(offsets)
  if (keys.length === 0) return layout
  const shift = (p: Point, d: { dx: number; dy: number }): Point => ({ x: p.x + d.dx, y: p.y + d.dy })
  const zero = { dx: 0, dy: 0 }

  const tiles = layout.tiles.map((tile) => {
    const d = offsets[tile.objectId]
    if (!d) return tile
    return {
      ...tile,
      x: tile.x + d.dx,
      y: tile.y + d.dy,
      slots: tile.slots.map((slot) => ({
        ...slot,
        x: slot.x + d.dx,
        y: slot.y + d.dy,
        anchor: shift(slot.anchor, d),
      })),
      inAnchor: shift(tile.inAnchor, d),
      selfAnchor: shift(tile.selfAnchor, d),
      bottomAnchor: shift(tile.bottomAnchor, d),
    }
  })

  const arrows = layout.arrows.map((arrow) => {
    const fromDelta = arrow.sourceObjectId ? offsets[arrow.sourceObjectId] ?? zero : zero
    const toDelta = offsets[arrow.targetObjectId] ?? zero
    if (fromDelta === zero && toDelta === zero) return arrow
    return { ...arrow, from: shift(arrow.from, fromDelta), to: shift(arrow.to, toDelta) }
  })

  const width = tiles.reduce((w, t) => Math.max(w, t.x + t.width + METRICS.pad), layout.width)
  const height = tiles.reduce((h, t) => Math.max(h, t.y + t.height + METRICS.pad), layout.height)
  return { ...layout, tiles, arrows, width, height }
}

/* ------------------------------------------------------------------ */
/* Invariant helper, used by the tests and worth keeping honest         */
/* ------------------------------------------------------------------ */

export function overlappingTiles(layout: BrainLayout): [string, string][] {
  const clashes: [string, string][] = []
  for (let i = 0; i < layout.tiles.length; i++) {
    for (let j = i + 1; j < layout.tiles.length; j++) {
      const a = layout.tiles[i]
      const b = layout.tiles[j]
      const apart = a.x + a.width <= b.x || b.x + b.width <= a.x
        || a.y + a.height <= b.y || b.y + b.height <= a.y
      if (!apart) clashes.push([a.objectId, b.objectId])
    }
  }
  return clashes
}
