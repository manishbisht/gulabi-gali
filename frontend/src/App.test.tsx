// @vitest-environment happy-dom
import { act } from 'react'
import * as THREE from 'three'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { storage } from './storage'
import { AuthContext, SIGNED_OUT, type AuthState } from './auth/useAuth'
import { buildAvatar } from './player/avatar'
import type { LiveOptions } from './net/live'
import type { ClientMsg, DistrictId, ServerMsg } from './net/protocol'
import { benchesOf } from './world/benches'
import malviyaNagar from './world/districts/malviyaNagar'
import amer from './world/districts/amer'
import nahargarh from './world/districts/nahargarh'
import galta from './world/districts/galta'
import miRoad from './world/districts/miRoad'
import university from './world/districts/university'
import walledCity from './world/districts/walledCity'
import type { DistrictDef } from './world/types'

const webgl = vi.hoisted(() => ({ available: true }))
vi.mock('./engine/webgl', () => ({ hasWebGL: () => webgl.available }))
/** The fake stage keeps its scene and listeners where the tests can count them. */
const stage = vi.hoisted(() => ({
  fail: false,
  scene: null as unknown as THREE.Scene,
  frames: new Set<(dt: number) => void>(),
  qualities: new Set<(q: number) => void>(),
}))
vi.mock('./engine/stage', () => ({
  createStage: () => {
    if (stage.fail) throw new Error('WebGL 1 is not supported since r163')
    stage.scene = new THREE.Scene()
    stage.frames.clear()
    stage.qualities.clear()
    return {
      quality: 2,
      scene: stage.scene,
      camera: new THREE.PerspectiveCamera(),
      onFrame: (f: (dt: number) => void) => (stage.frames.add(f), () => void stage.frames.delete(f)),
      onQuality: (f: (q: number) => void) => (stage.qualities.add(f), () => void stage.qualities.delete(f)),
      framesSinceRestore: () => 0,
      gameTime: () => 0,
      settle: () => {},
      capture: <T,>(read: (c: HTMLCanvasElement) => T) => read(document.createElement('canvas')),
      dispose: () => {},
    }
  },
}))
/** Photo mode's two ends: the PNG and where it goes (the real ones are tested in ui/photo.test.ts). */
const photo = vi.hoisted(() => ({ shared: [] as Blob[], outcome: 'downloaded' as string }))
vi.mock('./ui/photo', () => ({
  WORDMARK: 'Gulabi Gali · Jaipur',
  capturePhoto: async () => new Blob(['png'], { type: 'image/png' }),
  photoName: () => 'gulabi-gali-x.png',
}))
vi.mock('./ui/share', async (real) => ({
  ...(await real<typeof import('./ui/share')>()),
  shareImage: async (blob: Blob) => {
    photo.shared.push(blob)
    return photo.outcome
  },
}))
/** Every duck the city sounds were told, in order (the real ambience runs; this only listens). */
const ducks = vi.hoisted(() => [] as boolean[])
vi.mock('./audio/ambience', async (importOriginal) => {
  const real = await importOriginal<typeof import('./audio/ambience')>()
  return {
    ...real,
    setAmbienceDuck: (on: boolean) => {
      ducks.push(on)
      real.setAmbienceDuck(on)
    },
  }
})
/** District ids whose chunk "fails to arrive". */
const unreachable = vi.hoisted(() => new Set<string>())
/** While set, no district chunk arrives until it resolves: the loading state held still for a test. */
const hold = vi.hoisted(() => ({ until: null as Promise<void> | null }))
vi.mock('./world/district', async (importOriginal) => {
  const real = await importOriginal<typeof import('./world/district')>()
  return {
    ...real,
    // a chunk takes at least a turn of the event loop to arrive, as it does over the network
    loadDistrict: async (id: DistrictId) => {
      await new Promise((r) => setTimeout(r))
      await hold.until
      if (unreachable.has(id)) throw new Error('chunk failed')
      return real.loadDistrict(id)
    },
  }
})

