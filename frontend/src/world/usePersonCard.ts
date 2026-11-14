import { useCallback, useRef, useState } from 'react'
import type { LivePerson } from '../net/protocol'
import type { People } from './people'
import type { Vec2 } from './types'

/** E opens the nearest person within this many metres. */
const MEET_RANGE = 3

/** The card's person as last seen, and whether they have since left the district. */
export interface OpenPerson {
  person: LivePerson
  gone: boolean
}

/**
 * Which person's card is open: at most one, and React hears only when it changes (a different person,
 * their name or status changing, or them leaving). Cards of landmarks and characters outrank this one:
 * callers pass whether either is up, and the card yields.
 */
export function usePersonCard() {
  const [open, setOpen] = useState<OpenPerson | null>(null)
  const openRef = useRef<OpenPerson | null>(null)
  /** The `ver` of the entry the card last copied from, so a status change is noticed. */
  const verRef = useRef(0)

  const set = useCallback((next: OpenPerson | null) => {
    openRef.current = next
    setOpen(next)
  }, [])
  const close = useCallback(() => set(null), [set])
  /** A tap on a person; does nothing while a landmark or character card is up, or on the open person. */
  const tap = useCallback(
    (person: LivePerson, blocked: boolean) => {
      if (blocked || openRef.current?.person.id === person.id) return
      verRef.current = 0
      set({ person: { ...person }, gone: false })
    },
    [set],
  )

  /**
   * Call every frame. `pressed` is E, already withheld when another card or the metro has it. E closes an
   * open card, else opens the nearest person in reach; a landmark's ring closes the card. An open card
   * follows its person's name and status, and notes when they leave (keeping what it last showed).
   */
  const step = useCallback(
    (pos: Vec2, people: Pick<People, 'entries'>, pressed: boolean, landmarkNear: boolean) => {
      const cur = openRef.current
      if (cur && landmarkNear) return close()
      const entries = people.entries()
      if (cur) {
        const here = entries.find((e) => e.person.id === cur.person.id)
        if (!here) {
          if (!cur.gone) set({ person: cur.person, gone: true })
        } else if (cur.gone || here.ver !== verRef.current) {
          verRef.current = here.ver
          set({ person: { ...here.person }, gone: false })
        }
      }
      if (!pressed) return
      if (cur) return close()
      if (landmarkNear) return
      let best: (typeof entries)[number] | null = null
      let bestD = MEET_RANGE
      for (let i = 0; i < entries.length; i++) {
        const { x, z } = entries[i]!.body.position
        const d = Math.hypot(x - pos.x, z - pos.z)
        if (d <= bestD) {
          best = entries[i]!
          bestD = d
        }
      }
      if (best) {
        verRef.current = best.ver
        set({ person: { ...best.person }, gone: false })
      }
    },
    [set, close],
  )

  return { open, tap, close, isOpen: useCallback(() => openRef.current !== null, []), step }
}
