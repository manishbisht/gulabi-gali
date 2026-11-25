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
  /** The card as the session reads it, between renders. */
  const openRef = useRef<Serving | null>(null)
  const show = useCallback((next: Serving | null) => {
    openRef.current = next
    setCard(next)
  }, [])

  const hooks = useMemo<SwaadHooks>(
    () => ({
      near(serving) {
        setNear(serving)
        // the card belongs to the stall it was served at: another stall, or none, puts it away
        if (openRef.current !== serving) show(null)
      },
      tasted(serving, first) {
        show(serving)
        if (first) setHave(tastedDishes())
      },
      isOpen: () => openRef.current !== null,
      close: () => show(null),
    }),
    [show],
  )

  const bind = useCallback((a: SwaadActions | null) => void (actions.current = a), [])
  const taste = useCallback(() => actions.current?.taste(), [])
  const close = useCallback(() => show(null), [show])

  return { near, card, have, hooks, bind, taste, close }
}
