import type { DistrictId } from '../net/protocol'

/** How long the ride lasts if nobody taps: between 2.5 s and the 5 s ceiling. */
export const RIDE_MS = 4000

/**
 * The stop announced for each district. Badi Chaupar and Sindhi Camp are real Jaipur Pink Line stations
 * (Sindhi Camp is the nearest to MI Road). The Pink Line has no station by the University or in Malviya
 * Nagar, so those two are made-up stops.
 */
export const METRO_STATIONS: Record<DistrictId, { hi: string; en: string }> = {
  'walled-city': { hi: 'Badi Chaupar', en: 'Badi Chaupar' },
  'mi-road': { hi: 'Sindhi Camp', en: 'Sindhi Camp' },
  university: { hi: 'University Gate', en: 'University Gate' }, // fictional
  'malviya-nagar': { hi: 'Malviya Nagar', en: 'Malviya Nagar' }, // fictional
}

export interface Ride {
  /** Resolves when the ride has run its time or been skipped. */
  done: Promise<void>
  /** Cuts the rest of the ride short; harmless after it ends. */
  skip(): void
}

/**
 * The clock of a Pink Line ride between two districts. It only keeps time: the coach itself is the
 * MetroRide overlay, and the next district loads alongside, in the session.
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
