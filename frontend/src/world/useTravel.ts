import { useCallback, useEffect, useRef, useState } from 'react'
import type { DistrictId } from '../net/protocol'
import { storage } from '../storage'
import { DISTRICTS } from './district'
import { playRide, rideBy } from './metroRide'
import { chime } from '../audio/horn'
import { emitDeed } from './deeds'
import type { Vec2 } from './types'

const KEY = 'gg-district'
/** The metro is in reach this close to a district's `station`, in metres. */
export const STATION_RANGE = 4
/** How long the screen takes to fade to black before the district is swapped; the CSS fade matches. */
export const FADE_MS = 300
/** How long the "couldn't get there" message stays up. */
const FAILED_MS = 4000

/** Where the city reopens: the district last travelled to, or the Walled City. */
export function savedDistrict(): DistrictId {
  const id = storage.get(KEY)
  return DISTRICTS.find((d) => d === id) ?? 'walled-city'
}

/** Where the city reopens from now on (a link to a place in another district: see `placeLink`). */
export const rememberDistrict = (id: DistrictId) => storage.set(KEY, id)

/**
 * Loads `id` and, once it is in, swaps it for the district the player is in, standing them at its
 * station (or at `place` in it: see `CitySession.travelTo`). Rejects, with the old district still running, if
 * `id` cannot be loaded.
 */
export type Swap = (id: DistrictId, signal?: AbortSignal, place?: string) => Promise<void>

/**
 * Metro travel: whether the player stands by the station, the sheet of destinations, and the trip
 * itself (fade to black, swap the district, remember it). App binds the swap once the stage is up.
 */
export function useTravel() {
  const [fading, setFading] = useState(false)
  const [nearStation, setNearStation] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  /** Where the last trip was headed, if its district could not be loaded. Clears itself. */
  const [failed, setFailed] = useState<DistrictId | null>(null)
  /** The ride on screen, if any; `waiting` once it has run out before the district has arrived. */
  const [ride, setRide] = useState<{ from: DistrictId; to: DistrictId; waiting: boolean } | null>(null)
  const failedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const skipRef = useRef<() => void>(() => {})
  const abort = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      clearTimeout(failedTimer.current)
      skipRef.current() // the ride's own timer goes with the hook
    },
    [],
  )
  const swap = useRef<Swap | null>(null)
  const busy = useRef(false)
  const nearRef = useRef(false)
  const sheetRef = useRef(false)

  const showSheet = useCallback((open: boolean) => {
    if (sheetRef.current === open) return
    sheetRef.current = open
    setSheetOpen(open)
  }, [])
  const openSheet = useCallback(() => showSheet(true), [showSheet])
  const closeSheet = useCallback(() => showSheet(false), [showSheet])

  const bind = useCallback((fn: Swap | null) => void (swap.current = fn), [])

  /**
   * A trip already under way ignores further requests. Only a trip that arrives is remembered: not one
   * whose district failed to load (that raises `failed`), nor one cut short by the city closing. Resolves true
   * once it has arrived, false for any trip that did not (ignored, failed, cancelled, the city closed).
   */
  const travelTo = useCallback(
    async (id: DistrictId, from: DistrictId = savedDistrict(), place?: string) => {
      const go = swap.current
      if (busy.current || !go) return false
      busy.current = true
      showSheet(false)
      setFading(true)
      setFailed(null)
      const bound = () => swap.current === go
      try {
        await new Promise((r) => setTimeout(r, FADE_MS))
        if (!bound()) return false
        // the ride plays while the district loads; a failed load cuts the ride short
        const coach = playRide(from, id)
        skipRef.current = coach.skip
        setRide({ from, to: id, waiting: false })
        const trip = (abort.current = new AbortController())
        const loading = place ? go(id, trip.signal, place) : go(id, trip.signal)
        // remembered the moment the district is in, so a reload mid-ride reopens there
        loading.then(() => bound() && !trip.signal.aborted && storage.set(KEY, id), coach.skip)
        await coach.done
        if (!bound()) return false
        let arrived = false
        let lost = false
        void loading.then(
          () => (arrived = true),
          () => (lost = true),
        )
        // out of ride before the district is in: keep the coach, with a line saying so (not for a load that
        // already failed: that goes straight to the failure, with no waiting line flashed first)
        await Promise.resolve()
        if (!arrived && !lost) setRide({ from, to: id, waiting: true })
        // "go back" aborts: the district that arrives late is thrown away and the failure path runs
        await Promise.race([
          loading,
          new Promise<never>((_, no) =>
            trip.signal.addEventListener('abort', () => no(new Error('cancelled')), { once: true }),
          ),
        ])
        if (!bound()) return false
        chime(rideBy(from, id))
        emitDeed({ kind: 'ride' })
        return true
      } catch {
        if (!bound()) return false
        setFailed(id)
        clearTimeout(failedTimer.current)
        failedTimer.current = setTimeout(() => setFailed(null), FAILED_MS)
        return false
      } finally {
        busy.current = false
        skipRef.current = () => {}
        abort.current = null
        setRide(null)
        setFading(false)
      }
    },
    [showSheet],
  )

  /**
   * Call every frame. Returns whether the metro is in reach. E (`pressed`) opens or closes the sheet
   * there; walking out of reach closes it. React hears only about changes.
   */
  const trackStation = useCallback(
    (pos: Vec2, station: Vec2, pressed: boolean) => {
      const near = Math.hypot(pos.x - station.x, pos.z - station.z) <= STATION_RANGE
      if (near !== nearRef.current) {
        nearRef.current = near
        setNearStation(near)
      }
      if (!near) showSheet(false)
      else if (pressed) showSheet(!sheetRef.current)
      return near
    },
    [showSheet],
  )

  const skipRide = useCallback(() => skipRef.current(), [])
  const cancelRide = useCallback(() => {
    abort.current?.abort()
    skipRef.current()
  }, [])

  return {
    fading,
    failed,
    ride,
    skipRide,
    cancelRide,
    nearStation,
    sheetOpen,
    openSheet,
    closeSheet,
    travelTo,
    trackStation,
    bind,
  }
}