/** Every district socket the city opens, and what it was opened with; nothing goes over the network. */
const sockets = vi.hoisted(() => [] as { opts: LiveOptions; closed: boolean; sent: ClientMsg[] }[])
vi.mock('./net/live', () => ({
  connectLive: (opts: LiveOptions) => {
    const conn = { opts, closed: false, sent: [] as ClientMsg[] }
    sockets.push(conn)
    return {
      send: (m: ClientMsg) => void (m.t !== 'move' && conn.sent.push(m)),
      close: () => void (conn.closed = true),
      state: () => (conn.closed ? 'closed' : 'open'),
    }
  },
}))
const liveNow = () => sockets.filter((c) => !c.closed)

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  sockets.length = 0
  webgl.available = true
  stage.fail = false
  unreachable.clear()
  hold.until = null
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  storage.clear() // the map too, or a test's language and district leak into the next
  document.body.innerHTML = ''
})

it('shows the intro, then the HUD over a canvas after Padharo, and persists the language', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  let release!: () => void
  hold.until = new Promise<void>((r) => (release = r))
  await act(async () => root.render(<App />))

  const enter = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Padharo!')
  expect(enter).toBeTruthy()
  expect(host.querySelector('canvas')).toBeNull()

  await act(async () => enter!.click())
  expect(host.querySelector('canvas')).not.toBeNull()
  expect(host.textContent).toContain('Ruko zara') // the district is still loading: held there, not raced
  release()
  await vi.waitFor(() => expect(host.textContent).toContain('Gulabi Shahar'), { timeout: 10_000 })

  const toggle = host.querySelector<HTMLButtonElement>('.lang-toggle')!
  await act(async () => toggle.click())
  expect(localStorage.getItem('gg-lang')).toBe('en')
  expect(host.textContent).toContain('Pink City')
  await act(async () => root.unmount())
})

it('photo mode hides the HUD, the joystick, the name labels and the toasts, takes a photo, and gives it all back', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<App />))
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Padharo!')!.click(),
  )
  await vi.waitFor(() => expect(host.textContent).toContain('Gulabi Shahar'), { timeout: 10_000 })
  const q = (sel: string) => host.querySelector<HTMLElement>(sel)
  expect(q('.photo-frame')).toBeNull()
  expect(q('.hud')).not.toBeNull()

  await act(async () => q('.photo-button')!.click())
  expect(q('.hud')).toBeNull() // chips, toasts, joystick and the street's buttons all live in it
  expect(q('.npc-bubbles')!.hidden).toBe(true) // and the characters' bubbles and the people's names
  expect(q('.photo-frame')!.textContent).toContain('Gulabi Gali · Jaipur')
  expect(document.activeElement).toBe(q('.photo-shutter'))

  await act(async () => q('.photo-shutter')!.click())
  expect(photo.shared).toHaveLength(1)
  expect(photo.shared[0]!.type).toBe('image/png')
  expect(q('.photo-note')!.textContent).toContain('Photo aapke phone mein save')

  await act(async () => q('.photo-exit')!.click())
  expect(q('.photo-frame')).toBeNull()
  expect(q('.hud')).not.toBeNull()
  expect(document.activeElement).toBe(q('.photo-button')) // focus goes back to where it came from
  expect(q('.npc-bubbles')!.hidden).toBe(false)
  await act(async () => root.unmount())
})

it('photo mode ducks the city sounds, and a city that goes mid-photo leaves them unducked', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<App />))
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Padharo!')!.click(),
  )
  await vi.waitFor(() => expect(host.textContent).toContain('Gulabi Shahar'), { timeout: 10_000 })
  await act(async () => host.querySelector<HTMLElement>('.photo-button')!.click())
  expect(ducks.at(-1)).toBe(true)
  ducks.length = 0
  await act(async () => root.unmount())
  expect(ducks).toEqual([false])
})

it('Escape leaves photo mode too', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<App />))
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Padharo!')!.click(),
  )
  await vi.waitFor(() => expect(host.textContent).toContain('Gulabi Shahar'), { timeout: 10_000 })
  await act(async () => host.querySelector<HTMLElement>('.photo-button')!.click())
  await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(host.querySelector('.photo-frame')).toBeNull()
  expect(host.querySelector('.hud')).not.toBeNull()
  await act(async () => root.unmount())
})

it('shows the no-3D screen instead of the intro when WebGL is missing', async () => {
  localStorage.setItem('gg-lang', 'en')
  webgl.available = false
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<App />))
  expect(host.textContent).toContain("3D doesn't run on this phone/browser")
  expect(host.querySelector('.enter')).toBeNull()
  await act(async () => root.unmount())
})

