import { useCallback, useMemo, useRef, useState } from 'react'
import type { Stage } from '../engine/stage'
import type { Controls } from '../player/controls'
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
 * Gali cricket's UI state: the pitch in reach, and the game while one is up. `hooks` go to the session (it
 * calls `play` for E by the pitch); App binds the session, stage and controls once they are up, and a game
 * ends with them, or with the district that has the pitch.
 */
export function useCricket() {
  const [near, setNear] = useState(false)
  const [game, setGame] = useState<CricketGame | null>(null)
  const bound = useRef<CricketBound | null>(null)
  /**
   * Set by App while the street is not the player's to play on: photo mode, a ride, a sheet or the map over
   * it, a kite fight. The session's E knows nothing of those, so `play` asks here.
   */
  const blockedRef = useRef(false)
  const play = useCallback(() => {
    const b = bound.current
    const pitch = b?.session.district()?.def.cricket
    if (b && pitch && !blockedRef.current)
      setGame((was) => was ?? { pitch, stage: b.stage, controls: b.controls })
  }, [])
  const stop = useCallback(() => setGame(null), [])
  const hooks = useMemo<CricketHooks>(
    () => ({
      near: setNear,
      play,
      left() {
        setNear(false)
        setGame(null)
      },
    }),
    [play],
  )
  const bind = useCallback((b: CricketBound | null) => {
    bound.current = b
    if (!b) setGame(null)
  }, [])
  /** The player's own body is not drawn while the view is the batter's. */
  const hide = useCallback((hidden: boolean) => bound.current?.session.player()?.setHidden(hidden), [])
  return { near, game, hooks, bind, play, stop, hide, blockedRef }
}
