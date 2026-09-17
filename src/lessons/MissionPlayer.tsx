import type { Mission } from './schema'
import { ManualMission } from './ManualMission'
import { InventMission } from './InventMission'

/** Picks the experience for a mission from how it is completed, not its mode. */
export function MissionPlayer({ mission }: { mission: Mission }) {
  return mission.goal.kind === 'manual'
    ? <ManualMission mission={mission} />
    : <InventMission mission={mission} />
}
