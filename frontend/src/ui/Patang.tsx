import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { woKaata, unlockAudio } from '../audio/horn'
import type { Stage } from '../engine/stage'
import { createPatang, loadBest, saveBest, ROUND_S, type PatangInput } from '../games/patang'
import { createPatangView } from '../games/patangView'
import { t, type Lang } from '../i18n/strings'
import type { Controls } from '../player/controls'
import { installTestHooks } from '../testHooks'
import type { Vec2 } from '../world/types'
import { inertRest } from './inertRest'
import { Joystick } from './Joystick'

/** A drag this many CSS px from where it began is full steer. */
const DRAG_FULL = 70
/** How long a click that is not a press (assistive tech) pulls for. */
const TAP_PULL_MS = 800

interface Props {
  lang: Lang
  stage: Stage
  controls: Controls
  /** Where the player stands: the camera looks up from here. */
  at: Vec2
  /** How high their feet are: 0 on the street, a roof's height up on the rooftop viewpoint. */
  y?: number
  onExit: () => void
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v))

/** Where focus goes when the game ends: the stage, which is not otherwise focusable. */
function stageEl(): HTMLElement | null {
  const canvas = document.querySelector<HTMLElement>('canvas')
  if (canvas && !canvas.hasAttribute('tabindex')) canvas.tabIndex = -1
  return canvas
}

/**
 * Patang-baazi, the Sankranti kite fight, over the street. While it runs the player stands still (the controls
 * are frozen), the rest of the page is inert and keys go only to the game (Space pulls, A/D steer, Escape
 * leaves), and on the way out all of that is handed back. The simulation is `createPatang`; this file feeds
 * it input and draws it, and nothing here allocates per frame.
 */