it('shows the no-3D screen, not a blank page, when the renderer cannot start', async () => {
  localStorage.setItem('gg-lang', 'en')
  stage.fail = true
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<App />))
  await act(async () => host.querySelector<HTMLButtonElement>('.enter')!.click())
  expect(host.textContent).toContain("3D doesn't run on this phone/browser")
  expect(host.querySelector('canvas')).toBeNull()
  await act(async () => root.unmount())
})

it('reopens the city in the district last travelled to', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  localStorage.setItem('gg-district', 'mi-road')
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<App />))
  await act(async () => host.querySelector<HTMLButtonElement>('.enter')!.click())
  await vi.waitFor(() => expect(host.querySelector('.hud-top')?.textContent).toMatch(/MI Road/), {
    timeout: 10_000,
  })
  await act(async () => root.unmount())
})

const DEFS: Record<DistrictId, DistrictDef> = {
  'walled-city': walledCity,
  'mi-road': miRoad,
  university,
  'malviya-nagar': malviyaNagar,
  amer,
  nahargarh,
  galta,
}

/** Opens the city with the test hooks on, in Hinglish, starting in the Walled City. */
async function openCity() {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  vi.stubEnv('VITE_TEST_HOOKS', '1') // the hooks are a build-time opt-in
  history.replaceState(null, '', '/?gg-test=1')
  localStorage.setItem('gg-lang', 'hi')
  localStorage.setItem('gg-district', 'walled-city')
  delete (window as { __gg?: unknown }).__gg // hooks left by an earlier test's city
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<App />))
  await act(async () => host.querySelector<HTMLButtonElement>('.enter')!.click())
  await vi.waitFor(() => expect(window.__gg?.district()).toBe('walled-city'), { timeout: 10_000 })
  return { host, root }
}

const tick = () => act(() => stage.frames.forEach((f) => f(1 / 30)))

/** Walks to the station, taps Metro and the district's name; resolves once the trip is over. */
async function ride(host: HTMLElement, to: DistrictId) {
  const here = DEFS[window.__gg.district()].station
  act(() => window.__gg.teleport(here.x, here.z))
  await tick()
  await act(async () => host.querySelector<HTMLButtonElement>('.metro-button')!.click())
  const stop = [...host.querySelectorAll<HTMLButtonElement>('.travel-stop')].find((b) => b.dataset.id === to)!
  await act(async () => stop.click())
  await vi.waitFor(() => expect(host.querySelector('.fade[data-on]')).toBeNull(), { timeout: 5000 })
}

it('travels round the city and leaves nothing behind', async () => {
  const live = new Set<unknown>()
  const realSet = globalThis.setInterval
  const realClear = globalThis.clearInterval
  vi.stubGlobal('setInterval', (...args: Parameters<typeof setInterval>) => {
    const id = realSet(...args)
    live.add(id)
    return id
  })
  vi.stubGlobal('clearInterval', (id: ReturnType<typeof setInterval>) => {
    live.delete(id)
    realClear(id)
  })
  const { host, root } = await openCity()
  const before = {
    children: stage.scene.children.length,
    frames: stage.frames.size,
    qualities: stage.qualities.size,
    timers: live.size,
    bubbles: host.querySelectorAll('.npc-bubble').length,
  }
  for (const to of [
    'mi-road',
    'university',
    'malviya-nagar',
    'amer',
    'nahargarh',
    'galta',
    'walled-city',
  ] as DistrictId[]) {
    await ride(host, to)
    expect(window.__gg.district()).toBe(to)
    expect(localStorage.getItem('gg-district')).toBe(to)
    // the chip shows the short name; the map button's accessible name has the whole one
    expect(host.querySelector('.hud-top .place-button')!.getAttribute('aria-label')).toContain(
      DEFS[to].name.hi,
    )
    const cast = DEFS[to].npcs.map((n) => n.id).sort()
    expect(
      window.__gg
        .npcs()
        .map((n) => n.id)
        .sort(),
    ).toEqual(cast)
    // one district, its player, weather and festival groups, and its own characters: nothing left over
    const bodies = stage.scene.children.filter((c) => c.name.startsWith('npc-')).map((c) => c.name)
    expect(bodies.sort()).toEqual(cast.map((id) => `npc-${id}`))
    expect(stage.scene.children.filter((c) => DEFS[c.name as DistrictId]).map((c) => c.name)).toEqual([to])
    expect(stage.frames.size).toBe(before.frames)
    expect(stage.qualities.size).toBe(before.qualities)
    expect(live.size).toBe(before.timers)
    expect(host.querySelectorAll('.npc-bubble').length).toBe(before.bubbles)
    const p = window.__gg.position()
    expect(Math.hypot(p.x - DEFS[to].station.x, p.z - DEFS[to].station.z)).toBeLessThan(0.01)
  }
  expect(stage.scene.children.length).toBe(before.children) // back in the Walled City, as we started
  await act(async () => root.unmount())
}, 45000) // seven rides of `RIDE_MS` each, on real timers

