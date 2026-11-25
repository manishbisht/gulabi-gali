import { useCallback, useRef, useState } from 'react'
import type { Stage } from '../engine/stage'
import type { Shows } from '../shows/stage'
import { storage } from '../storage'
import { installTestHooks } from '../testHooks'
import type { District } from './district'
import type { CitySession } from './session'
import { SHOW_KINDS, showsOf } from './shows'
import type { ShowKind } from './types'

/** The show kinds whose card this visitor has already been shown (a JSON list). Local only. */
const SEEN_KEY = 'gg-shows-seen'

const seen = (): ShowKind[] => {
  const raw = storage.getJSON<unknown>(SEEN_KEY, [])
  return Array.isArray(raw) ? SHOW_KINDS.filter((k) => raw.includes(k)) : []
}

type ShowSession = Pick<CitySession, 'district' | 'onEnter' | 'onLeave' | 'onFrame'>
interface Bound {
  session: ShowSession
  stage: Pick<Stage, 'quality'>
  /** The live city's clock and snapshot: the evening's show keeps their sunset. */
  live: { now(): Date; current(): { sunset: string } }
}

/**
 * The street shows (see shows.ts), for React: which show's clap is on offer now, and which show's card is up
 * (once per kind, the first time this visitor walks up to one). App binds the session and stage once they are up;
 * the figures, tunes and performance are a chunk fetched on entering a district that has a show, and a district
 * without one costs nothing.
 */
export function useShows() {
  /** The show "Taali bajao" is for: one is playing, or has just ended. */
  const [clapFor, setClapFor] = useState<ShowKind | null>(null)
  const [card, setCard] = useState<ShowKind | null>(null)
  const shows = useRef<Shows | null>(null)
  const offs = useRef<(() => void)[]>([])

  const bind = useCallback((b: Bound | null) => {
    for (const off of offs.current) off()
    offs.current = []
    if (!b) return
    /** Counts districts entered and left, so a chunk that arrives late knows its district has gone. */
    let visit = 0
    const leave = () => {
      visit++
      shows.current?.dispose()
      shows.current = null
      setClapFor(null)
      setCard(null)
    }
    const enter = (district: District) => {
      const mine = ++visit
      if (showsOf(district.def).length === 0) return
      void import('../shows/stage')
        .then(({ createShows }) => {
          if (mine !== visit) return
          shows.current = createShows({
            scene: district.root,
            def: district.def,
            colliders: district.colliders,
            quality: () => b.stage.quality,
            now: b.live.now,
            sunset: () => b.live.current().sunset,
            hooks: {
              began(kind) {
                const had = seen()
                if (had.includes(kind)) return
                storage.set(SEEN_KEY, JSON.stringify([...had, kind]))
                setCard(kind)
              },
              clap: setClapFor,
              left: (kind) => setCard((was) => (was === kind ? null : was)),
            },
          })
        })
        // the chunk did not arrive (offline, a deploy in between): the street is whole without its show
        .catch(() => {})
    }
    offs.current = [
      b.session.onEnter(enter),
      b.session.onLeave(leave),
      b.session.onFrame((dt, pos) => shows.current?.update(dt, pos)),
      leave,
    ]
    const here = b.session.district()
    if (here) enter(here)
    installTestHooks({
      shows: () => shows.current?.list() ?? [],
      showSkip: (seconds) => shows.current?.skip(seconds),
    })
  }, [])

  /** "Taali bajao": a clap, and the performers bow. */
  const clap = useCallback(() => void shows.current?.clap(), [])
  const closeCard = useCallback(() => setCard(null), [])

  return { clapFor, card, bind, clap, closeCard }
}
