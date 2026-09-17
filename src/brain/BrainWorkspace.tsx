/**
 * The robot's brain, drawn.
 *
 * Everything on screen comes from the snapshot in props. The component keeps
 * no copy of it, derives the whole picture in one pure pass through
 * `computeLayout`, and holds only presentation state — which tile the student
 * has nudged and where keyboard focus is. That is what makes stepping back
 * through history safe: an earlier snapshot renders exactly as it did the
 * first time, because there is nothing left over from the later one.
 *
 * The three visual languages are kept strictly apart:
 *
 *   reference  a thin curved arrow between boxes           (ReferenceArrows)
 *   execution  a filled pill in the top bar with a card id (this file)
 *   attention  a heavy ring plus the words "just changed"  (ObjectTile)
 *
 * Nothing needs a mouse. Every name, tile, slot and work-area chip is a real
 * button, so Enter and Space activate it; arrow keys rove within each of the
 * three regions; Alt with an arrow key nudges a tile, which is layout only and
 * deliberately emits nothing.
 */
import { useCallback, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Snapshot } from '../runtime/types'
import { NameTag } from './NameTag'
import { ObjectTile } from './ObjectTile'
import { OutputPanel } from './OutputPanel'
import { ReferenceArrows } from './ReferenceArrows'
import { WorkArea } from './WorkArea'
import {
  METRICS,
  applyOffsets,
  computeLayout,
  isContainer,
  sameReference,
  shortLabel,
} from './layout'
import type {
  BrainLayout, BrainReference, DraftName, ReferenceSources, TileOffsets, WorkAreaEntry,
} from './layout'
import { dropAttr, payloadLabel, type BrainDrag } from './drag'

/** Used when the host has not enabled dragging, so nothing is ever a target. */
const NO_DRAG: BrainDrag = {
  state: null,
  start: () => {},
  canDrop: () => false,
  isOver: () => false,
  active: false,
  message: null,
}
import './brain.css'

export type { BrainReference } from './layout'

export interface BrainWorkspaceProps {
  snapshot: Snapshot
  workArea?: WorkAreaEntry[]
  output?: string
  /** Card currently executing, for the execution marker. Null when idle. */
  executingCardId?: string | null
  /** Object ids to emphasise, e.g. what an operation just touched. */
  highlightObjectIds?: string[]
  /** Draft labels not yet bound to anything. Must look clearly different. */
  draftNames?: DraftName[]
  /** Click-to-select interaction. Called with a reference descriptor. */
  onSelectReference?: (ref: BrainReference) => void
  /**
   * What the student is currently being asked to pick, or null.
   *
   * `accepts` is readonly so a caller can write `['name', 'work'] as const`,
   * which is the natural spelling and otherwise needs a cast at every site.
   */
  selectionPrompt?: { message: string; accepts: readonly BrainReference['kind'][] } | null
  selectedRefs?: BrainReference[]
  readOnly?: boolean
  /** What to say when there is nothing to show yet. */
  emptyMessage?: string
  /** Heading for the workspace. */
  title?: string
  /** Show the running/not-running badge. Off where nothing executes. */
  showExecution?: boolean
  /** Show the printed-output panel. Off where nothing can print. */
  showOutput?: boolean
  /** Keyboard help. Should describe what this context actually offers. */
  hint?: string
  /**
   * The live drag engine, created by the host with `useBrainDrag`.
   *
   * The host owns it rather than the workspace, so controls outside the canvas
   * — a palette, a bench — start drags through the same engine and behave
   * identically to a drag that starts on a tile. Every drag also has a
   * click-only equivalent; this is an addition, never the only way.
   */
  drag?: BrainDrag
}

/**
 * What a name tag, tile, slot or chip needs in order to behave. Passed down
 * rather than rebuilt in each child, so selection and focus rules exist once.
 */