it('keeps the old district running when the new one fails to load, and says so', async () => {
  const { host, root } = await openCity()
  const frames = stage.frames.size
  unreachable.add('university')
  await ride(host, 'university')
  expect(window.__gg.district()).toBe('walled-city')
  expect(host.querySelector('.hud-top')!.textContent).toContain('Gulabi Shahar')
  expect(host.querySelector('[role="status"]')!.textContent).toContain(
    'University–JKK tak nahi pahunch paaye',
  )
  expect(localStorage.getItem('gg-district')).toBe('walled-city')
  expect(stage.frames.size).toBe(frames) // still walking: the frame loop never stopped
  expect(stage.scene.getObjectByName('walled-city')).toBeDefined()
  // and the next try goes through
  unreachable.clear()
  await ride(host, 'university')
  expect(window.__gg.district()).toBe('university')
  await act(async () => root.unmount())
}, 20000)

it('releases the shared avatar geometry and material when the city goes', async () => {
  const { root } = await openCity()
  const avatar = stage.scene.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh)!
  const geo = vi.fn()
  const mat = vi.fn()
  avatar.geometry.addEventListener('dispose', geo)
  ;(avatar.material as THREE.Material).addEventListener('dispose', mat)
  await act(async () => root.unmount())
  expect(geo).toHaveBeenCalled()
  expect(mat).toHaveBeenCalled()
}, 20000)

const PROFILE_LOOK = { skin: 4, outfit: 'teal', head: 'safa' } as const
const GHOST_LOOK = { skin: 0, outfit: 'pink', head: 'none' } as const
const signedIn = (over: Partial<AuthState> = {}): AuthState => ({
  ...SIGNED_OUT,
  mode: 'dev',
  signedIn: true,
  token: async () => 'tok',
  ...over,
})
const bodies = () => stage.scene.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh)
const wears = (look: typeof GHOST_LOOK | typeof PROFILE_LOOK) =>
  bodies().some((m) => m.geometry === buildAvatar(look).geometry)

it('signing out brings the ghost look back on the player at once', async () => {
  const me = {
    id: 'u',
    complete: true,
    profile: {
      id: 'u',
      name: 'Asha',
      look: PROFILE_LOOK,
      status: '',
      homeArea: 'Raja Park',
      hereFor: null,
      about: '',
      pauseRequests: false,
      stamps: [],
    },
  }
  vi.stubGlobal('fetch', async (url: string) =>
    String(url).endsWith('/api/me') ? Response.json(me) : Promise.reject(new TypeError('offline')),
  )
  localStorage.setItem('gg-lang', 'hi')
  localStorage.setItem('gg-look', JSON.stringify(GHOST_LOOK))
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const render = (auth: AuthState) =>
    act(async () =>
      root.render(
        <AuthContext.Provider value={auth}>
          <App />
        </AuthContext.Provider>,
      ),
    )
  const user = signedIn()
  await render(user)
  await act(async () => host.querySelector<HTMLButtonElement>('.enter')!.click())
  await vi.waitFor(() => expect(host.textContent).toContain('Jaipur tumhe dekh sakta hai'))
  await vi.waitFor(() => expect(wears(PROFILE_LOOK)).toBe(true))
  expect(wears(GHOST_LOOK)).toBe(false)

  await render({ ...SIGNED_OUT, mode: 'dev' })
  expect(wears(GHOST_LOOK)).toBe(true)
  expect(wears(PROFILE_LOOK)).toBe(false)
  await act(async () => root.unmount())
})

