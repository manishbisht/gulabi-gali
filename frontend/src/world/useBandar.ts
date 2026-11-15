import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { t, type Lang, type StringKey } from '../i18n/strings'
import { bandarOff, setBandarOff, type BandarEvent, type Gear } from './bandar'

const NOTICE_MS = 4500
const GEAR_KEYS: Record<Gear, StringKey> = {
  safa: 'bandarGearSafa',
  cap: 'bandarGearCap',
  dupatta: 'bandarGearDupatta',
}

/** What the bandar tells React: a passing line, and what the switch says. */
export interface BandarNotice {
  key: StringKey
  gear?: Gear
  place?: { hi: string; en: string }
}

/** The passing line in `lang`. */
export function bandarText(n: BandarNotice, lang: Lang): string {
  const vars: Record<string, string> = {}
  if (n.gear) vars.gear = t(GEAR_KEYS[n.gear], lang)
  if (n.place) vars.place = n.place[lang]
  return t(n.key, lang, vars)
}

/**
 * The Galta bandar's UI state: the passing line and the "Bandar band karo" switch, kept under `gg-no-bandar`
 * (the world reads the same key, through `bandarOff`). `blocked` is a ref the app keeps current: true while a card, sheet, bench,
 * kite game or metro ride is over the street, when the monkey must not start.
 */
export function useBandar() {
  const [off, setOff] = useState(bandarOff)
  const [notice, setNotice] = useState<BandarNotice | null>(null)
  const blockedRef = useRef(false)
  const gear = useRef<Gear | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const toggle = useCallback(() => {
    const next = !bandarOff()
    setBandarOff(next)
    setOff(next)
  }, [])

  const hooks = useMemo(
    () => ({
      blocked: () => blockedRef.current,
      event(e: BandarEvent) {
        let n: BandarNotice | null = null
        if (e.kind === 'snatched') {
          gear.current = e.gear
          n = { key: 'bandarSnatched', gear: e.gear }
        } else if (e.kind === 'caught') n = { key: 'bandarCaught' }
        else if (e.kind === 'dropped') n = { key: 'bandarDropped', gear: e.gear, place: e.landmark }
        else if (e.kind === 'recovered') n = { key: 'bandarBack', gear: gear.current }
        if (!n) return
        clearTimeout(timer.current)
        setNotice(n)
        timer.current = setTimeout(() => setNotice(null), NOTICE_MS)
      },
    }),
    [],
  )
  return { off, toggle, notice, hooks, blockedRef }
}