export interface BrainInteraction {
  /** Dragging, when the host enabled it. Absent means click-only. */
  drag?: BrainDrag
  isSelected: (ref: BrainReference | null) => boolean
  isPickable: (ref: BrainReference | null) => boolean
  isBlocked: (ref: BrainReference | null) => boolean
  activate: (ref: BrainReference | null) => void
  register: (key: string, element: HTMLElement | null) => void
  /** The one key in this region that is in the tab order right now. */
  activeKey: string | null
}

const NUDGE = 12
const EMPTY_WORK: WorkAreaEntry[] = []
const EMPTY_DRAFTS: DraftName[] = []
const EMPTY_REFS: BrainReference[] = []
const EMPTY_IDS: string[] = []

/* ------------------------------------------------------------------ */
/* Spoken descriptions                                                 */
/* ------------------------------------------------------------------ */

/**
 * Counts the kinds of reference separately.
 *
 * A bare total would say "3 references" for a list that two names and one
 * work-area item reach, which buries the fact the mission is about. Naming the
 * kinds keeps it truthful *and* legible: "2 names and 1 work-area item".
 */
function refWords(sources: ReferenceSources | undefined, total: number): string {
  if (!sources || total === 0) return 'Nothing points here'
  const parts: string[] = []
  const n = sources.names.length
  if (n > 0) parts.push(`${n} name${n === 1 ? '' : 's'}`)
  if (sources.containers > 0) {
    parts.push(`${sources.containers} slot${sources.containers === 1 ? '' : 's'}`)
  }
  if (sources.work > 0) {
    parts.push(`${sources.work} work-area item${sources.work === 1 ? '' : 's'}`)
  }
  if (parts.length === 0) return `${total} reference${total === 1 ? '' : 's'} point here`
  const joined = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  const singular = total === 1
  return `${joined} point${singular ? 's' : ''} here`
}

/**
 * The sentence a screen reader gets for a tile. It carries every fact the
 * arrows carry, because the arrows themselves are `aria-hidden`.
 */
