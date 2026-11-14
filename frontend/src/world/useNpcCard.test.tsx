// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { CAST } from './cast'
import type { Npcs } from './npcs'
import type { NpcDef } from './types'
import { useNpcCard } from './useNpcCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const def: NpcDef = { ...CAST.raju, route: [{ x: 0, z: 0 }], speed: 1 }
const npcs = {
  entries: [{ def, body: { position: { x: 0, z: 0 } } }],
  nearest: () => def,
} as unknown as Npcs

function mount() {
  const out = {} as ReturnType<typeof useNpcCard>
  function Probe() {
    Object.assign(out, useNpcCard())
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<Probe />))
  return out
}

it('ignores a tap on a character while a landmark card is up', () => {
  const card = mount()
  act(() => card.tap(def, true))
  expect(card.npc).toBeNull()
  act(() => card.tap(def, false))
  expect(card.npc?.id).toBe('raju')
})

it('closes the character card when the player steps into a landmark ring, and E then stamps', () => {
  const card = mount()
  act(() => card.tap(def, false))
  expect(card.npc).not.toBeNull()
  act(() => card.step({ x: 1, z: 0 }, npcs, false, true))
  expect(card.npc).toBeNull()
  act(() => card.step({ x: 1, z: 0 }, npcs, true, true)) // E with a landmark near never opens a character
  expect(card.npc).toBeNull()
})