export function Patang({ lang, stage, controls, at, y = 0, onExit }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const again = useRef<HTMLButtonElement>(null)
  const onExitRef = useRef(onExit)
  useEffect(() => void (onExitRef.current = onExit))
  /** Every way of steering and pulling, folded into one input per frame. */
  const held = useRef({ key: false, button: false, left: false, right: false, stick: 0, drag: 0 })
  const [round, setRound] = useState(0)
  const [hud, setHud] = useState({ left: ROUND_S, score: 0, over: false, lost: false, cuts: 0 })
  const [best, setBest] = useState(loadBest)

  // the page around the game: inert, silent to the controls, and given back afterwards
  useEffect(() => {
    const el = root.current
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    el?.focus()
    controls.freeze(true)
    // (one that arrives meanwhile, a toast or a card, is made inert too)
    const release = inertRest(el?.parentElement, (n) => n === el)
    const h = held.current
    const set = (code: string, on: boolean) => {
      if (code === 'Space') h.key = on
      else if (code === 'KeyA' || code === 'ArrowLeft') h.left = on
      else if (code === 'KeyD' || code === 'ArrowRight') h.right = on
      else return false
      return true
    }
    // the city listens on the window: nothing but Tab gets past here while the game is up
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return
      e.stopImmediatePropagation()
      if (e.key === 'Escape') return onExitRef.current()
      // Enter on the focused Pull button holds it, as Space does; on any other button it still clicks
      if (e.code === 'Enter' && (e.target as Element | null)?.closest?.('.patang-pull')) {
        h.key = true
        return e.preventDefault()
      }
      if (set(e.code, true)) e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && (e.target as Element | null)?.closest?.('.patang-pull')) {
        h.key = false
        return e.preventDefault()
      }
      if (set(e.code, false)) e.preventDefault() // a space is never a click on the focused button
    }
    const onBlur = () => Object.assign(h, { key: false, button: false, left: false, right: false })
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      release()
      controls.freeze(false)
      const back = before && before.isConnected && before !== document.body ? before : stageEl()
      back?.focus()
    }
  }, [controls])

  // one round: the simulation and its drawing, from the first frame to the score
  useEffect(() => {
    const sim = createPatang((Math.random() * 2 ** 32) >>> 0, stage.quality)
    const view = createPatangView(stage, sim.state.rivals.length)
    const input: PatangInput = { pull: false, steer: 0 }
    const h = held.current
    const s = sim.state
    /** What the HUD last showed: React is told only when something on it changes. */
    const shown = { left: ROUND_S, score: 0, over: false, cuts: 0 }
    const read = () => {
      input.pull = h.key || h.button
      input.steer = clamp1((h.right ? 1 : 0) - (h.left ? 1 : 0) + h.stick + h.drag)
    }
    /** Test hook only (`pause`): frames draw but do not move the round on. */
    let paused = false
    const off = stage.onFrame((dt) => {
      read()
      if (!paused) sim.update(input, dt)
      view.update(s, at, y)
      const left = Math.ceil(s.timeLeft)
      if (s.cutSeq !== shown.cuts) woKaata()
      if (left === shown.left && s.score === shown.score && s.over === shown.over && s.cutSeq === shown.cuts)
        return
      const finished = s.over && !shown.over
      shown.left = left
      shown.score = s.score
      shown.over = s.over
      shown.cuts = s.cutSeq
      if (finished) setBest(saveBest(s.score))
      setHud({ left, score: s.score, over: s.over, lost: s.cutByRival, cuts: s.cutSeq })
    })
    installTestHooks({
      patang: () => ({
        active: true,
        forceCross: () => sim.forceCross(),
        finish() {
          for (let i = 0; i < ROUND_S * 5 && !s.over; i++) sim.update({ pull: true, steer: 0 }, 0.25)
        },
        step(seconds) {
          read()
          for (let i = 0; i < Math.round(seconds * 30) && !s.over; i++) sim.update(input, 1 / 30)
        },
        pause(on) {
          paused = on
        },
        score: () => s.score,
        rivals: () => s.rivals.length,
        eyeY: () => stage.camera.position.y,
      }),
    })
    return () => {
      off()
      // leaving by Stop, Escape, Again or the festival ending keeps the cuts made so far
      saveBest(s.score)
      sim.dispose()
      view.dispose()
      installTestHooks({
        patang: () => ({
          active: false,
          forceCross() {},
          finish() {},
          step() {},
          pause() {},
          score: () => 0,
          rivals: () => 0,
          eyeY: () => 0,
        }),
      })
    }
  }, [stage, at, y, round])

  useEffect(() => {
    if (hud.over) again.current?.focus()
  }, [hud.over])
  // a new round: the button that was focused is gone, so the dialog takes focus
  useEffect(() => {
    if (round > 0) root.current?.focus()
  }, [round])

  const pullDown = (e: PointerEvent<HTMLButtonElement>) => {
    unlockAudio() // a tap: the browser lets the chirp's audio context run
    e.currentTarget.setPointerCapture(e.pointerId)
    held.current.button = true
  }
  const pullUp = () => void (held.current.button = false)
  const tap = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(tap.current), [])
  const dragFrom = useRef<{ id: number; x: number } | null>(null)

  const again1 = () => {
    held.current.button = false
    setHud({ left: ROUND_S, score: 0, over: false, lost: false, cuts: 0 })
    setRound((r) => r + 1)
  }

  return (
    <div
      ref={root}
      className="patang"
      role="dialog"
      aria-modal="true"
      aria-label={t('patangLabel', lang)}
      tabIndex={-1}
    >
      <div
        className="patang-sky"
        onPointerDown={(e) => {
          if (dragFrom.current || hud.over) return
          e.currentTarget.setPointerCapture(e.pointerId)
          dragFrom.current = { id: e.pointerId, x: e.clientX }
        }}
        onPointerMove={(e) => {
          const d = dragFrom.current
          if (d && d.id === e.pointerId) held.current.drag = clamp1((e.clientX - d.x) / DRAG_FULL)
        }}
        onPointerUp={() => {
          dragFrom.current = null
          held.current.drag = 0
        }}
        onPointerCancel={() => {
          dragFrom.current = null
          held.current.drag = 0
        }}
      />
      <div className="patang-top">
        <span className="hud-chip">{t('patangTime', lang, { n: hud.left })}</span>
        <span className="hud-chip">{t('patangCuts', lang, { n: hud.score })}</span>
        <button type="button" className="hud-chip patang-stop" onClick={onExit}>
          {t('patangStop', lang)}
        </button>
      </div>
      <div className="patang-flash" aria-live="polite">
        {hud.cuts > 0 && !hud.lost && (
          <span key={hud.cuts} className="patang-cut">
            {t('patangCut', lang)}
          </span>
        )}
      </div>
      {!hud.over && (
        <>
          <p className="patang-help">{t('patangHelp', lang)}</p>
          <div className="patang-controls">
            <Joystick lang={lang} onChange={(v) => void (held.current.stick = v.x)} />
            <button
              type="button"
              className="patang-pull"
              aria-keyshortcuts="Space"
              onPointerDown={pullDown}
              onPointerUp={pullUp}
              onPointerCancel={pullUp}
              onLostPointerCapture={pullUp}
              onClick={(e) => {
                // a click with no press before it (a screen reader's activate): pull for a moment
                if (e.detail !== 0) return
                held.current.button = true
                clearTimeout(tap.current)
                tap.current = setTimeout(() => void (held.current.button = false), TAP_PULL_MS)
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              {t('patangPull', lang)}
            </button>
          </div>
        </>
      )}
      {hud.over && (
        <div className="patang-score" role="status">
          <h2>{t(hud.lost ? 'patangLost' : 'patangTimeUp', lang)}</h2>
          <p className="patang-big">{t('patangCuts', lang, { n: hud.score })}</p>
          <p>{t('patangBest', lang, { n: best })}</p>
          <div className="patang-actions">
            <button ref={again} type="button" className="metro-button" onClick={again1}>
              {t('patangAgain', lang)}
            </button>
            <button type="button" className="metro-button patang-quit" onClick={onExit}>
              {t('patangStop', lang)}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