function tileSentences(
  snapshot: Snapshot,
  layout: BrainLayout,
  workArea: WorkAreaEntry[],
): Record<string, string> {
  const sources = new Map<string, string[]>()
  const add = (objectId: string, phrase: string) => {
    sources.set(objectId, [...(sources.get(objectId) ?? []), phrase])
  }
  for (const tag of layout.names) {
    if (tag.objectId) add(tag.objectId, `the name ${tag.name}`)
  }
  for (const entry of workArea) {
    if (snapshot.objects[entry.objectId]) add(entry.objectId, `work item ${entry.label}`)
  }
  for (const tile of layout.tiles) {
    for (const slot of tile.slots) {
      add(
        slot.targetId,
        slot.targetId === tile.objectId
          ? `its own slot ${slot.label}`
          : `slot ${slot.label} of ${shortLabel(snapshot, tile.objectId)}`,
      )
    }
  }

  const out: Record<string, string> = {}
  for (const tile of layout.tiles) {
    const parts: string[] = [shortLabel(snapshot, tile.objectId) + '.']
    if (isContainer(tile.object)) {
      parts.push(tile.slots.length === 0
        ? 'No slots yet.'
        : `${tile.slots.length} slot${tile.slots.length === 1 ? '' : 's'}.`)
      if (tile.truncated) parts.push('Some slots are not shown.')
    }
    const from = sources.get(tile.objectId) ?? []
    const listed = from.slice(0, 4).join(', ')
    const words = refWords(layout.refSources[tile.objectId], tile.refCount)
    parts.push(from.length === 0
      ? `${words}.`
      : `${words}: ${listed}${from.length > 4 ? `, and ${from.length - 4} more` : ''}.`)
    out[tile.objectId] = parts.join(' ')
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function BrainWorkspace(props: BrainWorkspaceProps) {
  const {
  snapshot,
  workArea = EMPTY_WORK,
  output = '',
  executingCardId = null,
  highlightObjectIds = EMPTY_IDS,
  draftNames = EMPTY_DRAFTS,
  onSelectReference,
  selectionPrompt = null,
  selectedRefs = EMPTY_REFS,
  readOnly = false,
} = props
  const domId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const nodes = useRef(new Map<string, HTMLElement>())

  /* -- presentation-only state ------------------------------------- */
  const [offsets, setOffsets] = useState<TileOffsets>({})
  const [activeKeys, setActiveKeys] = useState<Record<string, string | null>>({})

  /* -- layout -------------------------------------------------------- */
  // Nudges are dropped for objects the current snapshot does not contain, so
  // a position from a later state can never reappear on an earlier one.
  const liveOffsets = useMemo(() => {
    const kept: TileOffsets = {}
    for (const [id, delta] of Object.entries(offsets)) {
      if (snapshot.objects[id]) kept[id] = delta
    }
    return kept
  }, [offsets, snapshot])

  const layout = useMemo(
    () => applyOffsets(computeLayout({ snapshot, workArea, draftNames }), liveOffsets),
    [snapshot, workArea, draftNames, liveOffsets],
  )

  const descriptions = useMemo(
    () => tileSentences(snapshot, layout, workArea),
    [snapshot, layout, workArea],
  )
  const highlighted = useMemo(() => new Set(highlightObjectIds), [highlightObjectIds])

  /* -- selection rules ----------------------------------------------- */
  const isSelected = useCallback(
    (ref: BrainReference | null) => !!ref && selectedRefs.some((r) => sameReference(r, ref)),
    [selectedRefs],
  )
  const accepts = selectionPrompt?.accepts
  /**
   * "Pickable" marks a valid destination for the thing currently being chosen,
   * so it only means something while a choice is actually being made. Marking
   * everything at rest ringed the whole workspace and told the student
   * nothing; clicking still works on anything, with or without the ring.
   */
  const isPickable = useCallback(
    (ref: BrainReference | null) =>
      !!ref && !readOnly && !!onSelectReference && !!accepts && accepts.includes(ref.kind),
    [readOnly, onSelectReference, accepts],
  )
  const isBlocked = useCallback(
    (ref: BrainReference | null) => !!ref && !readOnly && !!accepts && !accepts.includes(ref.kind),
    [readOnly, accepts],
  )
  /**
   * A click always reaches the host, which decides what it means. Pickability
   * is a *styling* signal about what the current choice will accept — gating
   * the click on it would make everything unclickable whenever no choice is
   * in progress, which is exactly when picking something up has to work.
   * A blocked reference is still refused, because that is a stated "not this".
   */
  const activate = useCallback(
    (ref: BrainReference | null) => {
      if (ref && !readOnly && !isBlocked(ref)) onSelectReference?.(ref)
    },
    [readOnly, isBlocked, onSelectReference],
  )

  const register = useCallback((key: string, element: HTMLElement | null) => {
    if (element) nodes.current.set(key, element)
    else nodes.current.delete(key)
  }, [])

  /* -- roving focus --------------------------------------------------- */
  const nameKeys = useMemo(() => layout.names.map((n) => `name:${n.key}`), [layout])
  const objectKeys = useMemo(() => {
    const keys: string[] = []
    for (const tile of layout.tiles) {
      keys.push(`tile:${tile.objectId}`)
      for (const slot of tile.slots) keys.push(`slot:${tile.objectId}:${slot.index}`)
    }
    return keys
  }, [layout])
  const workKeys = useMemo(() => layout.work.map((w) => `work:${w.slotId}`), [layout])

  const settle = (region: string, keys: string[]) => {
    const wanted = activeKeys[region]
    return wanted && keys.includes(wanted) ? wanted : (keys[0] ?? null)
  }
  const activeName = settle('names', nameKeys)
  const activeObject = settle('objects', objectKeys)
  const activeWork = settle('work', workKeys)

  const focusKey = (region: string, key: string | undefined) => {
    if (!key) return
    setActiveKeys((prev) => ({ ...prev, [region]: key }))
    nodes.current.get(key)?.focus()
  }

  const keyUnder = (event: KeyboardEvent<HTMLElement>): string | null => {
    const target = event.target as HTMLElement | null
    return target?.closest?.('[data-brain-key]')?.getAttribute('data-brain-key') ?? null
  }

  const rove = (
    event: KeyboardEvent<HTMLElement>,
    region: string,
    keys: string[],
    axis: 'vertical' | 'horizontal',
  ): boolean => {
    const current = keyUnder(event)
    const at = current ? keys.indexOf(current) : -1
    const forward = axis === 'vertical' ? 'ArrowDown' : 'ArrowRight'
    const back = axis === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
    if (event.key === forward) {
      focusKey(region, keys[Math.min(keys.length - 1, at + 1)])
      return true
    }
    if (event.key === back) {
      focusKey(region, keys[Math.max(0, at - 1)])
      return true
    }
    if (event.key === 'Home') {
      focusKey(region, keys[0])
      return true
    }
    if (event.key === 'End') {
      focusKey(region, keys[keys.length - 1])
      return true
    }
    return false
  }

  const onNamesKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (rove(event, 'names', nameKeys, 'vertical')) event.preventDefault()
  }

  const onWorkKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (rove(event, 'work', workKeys, 'horizontal')) event.preventDefault()
  }

  const onObjectsKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const current = keyUnder(event)

    // Alt plus an arrow moves the tile on screen. This is drawing, not
    // meaning: no callback fires, and the snapshot is untouched.
    if (event.altKey && current) {
      const objectId = current.split(':')[1]
      const step: Record<string, [number, number]> = {
        ArrowLeft: [-NUDGE, 0],
        ArrowRight: [NUDGE, 0],
        ArrowUp: [0, -NUDGE],
        ArrowDown: [0, NUDGE],
      }
      if (event.key in step) {
        const [dx, dy] = step[event.key]
        setOffsets((prev) => {
          const at = prev[objectId] ?? { dx: 0, dy: 0 }
          return { ...prev, [objectId]: { dx: at.dx + dx, dy: at.dy + dy } }
        })
        event.preventDefault()
        return
      }
      if (event.key === '0') {
        setOffsets((prev) => {
          const next = { ...prev }
          delete next[objectId]
          return next
        })
        event.preventDefault()
        return
      }
    }

    // Left and right jump between whole tiles; up and down walk every stop,
    // tile heads and slots alike, so a slot is always reachable.
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const heads = objectKeys.filter((k) => k.startsWith('tile:'))
      const here = current?.startsWith('tile:')
        ? current
        : `tile:${current?.split(':')[1] ?? ''}`
      const at = heads.indexOf(here)
      const next = event.key === 'ArrowRight'
        ? heads[Math.min(heads.length - 1, at + 1)]
        : heads[Math.max(0, at - 1)]
      focusKey('objects', next)
      event.preventDefault()
      return
    }
    if (rove(event, 'objects', objectKeys, 'vertical')) event.preventDefault()
  }

  const brainDrag = props.drag ?? NO_DRAG

  const interactionFor = (activeKey: string | null): BrainInteraction => ({
    isSelected, isPickable, isBlocked, activate, register, activeKey,
    drag: props.drag,
  })
  const nameInteraction = interactionFor(activeName)
  const objectInteraction = interactionFor(activeObject)
  const workInteraction = interactionFor(activeWork)

  const nothingToShow = layout.tiles.length === 0 && layout.names.length === 0
  const emptyMessage = props.emptyMessage
    ?? 'The brain is empty. Nothing has been made yet.'
  const title = props.title ?? 'Robot brain'
  const showExecution = props.showExecution ?? true
  const showOutput = props.showOutput ?? true
  const hint = props.hint
    ?? 'Arrow keys move. Enter picks. Hold Alt with an arrow key to slide a tile.'

  return (
    <section className="brain" aria-label={title}>
      <div className="brain-bar">
        <h2 className="brain-title">{title}</h2>

        {/* Nothing executes in a sandbox, so a "not running" badge there would
            be answering a question nobody asked. */}
        {showExecution && (
          <div role="status">
            {executingCardId
              ? (
                <span className="brain-exec">
                  <span className="brain-exec-dot" aria-hidden="true" />
                  <span className="brain-exec-glyph" aria-hidden="true">▶</span>
                  Running {executingCardId}
                </span>
              )
              : <span className="brain-idle"><span aria-hidden="true">■</span> Not running</span>}
          </div>
        )}

        <p className="brain-prompt" role="status" hidden={!selectionPrompt}>
          {selectionPrompt?.message}
        </p>

        {readOnly && <p className="brain-readonly">Replay — picking is off</p>}

        <p className="brain-hint">{hint}</p>
      </div>

      <div className="brain-scroll">
        <div
          className="brain-canvas"
          style={{ width: layout.width, height: layout.height, minWidth: METRICS.minWidth }}
          // Empty canvas accepts a newly made object.
          data-drop={dropAttr({ kind: 'canvas' })}
          data-drop-ok={brainDrag.canDrop({ kind: 'canvas' })}
          data-drop-over={brainDrag.isOver({ kind: 'canvas' })}
        >
          <ReferenceArrows
            arrows={layout.arrows}
            width={layout.width}
            height={layout.height}
            highlightObjectIds={highlighted}
            faded={highlighted.size > 0}
          />

          {nothingToShow && (
            <p className="brain-nothing">{emptyMessage}</p>
          )}

          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <div
            className="brain-layer"
            role="group"
            aria-label="Names in the brain"
            onKeyDown={onNamesKeyDown}
          >
            {layout.scopeHeaders.map((header) => (
              <p
                key={header.scopeId}
                className="brain-scope"
                style={{
                  left: header.x, top: header.y,
                  width: header.width, height: header.height,
                }}
              >
                {header.label}
              </p>
            ))}
            {layout.names.map((tag) => (
              <NameTag
                key={tag.key}
                tag={tag}
                description={
                  tag.draft
                    ? `${tag.name} is a draft label. It is not a name in the brain yet and refers to nothing.`
                    : tag.objectId
                      ? `${tag.name} refers to ${shortLabel(snapshot, tag.objectId)}${
                        (layout.refCounts[tag.objectId] ?? 0) > 1
                          ? `, which ${refWords(layout.refSources[tag.objectId], layout.refCounts[tag.objectId] ?? 0).replace(/ points? here$/, '')} point at`
                          : ''}`
                      : `${tag.name} refers to something the lab cannot show.`
                }
                descriptionId={`${domId}-name-${tag.key.replace(/[^a-zA-Z0-9]/g, '-')}`}
                interaction={nameInteraction}
              />
            ))}
          </div>

          <div
            className="brain-layer"
            role="group"
            aria-label="Objects in the brain"
            onKeyDown={onObjectsKeyDown}
          >
            {layout.tiles.map((tile) => (
              <ObjectTile
                key={tile.objectId}
                tile={tile}
                snapshot={snapshot}
                description={descriptions[tile.objectId] ?? ''}
                descriptionId={`${domId}-tile-${tile.objectId}`}
                highlighted={highlighted.has(tile.objectId)}
                nudged={!!liveOffsets[tile.objectId]}
                interaction={objectInteraction}
              />
            ))}
          </div>

          <div
            className="brain-layer"
            role="group"
            aria-label="Things made but not named"
            onKeyDown={onWorkKeyDown}
          >
            <WorkArea
              chips={layout.work}
              snapshot={snapshot}
              stripY={layout.workStripY ?? 0}
              interaction={workInteraction}
            />
          </div>
        </div>
      </div>

      {showOutput && <OutputPanel text={output} live={!readOnly} />}

      {brainDrag.state && (
        <>
          {/* The ghost must never be hit-tested, or it would shadow the target
              directly under the pointer. */}
          <div
            className="drag-ghost"
            style={{ left: brainDrag.state.x, top: brainDrag.state.y }}
            aria-hidden="true"
          >
            {payloadLabel(brainDrag.state.payload)}
          </div>
          <p className="drag-say" role="status">{brainDrag.message}</p>
        </>
      )}
    </section>
  )
}
