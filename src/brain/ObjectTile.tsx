/**
 * One tile for one object. Never two tiles for one object, and never an object
 * painted inside another object's tile.
 *
 * A container tile lists exactly the slots the snapshot reports. A slot shows
 * its index and a short read-only echo of what it refers to, but the referred
 * object itself is a separate tile at the other end of an arrow, so the echo
 * can never be mistaken for the thing. A container with no slots says "no
 * slots yet" in words rather than drawing an empty box: an empty box would
 * look like capacity, and Python lists have no capacity to show.
 *
 * There is no "add a slot" control here on purpose. Adding is an operation the
 * student performs from the operations palette, outside the object, because
 * appending is something you do *to* a list, not a hole inside it.
 */
import type { Snapshot } from '../runtime/types'
import type { BrainInteraction } from './BrainWorkspace'
import { identityBadge, isContainer, isMutable, shortLabel, typeWord } from './layout'
import type { SlotLayout, TileLayout } from './layout'

export interface ObjectTileProps {
  tile: TileLayout
  snapshot: Snapshot
  description: string
  descriptionId: string
  highlighted: boolean
  nudged: boolean
  interaction: BrainInteraction
}

/** A text glyph per type, so type is never carried by colour alone. */
function glyphFor(type: string): string {
  switch (type) {
    case 'int': case 'float': return '123'
    case 'str': return 'Aa'
    case 'list': return '[ ]'
    case 'tuple': return '( )'
    case 'dict': return '{:}'
    case 'set': return '{ }'
    case 'bool': return 'T/F'
    case 'none': return '--'
    case 'function': return 'def'
    default: return '?'
  }
}

function valueText(snapshot: Snapshot, tile: TileLayout): string {
  const object = tile.object
  switch (object.type) {
    case 'int':
    case 'float': return object.text
    case 'str': return JSON.stringify(object.text) + (object.truncated ? '…' : '')
    case 'bool': return object.value ? 'True' : 'False'
    case 'none': return 'None'
    case 'function': return `${object.name}()`
    case 'unsupported': return object.label
    case 'elided': return 'too deep to show'
    default: return shortLabel(snapshot, tile.objectId)
  }
}

/**
 * The short form for the tile footer. Sharing is the fact worth shouting, so
 * it gets the word "shared"; the full sentence lives in the hidden description.
 */
function refWords(count: number): string {
  if (count === 0) return 'no arrows in'
  if (count === 1) return '1 arrow in'
  return `shared ×${count}`
}

function Slot({ tile, slot, snapshot, interaction }: {
  tile: TileLayout
  slot: SlotLayout
  snapshot: Snapshot
  interaction: BrainInteraction
}) {
  const key = `slot:${tile.objectId}:${slot.index}`
  const reference = slot.reference
  const selected = interaction.isSelected(reference)
  const pickable = interaction.isPickable(reference)
  const blocked = interaction.isBlocked(reference)
  const target = shortLabel(snapshot, slot.targetId)

  return (
    <button
      type="button"
      className="tile-slot"
      data-selectable={slot.selectable}
      data-selected={selected}
      data-pick={pickable}
      data-blocked={blocked}
      aria-disabled={blocked || !reference || undefined}
      tabIndex={interaction.activeKey === key ? 0 : -1}
      ref={(el) => interaction.register(key, el)}
      data-brain-key={key}
      onClick={() => interaction.activate(reference)}
    >
      <span className="tile-slot-index" aria-hidden="true">{slot.label}</span>
      <span className="tile-slot-value" aria-hidden="true">→ {target}</span>
      {selected && <span aria-hidden="true">✓</span>}
      <span className="brain-sr">
        {slot.selectable ? `Slot ${slot.label}` : slot.label} refers to {target}.
        {selected ? ' Picked.' : ''}
        {blocked ? ' Not one of the things to pick right now.' : ''}
      </span>
    </button>
  )
}

export function ObjectTile({
  tile, snapshot, description, descriptionId, highlighted, nudged, interaction,
}: ObjectTileProps) {
  const object = tile.object
  const container = isContainer(object)
  const headKey = `tile:${tile.objectId}`
  const reference = tile.reference
  const selected = interaction.isSelected(reference)
  const pickable = interaction.isPickable(reference)
  const blocked = interaction.isBlocked(reference)

  return (
    <div
      className="tile"
      style={{ left: tile.x, top: tile.y, width: tile.width, height: tile.height }}
      data-type={object.type}
      data-highlight={highlighted}
      data-nudged={nudged}
      data-selected={selected}
      role="group"
      aria-label={`${typeWord(object)} ${identityBadge(tile.objectId)}`}
    >
      <button
        type="button"
        className="tile-head"
        data-pick={pickable}
        data-blocked={blocked}
        aria-disabled={blocked || !reference || undefined}
        aria-describedby={descriptionId}
        tabIndex={interaction.activeKey === headKey ? 0 : -1}
        ref={(el) => interaction.register(headKey, el)}
        data-brain-key={headKey}
        onClick={() => interaction.activate(reference)}
      >
        <span className="tile-kind">
          <span className="tile-glyph" aria-hidden="true">{glyphFor(object.type)}</span>
          {typeWord(object)}
        </span>
        {isMutable(object) && (
          <span className="tile-badge">{identityBadge(tile.objectId)}</span>
        )}
        <span className="brain-sr" id={descriptionId}>
          {description}
          {selected ? ' Picked.' : ''}
          {blocked ? ' Not one of the things to pick right now.' : ''}
        </span>
      </button>

      {!container && <div className="tile-value">{valueText(snapshot, tile)}</div>}

      {container && tile.slots.length === 0 && (
        <p className="tile-empty">no slots yet</p>
      )}

      {container && tile.slots.length > 0 && (
        <div className="tile-slots">
          {tile.slots.map((slot) => (
            <Slot
              key={`${tile.objectId}:${slot.index}`}
              tile={tile}
              slot={slot}
              snapshot={snapshot}
              interaction={interaction}
            />
          ))}
        </div>
      )}

      {tile.truncated && <p className="tile-more">…more not shown</p>}

      <p className="tile-foot" data-shared={tile.refCount > 1}>
        {highlighted && <span className="tile-changed">just changed</span>}
        <span>{refWords(tile.refCount)}</span>
      </p>
    </div>
  )
}
