/**
 * The mission list, in teaching order.
 *
 * Every mission is validated by `parseMission` here, at the boundary, so a
 * malformed mission fails loudly when the content module loads rather than
 * halfway through a lesson. `rawMissions` is exported unparsed so tests can
 * exercise the schema gate explicitly instead of relying on this module's
 * import throwing.
 */
import { parseMission, type Mission } from '../../src/lessons/schema'

import { bindANameMission } from './m1-bind-a-name'
import { sharedListMission } from './m1-shared-list'
import { rebindVsMutateMission } from './m1-rebind-vs-mutate'
import { swapKeepTheValueMission } from './m1-swap-keep-the-value'
import { heavyParcelsMission, heavyParcelsRepairMission } from './m3-heavy-parcels'
import { chargeTotalMission } from './m3-charge-total'
import { strongestBatteryMission } from './m3-strongest-battery'

/** Unvalidated definitions, in the order a student meets them. */
export const rawMissions: unknown[] = [
  bindANameMission,
  sharedListMission,
  rebindVsMutateMission,
  swapKeepTheValueMission,
  heavyParcelsMission,
  heavyParcelsRepairMission,
  chargeTotalMission,
  strongestBatteryMission,
]

export const missions: Mission[] = rawMissions.map(parseMission)

export function missionById(id: string): Mission | undefined {
  return missions.find((m) => m.id === id)
}
