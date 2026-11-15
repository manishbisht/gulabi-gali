import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PosterView } from '../net/protocol'
import type { PosterHooks, Wall } from './posters'

/** What the poster UI asks of the city session's walls. */
export interface PosterActions {
  /** A poster this page just pinned. */
  pinned(p: PosterView): void
  /** One of this page's own came down. */
  unpinned(id: string): void
  /** Fetch every wall again (after a block). */
  refreshPosters(): void
}

/** The session's side: what the walls tell React, plus E by a wall. */
export interface SessionPosterHooks extends PosterHooks {
  /** E by a wall: open the composer. */
  compose(): void
  /** The composer or a poster's card is up: E leaves the wall alone. */
  isOpen(): boolean
  /** The district's walls are gone (travel, leaving): nothing about them stays up. */
  left(): void
}

/**
 * The poster walls' UI state: the wall in reach (and whether it is empty), the composer, and the card of a
 * tapped poster. `hooks` goes to the session; App binds the session's actions once it is up.
 */
export function usePosters() {
  const [near, setNear] = useState<{ wall: Wall; empty: boolean } | null>(null)
  /** The tapped poster, and whether it has since come off the wall (the card then closes once idle). */
  const [open, setOpen] = useState<{ poster: PosterView; gone: boolean } | null>(null)
  const [composing, setComposing] = useState(false)
  const shown = useRef(false)
  const opened = useRef(open)
  useEffect(() => {
    shown.current = open !== null || composing
    opened.current = open
  }, [open, composing])
  const actions = useRef<PosterActions | null>(null)

  const hooks = useMemo<SessionPosterHooks>(
    () => ({
      near(wall, empty) {
        setNear(wall ? { wall, empty } : null)
        // the composer belongs to the wall it was opened at
        if (!wall) setComposing(false)
      },
      tap(p) {
        setComposing(false)
        setOpen({ poster: p, gone: false })
      },
      gone(ids) {
        setOpen((was) => (was && !was.gone && ids.includes(was.poster.id) ? { ...was, gone: true } : was))
      },
      compose() {
        setOpen(null)
        setComposing(true)
      },
      isOpen: () => shown.current,
      left() {
        setNear(null)
        setOpen(null)
        setComposing(false)
      },
    }),
    [],
  )

  const bind = useCallback((a: PosterActions | null) => void (actions.current = a), [])
  const compose = useCallback(() => hooks.compose(), [hooks])
  const closeComposer = useCallback(() => setComposing(false), [])
  const close = useCallback(() => setOpen(null), [])
  const pinned = useCallback((p: PosterView) => {
    actions.current?.pinned(p)
    setComposing(false)
  }, [])
  const takenDown = useCallback((id: string) => {
    actions.current?.unpinned(id)
    setOpen(null)
  }, [])
  /** After blocking a poster's owner: every wall is fetched again, and theirs are gone. */
  const blocked = useCallback(() => actions.current?.refreshPosters(), [])
  /**
   * "Main aaunga" said or taken back from the open card: the wall prints the new count. Never for a poster that
   * came off the wall meanwhile (a block, a take-down): that must not go back up.
   */
  const changed = useCallback((p: PosterView) => {
    const was = opened.current
    if (!was || was.gone || was.poster.id !== p.id) return
    actions.current?.pinned(p)
    setOpen({ poster: p, gone: false })
  }, [])

  return {
    near,
    open,
    composing,
    hooks,
    bind,
    compose,
    closeComposer,
    close,
    pinned,
    takenDown,
    blocked,
    changed,
  }
}