it('a profile with no `stamps` field (an older Worker, a rollback) still opens the city as a resident', async () => {
  const me = {
    id: 'u',
    complete: true,
    profile: {
      id: 'u',
      name: 'Asha',
      look: PROFILE_LOOK,
      status: '',
      homeArea: 'Raja Park',
      hereFor: null,
      about: '',
      pauseRequests: false,
    },
  }
  vi.stubGlobal('fetch', async (url: string) =>
    String(url).endsWith('/api/me') ? Response.json(me) : Promise.reject(new TypeError('offline')),
  )
  localStorage.setItem('gg-lang', 'hi')
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <AuthContext.Provider value={signedIn()}>
        <App />
      </AuthContext.Provider>,
    ),
  )
  await act(async () => host.querySelector<HTMLButtonElement>('.enter')!.click())
  await vi.waitFor(() => expect(host.textContent).toContain('Jaipur tumhe dekh sakta hai'))
  expect(host.querySelector('.stamp-count')!.textContent).toBe('0/14')
  await act(async () => root.unmount())
})

it('signed in but /api/me failing: still a ghost chip, with a way to sign out', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  localStorage.setItem('gg-lang', 'hi')
  const signOut = vi.fn(async () => undefined)
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <AuthContext.Provider value={signedIn({ signOut })}>
        <App />
      </AuthContext.Provider>,
    ),
  )
  await act(async () => host.querySelector<HTMLButtonElement>('.enter')!.click())
  expect(host.textContent).toContain('Abhi koi tumhe dekh nahi sakta')
  const out = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Logout karo')!
  await act(async () => out.click())
  expect(signOut).toHaveBeenCalledOnce()
  await act(async () => root.unmount())
})

it('a banned account gets a plain screen saying so, over the city, with a way to sign out', async () => {
  vi.stubGlobal('fetch', async (url: string) =>
    url.endsWith('/api/me')
      ? new Response(JSON.stringify({ error: 'banned' }), { status: 403 })
      : new Response('{}', { status: 404 }),
  )
  localStorage.setItem('gg-lang', 'hi')
  const signOut = vi.fn(async () => undefined)
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <AuthContext.Provider value={signedIn({ signOut })}>
        <App />
      </AuthContext.Provider>,
    ),
  )
  await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
  const screen = host.querySelector('[role="alert"]')!
  expect(screen.textContent).toContain('Ye account band hai')
  expect(host.querySelector('.enter')?.textContent).not.toBe('Padharo!')
  await act(async () =>
    [...screen.querySelectorAll('button')].find((b) => b.textContent === 'Logout karo')!.click(),
  )
  expect(signOut).toHaveBeenCalledOnce()
  await act(async () => root.unmount())
})

it('a live session is told of its ban at once, and a new sign-in starts clean', async () => {
  const me = {
    id: 'u',
    complete: true,
    profile: {
      id: 'u',
      name: 'Asha',
      look: PROFILE_LOOK,
      status: '',
      homeArea: 'Raja Park',
      hereFor: null,
      about: '',
      pauseRequests: false,
      stamps: [],
    },
  }
  let banned = false
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (!String(url).endsWith('/api/me')) return Promise.reject(new TypeError('offline'))
    const who = new Headers(init?.headers).get('Authorization')
    // the next person to sign in here cannot reach the API at all: nothing new is known about them
    if (who === 'Bearer other') return Promise.reject(new TypeError('offline'))
    return banned ? new Response(JSON.stringify({ error: 'banned' }), { status: 403 }) : Response.json(me)
  })
  localStorage.setItem('gg-lang', 'hi')
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const render = (auth: AuthState) =>
    act(async () =>
      root.render(
        <AuthContext.Provider value={auth}>
          <App />
        </AuthContext.Provider>,
      ),
    )
  await render(signedIn())
  await act(async () => host.querySelector<HTMLButtonElement>('.enter')!.click())
  await vi.waitFor(() => expect(host.textContent).toContain('Jaipur tumhe dekh sakta hai'))
  await vi.waitFor(async () => expect(await liveNow()[0]?.opts.token()).toBe('tok'))
  expect(host.textContent).not.toContain('Ye account band hai')

  // The moderator bans them: the district closes their socket with 4004, and the page asks who it is now.
  banned = true
  await act(async () => liveNow()[0]!.opts.onBanned!())
  await vi.waitFor(() => expect(host.textContent).toContain('Ye account band hai'))

  // Someone else signs in on this tab (a new token): the ban was the last account's, so it goes, even before
  // anything is known about the new one.
  await render(signedIn({ token: async () => 'other' }))
  await vi.waitFor(() => expect(host.textContent).toContain('Abhi koi tumhe dekh nahi sakta'))
  expect(host.textContent).not.toContain('Ye account band hai')
  await act(async () => root.unmount())
})

