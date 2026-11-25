import { useCallback, useMemo, useRef, useState } from 'react'
import type { Stage } from '../engine/stage'
import type { Controls } from '../player/controls'
import { loadCricket } from '../ui/warmCricket'
import type { CricketHooks } from './cricketPitch'
import type { PitchDef } from './types'

/** What the game borrows while it is up: the city session (for the pitch and the player), its stage and controls. */
export interface CricketBound {
  session: {
    district(): { def: { cricket?: PitchDef } } | null
    player(): { setHidden(hidden: boolean): void } | null
  }
  stage: Stage
  controls: Controls
}

/** A game of gali cricket in progress: the pitch it is played on, and the stage and controls it borrows. */
export interface CricketGame {
  pitch: PitchDef
  stage: Stage
  controls: Controls
}

/**
 * Gali cricket's UI state: the pitch in reach, the game's code arriving (`loading`), and the game while one is
 * up. `hooks` go to the session (it calls `play` for E by the pitch); App binds the session, stage and controls
 * once they are up, and a game ends with them, or with the district that has the pitch.
 *
 * The game is a lazy chunk. `play` fetches it first (`load`) and only then opens the game, and only if the
 * player is still by the pitch with the street theirs: someone who walked off, or opened a sheet, while a slow
 * network brought the code is not pulled into a game they have left behind.
 */
export function useCricket(load: () => Promise<unknown> = loadCricket) {
  const [near, setNear] = useState(false)
  const [loading, setLoading] = useState(false)
  const [game, setGame] = useState<CricketGame | null>(null)
  const bound = useRef<CricketBound | null>(null)
  const nearRef = useRef(false)
  /** The fetch now under way, if any: the city or the district going makes its answer stale. */
  const asked = useRef(0)
  const busy = useRef(false)
  /**
   * Set by App while the street is not the player's to play on: photo mode, a ride, a sheet or the map over
   * it, a kite fight. The session's E knows nothing of those, so `play` asks here.
   */
  const blockedRef = useRef(false)
  const play = useCallback(() => {
    const b = bound.current
    const pitch = b?.session.district()?.def.cricket
    if (!b || !pitch || blockedRef.current || busy.current) return
    const mine = ++asked.current
    busy.current = true
    setLoading(true)
    const open = () => {
      if (asked.current !== mine) return // the city or the district went meanwhile
      busy.current = false
      setLoading(false)
      // still by the pitch, the street still theirs? (a failed fetch opens too: the game's place says so)
      if (bound.current !== b || !nearRef.current || blockedRef.current) return
      setGame((was) => was ?? { pitch, stage: b.stage, controls: b.controls })
    }
    void load().then(open, open)
  }, [load])
  const stop = useCallback(() => setGame(null), [])
  /** Whatever was being fetched or played is over. */
  const drop = useCallback(() => {
    asked.current++
    busy.current = false
    setLoading(false)
    setGame(null)
  }, [])
  const hooks = useMemo<CricketHooks>(
    () => ({
      near(on) {
        nearRef.current = on
        setNear(on)
      },
      play,
      left() {
        nearRef.current = false
        setNear(false)
        drop()
      },
    }),
    [play, drop],
  )
  const bind = useCallback(
    (b: CricketBound | null) => {
      bound.current = b
      if (!b) drop()
    },
    [drop],
  )
  /** The player's own body is not drawn while the view is the batter's. */
  const hide = useCallback((hidden: boolean) => bound.current?.session.player()?.setHidden(hidden), [])
  return { near, loading, game, hooks, bind, play, stop, hide, blockedRef }
}
