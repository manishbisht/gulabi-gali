// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as THREE from 'three'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Stage } from '../engine/stage'
import { loadBest, MAX_BALLS } from '../games/cricket'
import type { Controls } from '../player/controls'
import { storage } from '../storage'
import { onCricketPlayed } from '../world/cricketPitch'
import Cricket from './Cricket'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let frames: ((dt: number) => void)[]
let scene: THREE.Scene
let stage: Stage
let controls: Controls
const pitch = { stumps: { x: 4, z: 81 }, bowler: { x: 11, z: 81 } }

beforeEach(() => {
  frames = []
  scene = new THREE.Scene()
  stage = {
    scene,
    camera: new THREE.PerspectiveCamera(60, 0.5),
    quality: 2,
    onFrame: (cb: (dt: number) => void) => {
      frames.push(cb)
      return () => void (frames = frames.filter((f) => f !== cb))
    },
  } as unknown as Stage
  controls = { freeze: vi.fn() } as unknown as Controls
  document.body.innerHTML = '<div id="app"></div>'
  root = createRoot(document.getElementById('app')!)
  vi.stubEnv('VITE_TEST_HOOKS', '1')
  history.replaceState(null, '', '/?gg-test=1')
})
afterEach(() => {
  act(() => root.unmount())
  storage.clear()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  history.replaceState(null, '', '/')
  delete (window as { __gg?: unknown }).__gg
})

const mount = (props: { onExit?: () => void; onHide?: (on: boolean) => void; lang?: 'hi' | 'en' } = {}) =>
  act(() =>
    root.render(
      <Cricket
        lang={props.lang ?? 'en'}
        stage={stage}
        controls={controls}
        pitch={pitch}
        onHide={props.onHide}
        onExit={props.onExit ?? (() => {})}
      />,
    ),
  )
const key = (code: string, target: EventTarget = document.body, type = 'keydown') => {
  const e = new KeyboardEvent(type, {
    code,
    key: code === 'Space' ? ' ' : code,
    cancelable: true,
    bubbles: true,
  })
  act(() => void target.dispatchEvent(e))
  return e
}
const gg = () => window.__gg.cricket()
const text = (sel: string) => document.querySelector(sel)?.textContent ?? ''

it('keeps the keys to itself, leaves on Escape, and cleans up what it drew', () => {
  const onExit = vi.fn()
  const onHide = vi.fn()
  const seen = vi.fn()
  window.addEventListener('keydown', seen)
  mount({ onExit, onHide })
  expect(scene.getObjectByName('cricket-game')).toBeDefined()
  expect(frames).toHaveLength(1)
  expect(controls.freeze).toHaveBeenLastCalledWith(true)
  expect(onHide).toHaveBeenLastCalledWith(true) // the view is the batter's own: their body is not drawn
  key('KeyW')
  key('KeyE')
  expect(seen).not.toHaveBeenCalled() // the city does not hear it
  key('Escape')
  expect(onExit).toHaveBeenCalledTimes(1)
  window.removeEventListener('keydown', seen)
  act(() => root.render(<></>))
  expect(scene.getObjectByName('cricket-game')).toBeUndefined()
  expect(frames).toHaveLength(0)
  expect(controls.freeze).toHaveBeenLastCalledWith(false)
  expect(onHide).toHaveBeenLastCalledWith(false)
  expect(gg().active).toBe(false)
})

it('inerts its siblings while it is up, and hands them back', () => {
  const app = document.getElementById('app')!
  const page = (open: boolean) => (
    <>
      <canvas />
      <aside id="hud" />
      {open && <Cricket lang="en" stage={stage} controls={controls} pitch={pitch} onExit={() => {}} />}
    </>
  )
  act(() => root.render(page(true)))
  expect(app.querySelector('canvas')!.hasAttribute('inert')).toBe(true)
  expect(app.querySelector('#hud')!.hasAttribute('inert')).toBe(true)
  expect(app.querySelector('.cricket')!.hasAttribute('inert')).toBe(false)
  act(() => root.render(page(false)))
  expect(app.querySelector('#hud')!.hasAttribute('inert')).toBe(false)
  // focus goes back to the stage
  expect(document.activeElement).toBe(app.querySelector('canvas'))
})