it('the live socket follows who you are, and says so when another tab takes over', async () => {
  const me = {
    id: 'u',
    complete: true,
    profile: {
      id: 'u',
      name: 'Asha',
      look: PROFILE_LOOK,
      status: '',
      homeArea: 'Raja Park',
      hereFor: null,
      about: '',
      pauseRequests: false,
      stamps: [],
    },
  }
  vi.stubGlobal('fetch', async (url: string) =>
    String(url).endsWith('/api/me') ? Response.json(me) : Promise.reject(new TypeError('offline')),
  )
  localStorage.setItem('gg-lang', 'hi')
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const render = (auth: AuthState) =>
    act(async () =>
      root.render(
        <AuthContext.Provider value={auth}>
          <App />
        </AuthContext.Provider>,
      ),
    )
  await render({ ...SIGNED_OUT, mode: 'dev' })
  await act(async () => host.querySelector<HTMLButtonElement>('.enter')!.click())
  await vi.waitFor(() => expect(liveNow()).toHaveLength(1))
  expect(await liveNow()[0]!.opts.token()).toBeNull() // a ghost

  // signing in with a finished profile: a fresh socket, as a resident, and only one
  await render(signedIn())
  await vi.waitFor(() => expect(host.textContent).toContain('Jaipur tumhe dekh sakta hai'))
  await vi.waitFor(async () => expect(await liveNow()[0]?.opts.token()).toBe('tok'))
  expect(liveNow()).toHaveLength(1)

  // another tab took over: no reconnect, and a notice
  await act(async () => liveNow()[0]!.opts.onReplaced!())
  expect(host.textContent).toContain('Tum ek aur tab mein bhi khule ho.')

  // signing out: a ghost again, without a reload
  const before = sockets.length
  await render({ ...SIGNED_OUT, mode: 'dev' })
  await vi.waitFor(() => expect(sockets.length).toBe(before + 1))
  expect(await liveNow()[0]!.opts.token()).toBeNull()
  expect(liveNow()).toHaveLength(1)
  await act(async () => root.unmount())
  expect(liveNow()).toHaveLength(0)
})

it('saving a new name, look or status reconnects the live socket, so others see it; other edits do not', async () => {
  let me = {
    id: 'u',
    complete: true,
    profile: {
      id: 'u',
      name: 'Asha',
      look: PROFILE_LOOK,
      status: '',
      homeArea: 'Raja Park',
      hereFor: null,
      about: '',
      pauseRequests: false,
      stamps: [],
    },
  }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/api/me/profile') && init?.method === 'PUT') {
      const sent = JSON.parse(String(init.body)) as typeof me.profile
      me = { ...me, profile: { ...me.profile, ...sent, id: 'u' } }
      return Response.json(me)
    }
    return String(url).endsWith('/api/me') ? Response.json(me) : Promise.reject(new TypeError('offline'))
  })
  localStorage.setItem('gg-lang', 'hi')
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <AuthContext.Provider value={signedIn()}>
        <App />
      </AuthContext.Provider>,
    ),
  )
  await act(async () => host.querySelector<HTMLButtonElement>('.enter')!.click())
  await vi.waitFor(() => expect(host.textContent).toContain('Jaipur tumhe dekh sakta hai'))
  await vi.waitFor(async () => expect(await liveNow()[0]?.opts.token()).toBe('tok'))
  const edit = async (field: string, value: string) => {
    await act(async () => button(host, 'Profile')!.click())
    const el = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${field}"]`)!
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button(host, 'Save karo')!.click())
    await vi.waitFor(() => expect(host.querySelector('.profile-sheet')).toBeNull())
  }

  const before = sockets.length
  await edit('status', 'chai pe milo')
  await vi.waitFor(() => expect(sockets.length).toBe(before + 1))
  expect(liveNow()).toHaveLength(1)
  expect(await liveNow()[0]!.opts.token()).toBe('tok')

  // the about line is not on the map: no reconnect for it
  await edit('about', 'Painter, slow walker.')
  await act(async () => void (await new Promise((r) => setTimeout(r, 50))))
  expect(sockets.length).toBe(before + 1)

  await edit('name', 'Asha Rathore')
  await vi.waitFor(() => expect(sockets.length).toBe(before + 2))
  expect(liveNow()).toHaveLength(1)
  await act(async () => root.unmount())
})

