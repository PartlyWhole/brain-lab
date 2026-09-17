/**
 * Pointer-based dragging for the memory workspace.
 *
 * Pointer events rather than HTML5 drag-and-drop: HTML5 DnD does not fire on
 * touch, and a tablet is one of the supported devices. It also lets the drag
 * threshold live here, so a plain click still reaches the click handler and
 * every drag gesture keeps a click-only equivalent.
 *
 * Drop targets are declared in the DOM with a `data-drop` attribute and found
 * by hit-testing at the pointer, so the whole gesture is handled in one place
 * instead of being threaded through every child component.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrainReference } from './layout'

/** What is being dragged. */
export type DragPayload =
  | { kind: 'name'; name: string }
  | { kind: 'newName' }
  | { kind: 'object'; objectId: string; ref: BrainReference | null; label: string }
  | { kind: 'make'; make: 'int' | 'str' | 'list'; label: string }

/** Where it can be dropped. */
export type DropTarget =
  | { kind: 'object'; objectId: string }
  | { kind: 'slot'; objectId: string; index: number }
  | { kind: 'canvas' }
  /** A well on the operation bench, where two inputs are combined. */
  | { kind: 'well'; index: number }

export interface DragState {
  payload: DragPayload
  x: number
  y: number
  over: DropTarget | null
}

/** Serialises a drop target into the `data-drop` attribute. */
export function dropAttr(target: DropTarget): string {
  switch (target.kind) {
    case 'object': return `object:${target.objectId}`
    case 'slot': return `slot:${target.objectId}:${target.index}`
    case 'canvas': return 'canvas'
    case 'well': return `well:${target.index}`
  }
}

export function parseDrop(value: string | null | undefined): DropTarget | null {
  if (!value) return null
  const parts = value.split(':')
  if (parts[0] === 'canvas') return { kind: 'canvas' }
  if (parts[0] === 'object' && parts[1]) return { kind: 'object', objectId: parts[1] }
  if (parts[0] === 'slot' && parts[1] && parts[2] !== undefined) {
    return { kind: 'slot', objectId: parts[1], index: Number(parts[2]) }
  }
  if (parts[0] === 'well' && parts[1] !== undefined) {
    return { kind: 'well', index: Number(parts[1]) }
  }
  return null
}

export interface DragConfig {
  /** Whether this payload may land on this target. Drives the drop highlight. */
  canDrop: (payload: DragPayload, target: DropTarget) => boolean
  /** Perform the drop. */
  onDrop: (payload: DragPayload, target: DropTarget) => void
  /** A short sentence describing what the drop would do, shown while dragging. */
  describe?: (payload: DragPayload, target: DropTarget | null) => string
}

export interface BrainDrag {
  state: DragState | null
  /** Begin a drag. Call from onPointerDown; a plain click is unaffected. */
  start: (payload: DragPayload, event: React.PointerEvent) => void
  canDrop: (target: DropTarget) => boolean
  isOver: (target: DropTarget) => boolean
  /** True once the pointer has moved far enough to count as a drag. */
  active: boolean
  message: string | null
}

const THRESHOLD = 5

export function useBrainDrag(config: DragConfig | undefined): BrainDrag {
  const [state, setState] = useState<DragState | null>(null)
  const pending = useRef<{ payload: DragPayload; x: number; y: number } | null>(null)
  const stateRef = useRef<DragState | null>(null)
  stateRef.current = state

  const start = useCallback((payload: DragPayload, event: React.PointerEvent) => {
    if (!config) return
    if (event.button !== 0 && event.pointerType === 'mouse') return
    pending.current = { payload, x: event.clientX, y: event.clientY }
  }, [config])

  useEffect(() => {
    if (!config) return

    const findTarget = (x: number, y: number): DropTarget | null => {
      // The ghost follows the pointer, so it must not be hit-tested itself.
      const el = document.elementFromPoint(x, y) as HTMLElement | null
      const holder = el?.closest('[data-drop]') as HTMLElement | null
      return parseDrop(holder?.getAttribute('data-drop'))
    }

    const move = (event: PointerEvent) => {
      const seed = pending.current
      if (seed && !stateRef.current) {
        const moved = Math.hypot(event.clientX - seed.x, event.clientY - seed.y)
        if (moved < THRESHOLD) return
        setState({ payload: seed.payload, x: event.clientX, y: event.clientY, over: null })
        return
      }
      const current = stateRef.current
      if (!current) return
      event.preventDefault()
      const over = findTarget(event.clientX, event.clientY)
      setState({
        payload: current.payload,
        x: event.clientX,
        y: event.clientY,
        over: over && config.canDrop(current.payload, over) ? over : null,
      })
    }

    const finish = (event: PointerEvent) => {
      const current = stateRef.current
      pending.current = null
      if (!current) return
      const over = findTarget(event.clientX, event.clientY)
      setState(null)
      if (over && config.canDrop(current.payload, over)) {
        config.onDrop(current.payload, over)
      }
    }

    const cancel = () => {
      pending.current = null
      setState(null)
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }

    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', onKey)
    }
  }, [config])

  const sameTarget = (a: DropTarget, b: DropTarget) => dropAttr(a) === dropAttr(b)

  return {
    state,
    start,
    active: state !== null,
    canDrop: (target) => !!state && !!config && config.canDrop(state.payload, target),
    isOver: (target) => !!state?.over && sameTarget(state.over, target),
    message: state && config?.describe ? config.describe(state.payload, state.over) : null,
  }
}

/** A short human label for what is in hand, used by the drag ghost. */
export function payloadLabel(payload: DragPayload): string {
  switch (payload.kind) {
    case 'name': return payload.name
    case 'newName': return 'new name'
    case 'object': return payload.label
    case 'make': return payload.label
  }
}