it('one thumb plays it: a tap anywhere on the field is the swing, and a well-timed one is a six', () => {
  mount()
  const field = document.querySelector<HTMLElement>('.cricket-field')!
  expect(field.getAttribute('aria-label')).toBe('Swing the bat')
  expect(text('.cricket-top')).toContain('Runs: 0')
  expect(text('.cricket-top')).toContain('Ball 1/18')
  expect(text('.cricket-top')).toContain('Out 0/3')
  expect(text('.cricket-help')).toMatch(/Tap/)
  act(() => {
    gg().pause(true)
    gg().tapAtBat()
  })
  act(() => void field.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })))
  expect(gg().runs()).toBe(6)
  expect(gg().last()).toBe('six')
  expect(text('.cricket-top')).toContain('Runs: 6')
  expect(text('.cricket-top')).toContain('Ball 2/18')
  expect(text('.cricket-said')).toMatch(/^Six!/)
  expect(document.querySelector('.cricket-help')).toBeNull() // the how-to goes after the first ball
  // the press's own click is not a second swing; a right button is no swing at all
  act(() => {
    gg().tapAtBat()
  })
  act(() => void field.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2 })))
  act(() => void field.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
  expect(gg().runs()).toBe(6)
})

it('Space swings (never also clicking the field), and a click with no press (assistive tech) swings too', () => {
  mount()
  const field = document.querySelector<HTMLElement>('.cricket-field')!
  act(() => {
    gg().pause(true)
    gg().tapAtBat()
  })
  const down = key('Space')
  expect(down.defaultPrevented).toBe(true)
  expect(key('Space', document.body, 'keyup').defaultPrevented).toBe(true)
  expect(gg().runs()).toBe(6)
  act(() => {
    gg().tapAtBat()
  })
  act(() => void field.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })))
  expect(gg().runs()).toBe(12)
  // on the Stop button Space is the button's own press, not a swing
  const stop = document.querySelector<HTMLElement>('.cricket-stop')!
  expect(stop.getAttribute('aria-label')).toBe('Stop playing')
  act(() => {
    gg().tapAtBat()
  })
  expect(key('Space', stop).defaultPrevented).toBe(false)
  expect(gg().runs()).toBe(12)
})

it('says what came of each ball, in both languages', () => {
  mount({ lang: 'hi' })
  act(() => {
    gg().pause(true)
    gg().ball(0.06)
  })
  expect(text('.cricket-said')).toBe('Chauka!')
  expect(text('.cricket-top')).toContain('Run: 4')
  act(() => gg().ball(0.1))
  expect(text('.cricket-said')).toBe('Do run')
  act(() => gg().ball(-0.16))
  expect(text('.cricket-said')).toBe('Ek run')
  act(() => gg().ball(null))
  expect(['Khaali gayi', 'Bowled! Eentein bikhar gayi']).toContain(text('.cricket-said'))
})

it('breaks a window at most once an innings, with an "Arre!" under the six', () => {
  mount()
  act(() => gg().pause(true))
  let arre = 0
  for (let i = 0; i < MAX_BALLS; i++) {
    act(() => gg().ball(0))
    if (document.querySelector('.cricket-said small')) {
      arre++
      expect(text('.cricket-said small')).toMatch(/^Arre!/)
    }
  }
  expect(arre).toBeLessThanOrEqual(1)
  expect(gg().runs()).toBe(108)
})

it('ends with the score, the best kept locally, a share line, and tells the page a round was played', () => {
  const played = vi.fn()
  const off = onCricketPlayed(played)
  mount()
  act(() => {
    gg().pause(true)
    gg().ball(0)
    gg().ball(0.06)
  })
  expect(played).not.toHaveBeenCalled() // not before the innings is over
  act(() => gg().finish())
  off()
  expect(played).toHaveBeenCalledTimes(1)
  expect(played).toHaveBeenCalledWith(10)
  const score = document.querySelector('.cricket-score')!
  expect(score.textContent).toMatch(/Runs: 10/)
  expect(score.textContent).toMatch(/Best: 10/)
  expect(score.textContent).toMatch(/A new best!/)
  expect(loadBest()).toBe(10)
  expect(storage.get('gg-cricket-best')).toBe('10')
  expect(document.querySelector('.cricket-field')).toBeNull() // no more swings
  const labels = [...score.querySelectorAll('button')].map((b) => b.textContent)
  expect(labels).toEqual(['Bat again', 'Share', 'Done'])
  expect(document.activeElement).toBe(score.querySelector('button'))
})

