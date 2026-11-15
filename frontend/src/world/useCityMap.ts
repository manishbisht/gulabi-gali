import { useCallback, useEffect, useRef, useState } from 'react'
import type { Stage } from '../engine/stage'
import type { MapView } from '../ui/CityMap'
import { mapPeople, type MapTarget } from './cityMap'
import type { CitySession } from './session'
import type { DistrictDef } from './types'
import { createWayfinder, type Wayfinder, type WayReading } from './wayfinder'

type MapSession = Pick<CitySession, 'player' | 'people' | 'onEnter' | 'onLeave' | 'onFrame'>

/**
 * The city map and its compass: whether the map is open (M or the HUD's "Naksha" opens it), the district it
 * draws, and the target picked on it. App binds the session and stage once they are up; `keys` says whether M
 * may open the map now.
 */
export function useCityMap(keys: boolean) {
  const [open, setOpen] = useState(false)
  const [def, setDef] = useState<DistrictDef | null>(null)
  const [target, setTarget] = useState<MapTarget | null>(null)
  const session = useRef<MapSession | null>(null)
  const way = useRef<Wayfinder | null>(null)
  const offs = useRef<(() => void)[]>([])

  const bind = useCallback((b: { session: MapSession; stage: Pick<Stage, 'scene' | 'camera'> } | null) => {
    for (const off of offs.current) off()
    offs.current = []
    way.current?.dispose()
    way.current = null
    session.current = b?.session ?? null
    // a stage that goes takes its district, its pillar and its target with it
    setDef(null)
    setTarget(null)
    setOpen(false)
    if (!b) return
    way.current = createWayfinder({
      scene: b.stage.scene,
      camera: b.stage.camera,
      session: b.session,
      onCleared: () => setTarget(null),
    })
    offs.current = [
      b.session.onEnter((d) => setDef(d.def)),
      // the map shows the district the player is in; a new one starts closed, with no target
      b.session.onLeave(() => {
        setDef(null)
        setOpen(false)
      }),
    ]
  }, [])
  const pick = useCallback((t: MapTarget) => {
    way.current?.set(t)
    setTarget(t)
    setOpen(false) // off to walk there
  }, [])
  const clear = useCallback(() => {
    way.current?.clear()
    setTarget(null)
  }, [])
  const watch = useCallback((cb: (r: WayReading | null) => void) => way.current?.watch(cb) ?? (() => {}), [])
  /** Where you are and face, and the people the street draws now: nothing more (see `mapPeople`). */
  const read = useCallback((): MapView | null => {
    const s = session.current
    const p = s?.player()
    return s && p ? { you: p.position(), heading: p.heading(), people: mapPeople(s.people()) } : null
  }, [])
  const toggle = useCallback(() => setOpen((was) => !was), [])
  const close = useCallback(() => setOpen(false), [])

  // M opens and closes the map, unless a text field has the keys
  const can = keys && def !== null
  useEffect(() => {
    if (!can) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyM' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, select, [contenteditable]')) return
      setOpen((was) => !was)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [can])

  return { open: open && can, def: can ? def : null, target, bind, pick, clear, watch, read, toggle, close }
}
