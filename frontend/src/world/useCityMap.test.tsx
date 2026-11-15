// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { afterEach, expect, it } from 'vitest'
import walledCity from './districts/walledCity'
import type { District } from './district'
import { useCityMap } from './useCityMap'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ''
})

/** Mounts the hook with `keys` (M allowed at all), in a district. */
async function mount() {
  let map!: ReturnType<typeof useCityMap>
  let enter: (d: District) => void = () => {}
  function Probe({ keys }: { keys: boolean }) {
    map = useCityMap(keys)
    return null
  }
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const render = (keys: boolean) => act(async () => root.render(<Probe keys={keys} />))
  await render(true)
  await act(async () =>
    map.bind({
      session: {
        player: () => null,
        people: () => [],
        onEnter: (cb) => ((enter = cb), () => {}),
        onLeave: () => () => {},
        onFrame: () => () => {},
      },
      stage: { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera() },
    }),
  )
  await act(async () => enter({ def: walledCity } as District))
  const press = () =>
    act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm' })))
  return { map: () => map, render, press }
}

it('M opens and closes the map', async () => {
  const { map, press } = await mount()
  await press()
  expect(map().open).toBe(true)
  await press()
  expect(map().open).toBe(false)
})

it('M does not open the map over another dialog, or in photo mode (keys off)', async () => {
  const { map, render, press } = await mount()
  map().blockedRef.current = true // Connections, the profile, a card... is up
  await press()
  expect(map().open).toBe(false)
  map().blockedRef.current = false
  await render(false) // photo mode, a metro ride or a kite fight
  await press()
  expect(map().open).toBe(false)
  expect(map().def).toBeNull() // and the HUD offers no map either
})
