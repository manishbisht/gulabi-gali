import { useCallback, useRef, useState } from 'react'
import type { DistrictId } from '../net/protocol'
import { storage } from '../storage'
import { DISTRICTS } from './district'
import type { Vec2 } from './types'

const KEY = 'gg-district'
/** The metro is in reach this close to a district's `station`, in metres. */
export const STATION_RANGE = 4
/** How long the screen takes to fade to black before the district is swapped; the CSS fade matches. */
export const FADE_MS = 300

/** Where the city reopens: the district last travelled to, or the Walled City. */
export function savedDistrict(): DistrictId {
  const id = storage.get(KEY)
  return DISTRICTS.find((d) => d === id) ?? 'walled-city'
}

/** Disposes the district the player is in, loads `id` and stands them at its station. */
export type Swap = (id: DistrictId) => Promise<void>

/**
 * Metro travel: whether the player stands by the station, the sheet of destinations, and the trip
 * itself (fade to black, swap the district, remember it). App binds the swap once the stage is up.
 */
export function useTravel() {
  const [fading, setFading] = useState(false)
  const [nearStation, setNearStation] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
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

  /** A trip already under way ignores further requests. A failed swap reports itself; nothing is saved. */
  const travelTo = useCallback(
    async (id: DistrictId) => {
      const go = swap.current
      if (busy.current || !go) return
      busy.current = true
      showSheet(false)
      setFading(true)
      try {
        await new Promise((r) => setTimeout(r, FADE_MS))
        await go(id)
        storage.set(KEY, id)
      } catch {
        // the swap has already shown its failure; stay unsaved so a reload opens where it worked
      } finally {
        busy.current = false
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

  return { fading, nearStation, sheetOpen, openSheet, closeSheet, travelTo, trackStation, bind }
}
