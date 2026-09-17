/**
 * The work area: things the student has made but has not named.
 *
 * It is drawn as a separate strip with dashed chips, and its arrows rise into
 * the bottom of the tiles, because an item here is not a Python name. Giving
 * one of these a name is a real binding and moves it into the names column;
 * until then it is only a holding place, which is exactly what `session.py`
 * means by `work_area`.
 */
import type { Snapshot } from '../runtime/types'
import type { BrainInteraction } from './BrainWorkspace'
import { shortLabel } from './layout'
import type { WorkChipLayout } from './layout'

export interface WorkAreaProps {
  chips: WorkChipLayout[]
  snapshot: Snapshot
  /** Top of the strip, from the layout. */
  stripY: number
  interaction: BrainInteraction
}

export function WorkArea({ chips, snapshot, stripY, interaction }: WorkAreaProps) {
  if (chips.length === 0) return null
  return (
    <>
      <p className="work-heading" style={{ left: 16, top: stripY - 20 }}>
        Made, not named yet
      </p>
      {chips.map((chip) => {
        const key = `work:${chip.slotId}`
        const selected = interaction.isSelected(chip.reference)
        const pickable = interaction.isPickable(chip.reference)
        const blocked = interaction.isBlocked(chip.reference)
        const target = shortLabel(snapshot, chip.objectId)
        return (
          <button
            key={chip.slotId}
            type="button"
            className="work-chip"
            style={{ left: chip.x, top: chip.y, width: chip.width, height: chip.height }}
            data-selected={selected}
            data-pick={pickable}
            data-blocked={blocked}
            aria-disabled={blocked || undefined}
            tabIndex={interaction.activeKey === key ? 0 : -1}
            ref={(el) => interaction.register(key, el)}
            data-brain-key={key}
            onPointerDown={(event) => interaction.drag?.start({
              kind: 'object',
              objectId: chip.objectId,
              ref: chip.reference,
              label: target,
            }, event)}
            onClick={() => interaction.activate(chip.reference)}
          >
            <span className="work-chip-label" aria-hidden="true">
              {chip.label}{selected ? ' ✓' : ''}
            </span>
            <span className="work-chip-value" aria-hidden="true">→ {target}</span>
            <span className="brain-sr">
              Work item {chip.label}, not named yet, refers to {target}.
              {selected ? ' Picked.' : ''}
              {blocked ? ' Not one of the things to pick right now.' : ''}
            </span>
          </button>
        )
      })}
    </>
  )
}
