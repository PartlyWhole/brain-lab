/**
 * The reference layer: one SVG sized to the whole workspace, holding every
 * arrow and nothing else.
 *
 * An arrow means exactly one thing — "this refers to that" — so all arrows
 * share one treatment: a thin curved line with a small head. The execution
 * marker and the "just changed" highlight are deliberately not lines, so a
 * student never has to guess whether a mark is about a reference or about
 * what the robot is doing.
 *
 * The whole layer is `aria-hidden`. Every relationship it draws is also stated
 * in the visually-hidden sentence attached to the name tag, slot or tile at
 * either end, so nothing here is the only way to learn a fact.
 */
import { useId } from 'react'
import type { ArrowLayout } from './layout'

export interface ReferenceArrowsProps {
  arrows: ArrowLayout[]
  width: number
  height: number
  /** Objects the caller asked to emphasise. Their arrows thicken. */
  highlightObjectIds: Set<string>
  /** When something is being emphasised, the arrows around it fade back. */
  faded: boolean
}

/**
 * A cubic curve between two anchors.
 *
 * Three shapes, because three situations genuinely differ:
 *  - a self reference loops out of the right edge and back into it, bulging in
 *    y so it is never a zero-length or straight-line path even when the two
 *    anchors share a y;
 *  - a work-area arrow rises from below;
 *  - everything else flows left to right.
 */
function pathFor(arrow: ArrowLayout): string {
  const { from, to } = arrow
  if (arrow.selfLoop) {
    const out = 52
    const lift = 30
    return `M ${from.x} ${from.y} C ${from.x + out} ${from.y + lift}, ${to.x + out} ${to.y - lift}, ${to.x} ${to.y}`
  }
  if (arrow.side === 'bottom') {
    const dy = Math.max(30, Math.abs(to.y - from.y) * 0.45)
    return `M ${from.x} ${from.y} C ${from.x} ${from.y - dy}, ${to.x} ${to.y + dy}, ${to.x} ${to.y}`
  }
  const dx = Math.min(Math.max(Math.abs(to.x - from.x) * 0.45, 28), 130)
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`
}

export function ReferenceArrows({
  arrows, width, height, highlightObjectIds, faded,
}: ReferenceArrowsProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const heads = {
    slot: `arrowhead-slot-${uid}`,
    name: `arrowhead-name-${uid}`,
    work: `arrowhead-work-${uid}`,
  }

  return (
    <svg
      className="brain-arrows"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {(['slot', 'name', 'work'] as const).map((kind) => (
          <marker
            key={kind}
            id={heads[kind]}
            markerWidth="9"
            markerHeight="9"
            refX="7.5"
            refY="4"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path
              d="M 0 0 L 8 4 L 0 8 z"
              className={kind === 'slot' ? 'brain-arrowhead' : `brain-arrowhead-${kind}`}
            />
          </marker>
        ))}
      </defs>
      {arrows.map((arrow) => {
        const emphasised = highlightObjectIds.has(arrow.targetObjectId)
          || (arrow.sourceObjectId !== null && highlightObjectIds.has(arrow.sourceObjectId))
        return (
          <path
            key={arrow.id}
            className="brain-arrow"
            data-kind={arrow.kind}
            data-emphasis={emphasised}
            data-faded={faded && !emphasised}
            d={pathFor(arrow)}
            markerEnd={`url(#${heads[arrow.kind]})`}
          />
        )
      })}
    </svg>
  )
}