/** The Walled City's tapri by Johari Bazaar, and the city's one live socket. */
const tapri = benchesOf(walledCity)[4]!
const server = (m: ServerMsg) => act(() => liveNow()[0]!.opts.onMsg(m))
const sentNow = () => liveNow()[0]!.sent
const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === label)

it('Baitho appears near a bench and not elsewhere', async () => {
  const { host, root } = await openCity()
  await tick()
  expect(button(host, 'Baitho')).toBeUndefined() // at the spawn
  act(() => window.__gg.teleport(tapri.at.x + 2, tapri.at.z))
  await tick()
  expect(button(host, 'Baitho')).toBeDefined()
  act(() => window.__gg.teleport(tapri.at.x + 3, tapri.at.z))
  await tick()
  expect(button(host, 'Baitho')).toBeUndefined()
  await act(async () => root.unmount())
})

it("Baitho sits on the server's word and opens the bench chat; Utho stands up", async () => {
  const { host, root } = await openCity()
  act(() => window.__gg.teleport(tapri.at.x + 2, tapri.at.z))
  await tick()
  await act(async () => button(host, 'Baitho')!.click())
  expect(sentNow()).toEqual([{ t: 'sit', bench: 'walled-city:4' }])
  expect(host.querySelector('.bench-chat')).toBeNull()

  await server({ t: 'seated', bench: 'walled-city:4', seat: 0, with: ['Ravi'] })
  const chat = host.querySelector<HTMLElement>('.bench-chat')!
  expect(chat.textContent).toContain('Ravi')
  expect(chat.textContent).toContain(
    'Jo is bench pe baithe hain wahi padh sakte hain. Report hone par moderator haal ki baatein dekh sakta hai.',
  )
  expect(button(host, 'Baitho')).toBeUndefined()

  const input = chat.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'ek cutting?')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => chat.querySelector('form')!.requestSubmit())
  expect(sentNow().at(-1)).toEqual({ t: 'say', text: 'ek cutting?' })
  expect(input.value).toBe('')
  await server({
    t: 'bench',
    bench: 'walled-city:4',
    from: 'dev:ravi',
    name: 'Ravi',
    text: 'haan, do',
    at: 1,
  })
  expect(chat.textContent).toContain('haan, do')

  await act(async () => button(host, 'Utho')!.click())
  expect(sentNow().at(-1)).toEqual({ t: 'sit', bench: null })
  expect(host.querySelector('.bench-chat')).toBeNull()
  expect(button(host, 'Baitho')).toBeDefined()
  await act(async () => root.unmount())
})

it('a ghost who tries to sit is told to be seen first, with a way in', async () => {
  const { host, root } = await openCity()
  act(() => window.__gg.teleport(tapri.at.x + 2, tapri.at.z))
  await tick()
  await act(async () => button(host, 'Baitho')!.click())
  await server({ t: 'error', code: 'ghost' })
  expect(host.textContent).toContain('Baithne ke liye pehle dikhna padega')
  expect(button(host, 'Dikhna hai? Login karo')).toBeDefined()
  expect(host.querySelector('.bench-chat')).toBeNull()
  // walking away puts the notice away
  act(() => window.__gg.teleport(tapri.at.x + 4, tapri.at.z))
  await tick()
  expect(host.textContent).not.toContain('Baithne ke liye pehle dikhna padega')
  await act(async () => root.unmount())
})

it('says so when the first district cannot be loaded, and unmounting while it loads leaves no city', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  localStorage.setItem('gg-lang', 'en')
  localStorage.setItem('gg-district', 'walled-city')
  unreachable.add('walled-city')
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<App />))
  await act(async () => host.querySelector<HTMLButtonElement>('.enter')!.click())
  await vi.waitFor(
    () => expect(host.querySelector('.hud-top')?.textContent).toContain("Couldn't open the lane"),
    {
      timeout: 10_000,
    },
  )
  await act(async () => root.unmount())

  // leaving while a chunk is still on its way: the late arrival must not build or mount anything
  unreachable.clear()
  let release!: () => void
  hold.until = new Promise<void>((r) => (release = r))
  const host2 = document.body.appendChild(document.createElement('div'))
  const root2 = createRoot(host2)
  await act(async () => root2.render(<App />))
  await act(async () => host2.querySelector<HTMLButtonElement>('.enter')!.click())
  const scene = stage.scene
  await act(async () => root2.unmount())
  release()
  await new Promise((r) => setTimeout(r, 50))
  expect(scene.getObjectByName('walled-city')).toBeUndefined()
  expect(stage.frames.size).toBe(0)
})

