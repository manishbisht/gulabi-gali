import { useCallback, useMemo, useRef, useState } from 'react'
import { tastedDishes, type Serving } from './swaad'
import type { SwaadHooks } from './swaadSystem'

/** What the tasting UI asks of the city session. */
export interface SwaadActions {
  taste(): void
}

/**
 * Jaipur ka Swaad's UI state: the serving stall in reach, the card of the dish just tasted (it closes on
 * walking out of the stall's reach), and the list so far. `hooks` goes to the session; App binds the session's
 * action once it is up.
 */
export function useSwaad() {
  const [near, setNear] = useState<Serving | null>(null)
  const [card, setCard] = useState<Serving | null>(null)
  const [have, setHave] = useState(tastedDishes)
  const actions = useRef<SwaadActions | null>(null)

  const hooks = useMemo<SwaadHooks>(
    () => ({
      near(serving) {
        setNear(serving)
        // the card belongs to the stall it was served at: another stall, or none, puts it away
        setCard((c) => (c && c === serving ? c : null))
      },
      tasted(serving, first) {
        setCard(serving)
        if (first) setHave(tastedDishes())
      },
    }),
    [],
  )

  const bind = useCallback((a: SwaadActions | null) => void (actions.current = a), [])
  const taste = useCallback(() => actions.current?.taste(), [])
  const close = useCallback(() => setCard(null), [])

  return { near, card, have, hooks, bind, taste, close }
}
