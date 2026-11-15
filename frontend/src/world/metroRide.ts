import { t, type Lang } from '../i18n/strings'
import type { DistrictId } from '../net/protocol'

/** How long the ride lasts if nobody taps: between 2.5 s and the 5 s ceiling. */
export const RIDE_MS = 4000

/**
 * The stop announced for each district. Badi Chaupar and Sindhi Camp are real Jaipur Pink Line stations
 * (Sindhi Camp is the nearest to MI Road). The Pink Line has no station by the University or in Malviya
 * Nagar, so those two are made-up stops. Amer has no metro at all: its stop is the bus stand by the lake.
 */
export const METRO_STATIONS: Record<DistrictId, { hi: string; en: string }> = {
  'walled-city': { hi: 'Badi Chaupar', en: 'Badi Chaupar' },
  'mi-road': { hi: 'Sindhi Camp', en: 'Sindhi Camp' },
  university: { hi: 'University Gate', en: 'University Gate' }, // fictional
  'malviya-nagar': { hi: 'Malviya Nagar', en: 'Malviya Nagar' }, // fictional
  amer: { hi: 'Amer', en: 'Amer' }, // the bus stand
}

/** The districts the metro does not reach: a bus runs there instead, from every station (and back). */
const BUS_ONLY: readonly DistrictId[] = ['amer']

/** Whether `id` is reached by bus, not the metro: its stop is a bus stand, not a metro entrance. */
export const byBus = (id: DistrictId): boolean => BUS_ONLY.includes(id)

/** What a district's stop is called on its map and signposts: the metro station, or Amer's bus stand. */
export const stopName = (id: DistrictId): Record<Lang, string> => {
  const key = byBus(id) ? 'mapBus' : 'mapMetro'
  return { hi: t(key, 'hi'), en: t(key, 'en') }
}

/** How a trip between two districts goes: by bus when either end has no metro, else on the Pink Line. */
export const rideBy = (from: DistrictId, to: DistrictId): 'metro' | 'bus' =>
  byBus(from) || byBus(to) ? 'bus' : 'metro'

export interface Ride {
  /** Resolves when the ride has run its time or been skipped. */
  done: Promise<void>
  /** Cuts the rest of the ride short; harmless after it ends. */
  skip(): void
}

/**
 * The clock of a ride between two districts (the Pink Line, or the bus to Amer). It only keeps time: the coach
 * itself is the MetroRide overlay, and the next district loads alongside, in the session.
 */
export const playRide: (from: DistrictId, to: DistrictId) => Ride = () => {
  let skip = () => {}
  const done = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, RIDE_MS)
    skip = () => {
      clearTimeout(timer)
      resolve()
    }
  })
  return { done, skip: () => skip() }
}