it('shares a line with the runs and the site, and says when it was copied instead', async () => {
  const share = vi.fn().mockRejectedValue(new Error('no sheet'))
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { ...navigator, share, clipboard: { writeText } })
  try {
    mount()
    act(() => {
      gg().pause(true)
      gg().ball(0)
      gg().finish()
    })
    const button = [...document.querySelectorAll<HTMLButtonElement>('.cricket-score button')][1]!
    await act(async () => button.click())
    expect(share).toHaveBeenCalledWith({
      text: 'I made 6 runs at gali cricket in Gulabi Gali! 🏏 How many can you make?',
      url: 'https://gulabi-gali.manishbisht.me',
    })
    expect(writeText).toHaveBeenCalled()
    expect(text('.cricket-shared')).toBe('Link copied')
  } finally {
    vi.unstubAllGlobals()
  }
})

it('"Bat again" starts a fresh innings with the focus on the game, and a worse one keeps the best', () => {
  mount()
  act(() => {
    gg().pause(true)
    gg().ball(0)
    gg().finish()
  })
  const again = document.querySelector<HTMLButtonElement>('.cricket-score button')!
  act(() => again.click())
  expect(document.querySelector('.cricket-score')).toBeNull()
  expect(document.activeElement).toBe(document.querySelector('.cricket'))
  expect(frames).toHaveLength(1) // the first innings' frame callback was let go
  expect(text('.cricket-top')).toContain('Runs: 0')
  act(() => {
    gg().pause(true)
    gg().finish()
  })
  expect(document.querySelector('.cricket-score')!.textContent).toMatch(/Runs: 0/)
  expect(document.querySelector('.cricket-score')!.textContent).toMatch(/Best: 6/)
  expect(document.querySelector('.cricket-record')).toBeNull()
})

it('keeps the runs made so far when the player leaves mid-innings, without counting a round played', () => {
  const played = vi.fn()
  const off = onCricketPlayed(played)
  mount()
  act(() => {
    gg().pause(true)
    gg().ball(0.06)
  })
  expect(loadBest()).toBe(0)
  act(() => root.render(<></>))
  off()
  expect(loadBest()).toBe(4)
  expect(played).not.toHaveBeenCalled()
})

it('draws no fielders at the lowest quality tier', () => {
  ;(stage as { quality: number }).quality = 0
  mount()
  expect(gg().fielders()).toBe(0)
  let instances = 0
  scene.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) instances += o.count
  })
  expect(instances).toBe(0)
})

it('frames move the innings on by themselves: nobody tapping, it is over within a minute and a half', () => {
  mount()
  act(() => {
    for (let i = 0; i < 90 * 10 && !document.querySelector('.cricket-score'); i++)
      frames.forEach((f) => f(0.1))
  })
  expect(document.querySelector('.cricket-score')).not.toBeNull()
  expect(text('.cricket-score')).toMatch(/Runs: 0/)
})

it('waits for a first tap ("Tap to start") that is not a swing, and keeps the how-to up until the first swing', () => {
  mount()
  const field = document.querySelector<HTMLElement>('.cricket-field')!
  expect(text('.cricket-ready')).toBe('Tap to start')
  expect(text('.cricket-help')).toMatch(/Tap/)
  // two seconds of frames: still waiting
  act(() => {
    for (let i = 0; i < 20; i++) frames.forEach((f) => f(0.1))
  })
  expect(text('.cricket-ready')).toBe('Tap to start')
  act(() => void field.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })))
  expect(document.querySelector('.cricket-ready')).toBeNull() // the bowler is on the way
  expect(gg().balls()).toBe(0)
  expect(text('.cricket-help')).toMatch(/Tap/) // nothing swung yet: the how-to stays
  // the ball's own swing is still to be had
  act(() => {
    gg().pause(true)
    gg().tapAtBat()
  })
  act(() => void field.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })))
  expect(gg().runs()).toBe(6)
  expect(document.querySelector('.cricket-help')).toBeNull()
})

