import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Lang } from '../i18n/strings'
import type { CitySession } from './session'
import type { TaxiHooks } from './taxi'

const NOTICE_MS = 3500

/** What the taxi UI asks of the city session. */
export type TaxiActions = Pick<CitySession, 'taxi' | 'skipTaxi' | 'district'>

/** A place "Le chalo" can go: a landmark of the district. */
export interface TaxiStop {
  id: string
  name: Record<Lang, string>
}

/**
 * The auto-taxi's UI state: an auto at its stand in reach, the "Le chalo" list, the ride on screen (and where
 * to), the dark of getting in and out, and the passing notice when the server says no. `hooks` goes to the
 * session; App binds the session once it is up.
 */
export function useTaxi() {
  const [near, setNear] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [stops, setStops] = useState<TaxiStop[]>([])
  const [riding, setRiding] = useState(false)
  const [place, setPlace] = useState<Record<Lang, string> | null>(null)
  const [dark, setDark] = useState(false)
  const [refused, setRefused] = useState(false)
  const actions = useRef<TaxiActions | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const hooks = useMemo<TaxiHooks>(
    () => ({
      near(on) {
        setNear(on)
        if (!on) setSheet(false) // walked off (or got in): the list goes
      },
      riding: setRiding,
      dark: setDark,
      refused() {
        clearTimeout(timer.current)
        setRefused(true)
        timer.current = setTimeout(() => setRefused(false), NOTICE_MS)
      },
    }),
    [],
  )

  const bind = useCallback((a: TaxiActions | null) => void (actions.current = a), [])
  const open = useCallback(() => {
    const def = actions.current?.district()?.def
    if (!def) return
    setStops(def.landmarks.map((l) => ({ id: l.id, name: l.name })))
    setSheet(true)
  }, [])
  const close = useCallback(() => setSheet(false), [])
  const go = useCallback((stop: TaxiStop) => {
    setSheet(false)
    setPlace(stop.name)
    actions.current?.taxi(stop.id)
  }, [])
  const skip = useCallback(() => actions.current?.skipTaxi(), [])

  return {
    near,
    sheetOpen: sheet && near,
    stops,
    riding,
    place,
    dark,
    refused,
    hooks,
    bind,
    open,
    close,
    go,
    skip,
  }
}
