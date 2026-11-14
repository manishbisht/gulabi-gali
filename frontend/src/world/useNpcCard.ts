import { useCallback, useRef, useState } from 'react'
import type { Npcs } from './npcs'
import type { NpcDef, Vec2 } from './types'

/** E opens the nearest character within this many metres. */
const TALK_RANGE = 3
/** Walk further than this from the open card's character and it closes itself. */
const WALK_AWAY = 8

/** Which character's card is open: at most one, and React hears only when it changes. */
export function useNpcCard() {
  const [npc, setNpc] = useState<NpcDef | null>(null)
  const openRef = useRef<NpcDef | null>(null)

  const open = useCallback((next: NpcDef | null) => {
    if (openRef.current?.id === next?.id) return
    openRef.current = next
    setNpc(next)
  }, [])
  const close = useCallback(() => open(null), [open])

  /**
   * Call every frame. E closes an open card, else opens the nearest character in reach, unless a
   * landmark card is up (it takes the key). Walking away closes the card.
   */
  const step = useCallback(
    (pos: Vec2, npcs: Npcs, pressed: boolean, landmarkNear: boolean) => {
      const current = openRef.current
      if (current) {
        const body = npcs.entries.find((e) => e.def.id === current.id)?.body
        if (!body || Math.hypot(body.position.x - pos.x, body.position.z - pos.z) > WALK_AWAY) return close()
      }
      if (!pressed) return
      if (current) close()
      else if (!landmarkNear) open(npcs.nearest(pos, TALK_RANGE))
    },
    [open, close],
  )

  return { npc, open, close, isOpen: useCallback(() => openRef.current !== null, []), step }
}
