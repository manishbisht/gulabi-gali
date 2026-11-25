import type { DistrictId } from '../net/protocol'
import { mapItems, type MapItemKind } from '../world/cityMap'
import { DISTRICTS, loadDef } from '../world/district'
import { linkId } from '../world/placeLink'

/** A place a link can name: one row of a district's map, under the id its link uses. */
export interface SharedPlace {
  district: DistrictId
  /** As in the link (`linkId`): a landmark's id, `metro`, `viewpoint`, `bench-<n>`, `tapri-<n>`, `poster-<n>`. */
  place: string
  kind: MapItemKind
  name: { hi: string; en: string }
}

/**
 * Every place "Bulao" or the map can send a link to, in every district: read from the same definitions and the
 * same `mapItems` the map shows, so a district or landmark added there gets its preview page with no other
 * change. Only the definitions are loaded, nothing is built.
 */
export async function sharedPlaces(): Promise<SharedPlace[]> {
  const places: SharedPlace[] = []
  for (const district of DISTRICTS) {
    const def = await loadDef(district)
    for (const item of mapItems(def, []))
      places.push({ district, place: linkId(item), kind: item.kind, name: item.name })
  }
  return places
}
