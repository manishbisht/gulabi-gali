import { useCallback, useMemo, useRef, useState } from 'react'
import { emitDeed } from './deeds'
import type { RoofHooks } from './rooftop'

/** What the rooftop button asks of the city session. */
export interface RoofActions {
  climb(): void
}

/** The last arrival, for the polite announcement: up on the roof, or back down on the street. */
export type RoofNotice = 'up' | 'down' | null

/**
 * The rooftop viewpoint's UI state: its stair in reach, being up on the roof, the fade between, and the last
 * arrival to announce. `hooks` go to the session; App binds the session's `climb` once it is up.
 */
export function useRooftop() {
  const [near, setNear] = useState(false)
  const [up, setUp] = useState(false)
  const [fading, setFading] = useState(false)
  const [notice, setNotice] = useState<RoofNotice>(null)
  const actions = useRef<RoofActions | null>(null)
  const hooks = useMemo<RoofHooks>(
    () => ({
      near: setNear,
      up(on) {
        setUp(on)
        if (on) emitDeed({ kind: 'roof' })
        setNotice(on ? 'up' : 'down')
      },
      fade: setFading,
    }),
    [],
  )
  const bind = useCallback((a: RoofActions | null) => void (actions.current = a), [])
  const climb = useCallback(() => actions.current?.climb(), [])
  return { near, up, fading, notice, hooks, bind, climb }
}
