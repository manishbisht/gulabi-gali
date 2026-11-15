import { useCallback, useMemo, useRef, useState } from 'react'
import type { RoofHooks } from './rooftop'

/** What the rooftop button asks of the city session. */
export interface RoofActions {
  climb(): void
}

/**
 * The rooftop viewpoint's UI state: its stair in reach, being up on the roof, and the fade between. `hooks` go
 * to the session; App binds the session's `climb` once it is up.
 */
export function useRooftop() {
  const [near, setNear] = useState(false)
  const [up, setUp] = useState(false)
  const [fading, setFading] = useState(false)
  const actions = useRef<RoofActions | null>(null)
  const hooks = useMemo<RoofHooks>(() => ({ near: setNear, up: setUp, fade: setFading }), [])
  const bind = useCallback((a: RoofActions | null) => void (actions.current = a), [])
  const climb = useCallback(() => actions.current?.climb(), [])
  return { near, up, fading, hooks, bind, climb }
}