describe('a block offered on the reaction toast', () => {
  /**
   * A resident on the street, with Asha beside them having greeted them three times: the toast offers a block.
   * `blocks` answers the block call.
   */
  async function offered(blocks: () => Response) {
    const me = {
      id: 'u',
      complete: true,
      verified: false,
      profile: {
        id: 'u',
        name: 'Ravi',
        look: PROFILE_LOOK,
        status: '',
        homeArea: 'Raja Park',
        hereFor: null,
        about: '',
        pauseRequests: false,
        stamps: [],
      },
    }
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const path = new URL(String(url)).pathname
      if (path === '/api/me') return Response.json(me)
      if (path === '/api/blocks' && init?.method === 'POST') return blocks()
      return Promise.reject(new TypeError('offline'))
    })
    vi.stubEnv('VITE_TEST_HOOKS', '1')
    history.replaceState(null, '', '/?gg-test=1')
    localStorage.setItem('gg-lang', 'hi')
    localStorage.setItem('gg-district', 'walled-city')
    delete (window as { __gg?: unknown }).__gg
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <AuthContext.Provider value={signedIn()}>
          <App />
        </AuthContext.Provider>,
      ),
    )
    await act(async () => host.querySelector<HTMLButtonElement>('.enter')!.click())
    await vi.waitFor(() => expect(window.__gg?.district()).toBe('walled-city'), { timeout: 10_000 })
    await vi.waitFor(async () => expect(await liveNow()[0]?.opts.token()).toBe('tok'))
    const at = window.__gg.position()
    const asha = { id: 'dev:asha', name: 'Asha', look: GHOST_LOOK, status: '', x: at.x + 2, z: at.z, ry: 0 }
    await server({ t: 'welcome', you: { id: 'u', visible: true }, people: [asha] })
    await tick()
    for (let i = 0; i < 3; i++) await server({ t: 'react', from: 'dev:asha', to: 'u', kind: 'wave' })
    const offer = host.querySelector<HTMLButtonElement>('button[aria-label="Asha ko block karo"]')!
    expect(offer).not.toBeNull()
    return { host, root, offer }
  }
  const card = (host: HTMLElement) =>
    host.querySelector<HTMLElement>('section.person-card[aria-label="Asha"]')

  it('asks first, in her card, and a block that fails says so and keeps the card up', async () => {
    const { host, root, offer } = await offered(() => new Response(null, { status: 500 }))
    await act(async () => offer.click())
    const ask = card(host)!.querySelector('[role="alertdialog"]')!
    expect(ask.textContent).toContain('Asha ko block karein?')
    await act(async () => button(host, 'Haan, block karo')!.click())
    await vi.waitFor(() => expect(card(host)?.textContent).toContain('Block nahi ho paya. Dobara try karo.'))
    expect(card(host)).not.toBeNull()
    // while her card asks, the toast keeps out of the way (a small phone has room for one of them)
    const offerUp = () => host.querySelector<HTMLButtonElement>('button[aria-label="Asha ko block karo"]')
    expect(offerUp()).toBeNull()
    // "never mind" and the card closed with nothing blocked: the offer is back, and asks afresh
    await act(async () => button(host, 'Rehne do')!.click())
    expect(card(host)!.querySelector('[role="alertdialog"]')).toBeNull()
    await act(async () => button(host, 'Band karo')!.click())
    expect(card(host)).toBeNull()
    expect(offerUp()).not.toBeNull()
    await act(async () => offerUp()!.click())
    expect(card(host)!.querySelector('[role="alertdialog"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it('"also report" blocks first, then opens the report form for her', async () => {
    const { host, root, offer } = await offered(() => new Response(null, { status: 204 }))
    await act(async () => offer.click())
    const also = [...card(host)!.querySelectorAll('label')].find((l) =>
      l.textContent?.includes('Report bhi'),
    )!
    await act(async () => also.querySelector('input')!.click())
    await act(async () => button(host, 'Haan, block karo')!.click())
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Asha ki report"]')).not.toBeNull())
    expect(host.textContent).toContain('Asha block ho gaye')
    await act(async () => root.unmount())
  })
})