it('starts by itself after three seconds, and the how-to outlasts a ball nobody swung at', () => {
  mount({ lang: 'hi' })
  expect(text('.cricket-ready')).toBe('Tap karke shuru karo')
  act(() => {
    for (let i = 0; i < 31; i++) frames.forEach((f) => f(0.1))
  })
  expect(document.querySelector('.cricket-ready')).toBeNull()
  act(() => {
    gg().pause(true)
    gg().ball(null)
  })
  expect(gg().balls()).toBe(1)
  expect(text('.cricket-help')).toMatch(/tap karo/)
})

it("times a tap by its event's own stamp, and takes a touch 50 ms earlier: a finger's six stays a six", () => {
  const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
  const tap = (pointerType: string, stamp: number) => {
    act(() => {
      gg().pause(true)
      gg().tapAtBat()
      gg().pause(false)
    })
    act(() => frames.forEach((f) => f(1e-6))) // a frame at 1000 ms, the ball at the bat
    const e = new MouseEvent('pointerdown', { bubbles: true, button: 0 })
    Object.defineProperty(e, 'pointerType', { value: pointerType })
    Object.defineProperty(e, 'timeStamp', { value: stamp })
    now.mockReturnValue(1400) // the handler runs late: the stamp, not this, is the tap's moment
    act(() => void document.querySelector('.cricket-field')!.dispatchEvent(e))
    now.mockReturnValue(1000)
    return gg().last()
  }
  mount()
  expect(tap('touch', 1050)).toBe('six') // heard 50 ms late, as touches are
  expect(tap('mouse', 1050)).toBe('four') // a mouse 50 ms late is late
  expect(tap('mouse', 1000)).toBe('six')
})

it('gives a slow phone (the lowest tier) a six window wider than one of its frames', () => {
  mount()
  act(() => {
    gg().pause(true)
    gg().ball(0.05)
  })
  expect(gg().last()).toBe('four')
  act(() => root.render(<></>))
  ;(stage as { quality: number }).quality = 0
  mount()
  act(() => {
    gg().pause(true)
    gg().ball(0.05)
  })
  expect(gg().last()).toBe('six')
})

it('clears what came of the last ball when the next run-up starts (nothing fades it under reduced motion)', () => {
  mount()
  act(() => {
    gg().pause(true)
    gg().ball(0.06)
  })
  expect(text('.cricket-said')).toBe('Four!')
  act(() => {
    gg().pause(false)
    for (let i = 0; i < 9; i++) frames.forEach((f) => f(0.1))
  })
  expect(text('.cricket-said')).toBe('Four!') // 0.9 s in: still showing
  act(() => {
    for (let i = 0; i < 4; i++) frames.forEach((f) => f(0.1))
  })
  expect(document.querySelector('.cricket-said')).toBeNull()
  expect(gg().balls()).toBe(1)
})

it("holds the broken window's line for about two seconds", () => {
  mount()
  act(() => gg().pause(true))
  let found = false
  for (let i = 0; i < MAX_BALLS - 1 && !found; i++) {
    act(() => gg().ball(0))
    found = !!document.querySelector('.cricket-said small')
  }
  if (!found) return // this innings' balls broke no window (seeded by chance); cricket.test.ts covers the hold
  const said = document.querySelector<HTMLElement>('.cricket-said')!
  expect(said.style.animationDuration).toBe('2.2s')
  act(() => {
    gg().pause(false)
    for (let i = 0; i < 19; i++) frames.forEach((f) => f(0.1))
  })
  expect(text('.cricket-said small')).toMatch(/^Arre!/) // 1.9 s on, still there to read
})

it('the fielders hook reports what is in the scene', () => {
  mount()
  const drawn = () => {
    let n = 0
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) n += o.count
    })
    return n
  }
  expect(drawn()).toBe(3)
  expect(gg().fielders()).toBe(drawn())
})
