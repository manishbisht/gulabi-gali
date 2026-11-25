import { useEffect, useRef, useState } from 'react'
import type { Stage } from '../engine/stage'
import {
  createCricket,
  isOut,
  loadBest,
  MAX_BALLS,
  MAX_OUTS,
  saveBest,
  SIX_S,
  SIX_SLOW_S,
  tapSince,
  type Outcome,
} from '../games/cricket'
import { cricketSound, soundFor, wakeCricketSound } from '../games/cricketSound'
import { createCricketView } from '../games/cricketView'
import { t, type Lang, type StringKey } from '../i18n/strings'
import type { Controls } from '../player/controls'
import { installTestHooks } from '../testHooks'
import { cricketPlayed } from '../world/cricketPitch'
import type { PitchDef } from '../world/types'
import { inertRest } from './inertRest'
import { shareLink, SITE_URL } from './inviteShare'

export interface CricketProps {
  lang: Lang
  stage: Stage
  controls: Controls
  /** The pitch being played on. */
  pitch: PitchDef
  /** Hides the player's own body while the view is the batter's (and shows it again after). */
  onHide?: (hidden: boolean) => void
  onExit: () => void
}

const SAID: Record<Outcome, StringKey> = {
  six: 'cricketSix',
  four: 'cricketFour',
  two: 'cricketTwo',
  one: 'cricketOne',
  dot: 'cricketDot',
  bowled: 'cricketBowled',
  caught: 'cricketCaught',
}

const FRESH = {
  runs: 0,
  balls: 0,
  outs: 0,
  over: false,
  seq: 0,
  last: null as Outcome | null,
  arre: false,
  /** How long this ball's result is shown, in seconds. */
  hold: 1,
  /** Before the first ball: the bowler waits for a tap. */
  ready: true,
  /** A ball's result is being shown now. */
  showing: false,
  /** The bat has been swung this innings: the how-to has done its work. */
  swung: false,
}

/** Where focus goes when the game ends: the stage, which is not otherwise focusable. */
function stageEl(): HTMLElement | null {
  const canvas = document.querySelector<HTMLElement>('canvas')
  if (canvas && !canvas.hasAttribute('tabindex')) canvas.tabIndex = -1
  return canvas
}

const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Gali cricket, at the pitch in the lane. While it runs the player stands where they stood (the controls are
 * frozen, and they are there again when it ends), the rest of the page is inert and keys go only to the game
 * (Space swings, Escape leaves). One thumb plays it: a tap anywhere on the field is the swing. The simulation
 * is `createCricket`; this file feeds it taps and draws it, and nothing here allocates per frame.
 */
export default function Cricket({ lang, stage, controls, pitch, onHide, onExit }: CricketProps) {
  const root = useRef<HTMLDivElement>(null)
  const again = useRef<HTMLButtonElement>(null)
  const onExitRef = useRef(onExit)
  useEffect(() => void (onExitRef.current = onExit))
  /** The swing of the innings now being played (the tap's own moment, see `Cricket.swing`). */
  const swing = useRef<(stamp?: number, touch?: boolean) => void>(() => {})
  const [round, setRound] = useState(0)
  const [hud, setHud] = useState(FRESH)
  const [best, setBest] = useState(loadBest)
  /** This innings beat the best there was. */
  const [record, setRecord] = useState(false)
  const [shared, setShared] = useState<StringKey | null>(null)

  // the page around the game: inert, silent to the controls, and given back afterwards
  useEffect(() => {
    const el = root.current
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    el?.focus()
    controls.freeze(true)
    onHide?.(true)
    // (one that arrives meanwhile, a toast or a card, is made inert too)
    const release = inertRest(el?.parentElement, (n) => n === el)
    const onButton = (e: KeyboardEvent) =>
      !!(e.target as Element | null)?.closest?.('button:not(.cricket-field)')
    // the city listens on the window: nothing but Tab gets past here while the game is up
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return
      e.stopImmediatePropagation()
      if (e.key === 'Escape') return onExitRef.current()
      // Space swings, except on a focused button (Stop, Again, Share), which it presses as it always does
      if (e.code !== 'Space' || onButton(e)) return
      e.preventDefault()
      if (!e.repeat) swing.current(e.timeStamp)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !onButton(e)) e.preventDefault() // never also a click on the field
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      release()
      onHide?.(false)
      controls.freeze(false)
      const back = before && before.isConnected && before !== document.body ? before : stageEl()
      back?.focus()
    }
  }, [controls, onHide])

  // one innings: the simulation and its drawing, from the first run-up to the score
  useEffect(() => {
    // a slow phone (the lowest tier, about 30 frames a second) gets a six window wider than one of its frames
    const sim = createCricket((Math.random() * 2 ** 32) >>> 0, {
      six: stage.quality === 0 ? SIX_SLOW_S : SIX_S,
    })
    // the lowest tier draws no fielders; reduced motion keeps the view still
    const view = createCricketView(stage, pitch, { extras: stage.quality > 0, calm: calm() })
    const s = sim.state
    const before = loadBest()
    /** What the HUD last showed: React is told only when something on it changes. */
    const shown = { seq: 0, over: false, ready: true, showing: false, swung: false }
    /** Test hook only (`pause`): frames draw but do not move the innings on. */
    let paused = false
    let frameAt = performance.now()
    const tell = () => {
      if (s.seq !== shown.seq) {
        const sound = soundFor(s.last!, s.arre)
        if (sound) cricketSound(sound)
      }
      const ready = s.phase === 'ready'
      const showing = s.phase === 'result'
      const swung = s.swings > 0
      if (
        s.seq === shown.seq &&
        s.over === shown.over &&
        ready === shown.ready &&
        showing === shown.showing &&
        swung === shown.swung
      )
        return
      const finished = s.over && !shown.over
      shown.seq = s.seq
      shown.over = s.over
      shown.ready = ready
      shown.showing = showing
      shown.swung = swung
      if (finished) {
        setBest(saveBest(s.runs))
        setRecord(s.runs > before)
        cricketPlayed(s.runs)
      }
      setHud({
        runs: s.runs,
        balls: s.balls,
        outs: s.outs,
        over: s.over,
        seq: s.seq,
        last: s.last,
        arre: s.arre,
        hold: s.hold,
        ready,
        showing,
        swung,
      })
    }
    swing.current = (stamp, touch = false) => {
      wakeCricketSound() // a tap: the browser lets the game's sounds run
      // the tap's own moment: its event's time stamp against the last frame's, not whenever this ran
      sim.swing(paused || stamp === undefined ? 0 : tapSince(stamp, frameAt, touch))
      tell()
    }
    const off = stage.onFrame((dt) => {
      frameAt = performance.now()
      if (!paused) sim.update(dt)
      view.update(s, dt)
      tell()
    })
    /** Steps the innings on at once, in steady 1/120 s steps, until `done` (or a minute of game time). */
    const stepUntil = (done: () => boolean) => {
      for (let i = 0; i < 120 * 90 && !done() && !s.over; i++) sim.update(1 / 120)
    }
    const playBall = (err: number | null) => {
      stepUntil(() => s.phase !== 'result')
      const seq = s.seq
      if (err !== null) {
        const to = sim.untilBat() + err
        for (let i = 0; i < Math.round(to * 120); i++) sim.update(1 / 120)
        sim.swing()
      }
      stepUntil(() => s.seq !== seq)
    }
    installTestHooks({
      cricket: () => ({
        active: true,
        ball(err) {
          playBall(err)
          tell()
        },
        finish() {
          while (!s.over) {
            playBall(null)
            stepUntil(() => s.phase !== 'result')
          }
          tell()
        },
        tapAtBat() {
          stepUntil(() => s.phase === 'flight')
          const steps = Math.round(sim.untilBat() * 120)
          for (let i = 0; i < steps; i++) sim.update(1 / 120)
        },
        pause(on) {
          paused = on
        },
        runs: () => s.runs,
        balls: () => s.balls,
        outs: () => s.outs,
        last: () => s.last,
        eye: () => ({ x: stage.camera.position.x, y: stage.camera.position.y, z: stage.camera.position.z }),
        fielders: () => view.fielders,
      }),
    })
    return () => {
      off()
      swing.current = () => {}
      // leaving by Stop, Escape or Again keeps the runs made so far
      saveBest(s.runs)
      sim.dispose()
      view.dispose()
      installTestHooks({
        cricket: () => ({
          active: false,
          ball() {},
          finish() {},
          tapAtBat() {},
          pause() {},
          runs: () => 0,
          balls: () => 0,
          outs: () => 0,
          last: () => null,
          eye: () => ({ x: 0, y: 0, z: 0 }),
          fielders: () => 0,
        }),
      })
    }
  }, [stage, pitch, round])

  useEffect(() => {
    if (hud.over) again.current?.focus()
  }, [hud.over])
  // a new innings: the button that was focused is gone, so the dialog takes focus
  useEffect(() => {
    if (round > 0) root.current?.focus()
  }, [round])

  const again1 = () => {
    setHud(FRESH)
    setRecord(false)
    setShared(null)
    setRound((r) => r + 1)
  }
  const share = async () => {
    const how = await shareLink(t('cricketShareText', lang, { n: hud.runs }), SITE_URL)
    setShared(how === 'copied' ? 'placeCopied' : how === 'failed' ? 'cricketShareFailed' : null)
  }
  // what came of the ball shows for as long as its result does, and is gone when the next run-up starts
  // (with reduced motion nothing fades it out, so it must not be left standing)
  const flash = hud.showing && !hud.over && hud.last

  return (
    <div
      ref={root}
      className="cricket"
      role="dialog"
      aria-modal="true"
      aria-label={t('cricketLabel', lang)}
      tabIndex={-1}
    >
      {!hud.over && (
        <button
          type="button"
          className="cricket-field"
          aria-label={t('cricketSwing', lang)}
          aria-keyshortcuts="Space"
          onPointerDown={(e) => {
            if (e.button > 0) return
            swing.current(e.timeStamp, e.pointerType === 'touch')
          }}
          onClick={(e) => {
            // a click with no press before it (a screen reader's activate, Enter): a swing too
            if (e.detail === 0) swing.current(e.timeStamp)
          }}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}
      <div className="cricket-top">
        <span className="hud-chip">{t('cricketRuns', lang, { n: hud.runs })}</span>
        <span className="hud-chip">
          {t('cricketBalls', lang, {
            n: Math.min(hud.balls + (hud.over ? 0 : 1), MAX_BALLS),
            total: MAX_BALLS,
          })}
        </span>
        <span className="hud-chip">{t('cricketOuts', lang, { n: hud.outs, total: MAX_OUTS })}</span>
        <button type="button" className="cricket-stop" aria-label={t('cricketStop', lang)} onClick={onExit}>
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      <div className="cricket-flash" aria-live="polite">
        {flash && (
          <span
            key={hud.seq}
            className="cricket-said"
            data-out={isOut(flash) || undefined}
            style={{ animationDuration: `${hud.hold}s` }}
          >
            {t(SAID[flash], lang)}
            {hud.arre && <small>{t('cricketArre', lang)}</small>}
          </span>
        )}
      </div>
      {hud.ready && !hud.over && <p className="cricket-ready">{t('cricketReady', lang)}</p>}
      {/* the how-to stays until the bat has been swung once */}
      {!hud.over && !hud.swung && <p className="cricket-help">{t('cricketHelp', lang)}</p>}
      {hud.over && (
        <div className="cricket-score" role="status">
          <h2>{t(hud.outs >= MAX_OUTS ? 'cricketAllOut' : 'cricketOvers', lang)}</h2>
          <p className="cricket-big">{t('cricketRuns', lang, { n: hud.runs })}</p>
          <p>
            {t('cricketBest', lang, { n: best })}
            {record && <strong className="cricket-record"> {t('cricketRecord', lang)}</strong>}
          </p>
          <div className="cricket-actions">
            <button ref={again} type="button" className="metro-button" onClick={again1}>
              {t('cricketAgain', lang)}
            </button>
            <button type="button" className="metro-button cricket-quiet" onClick={() => void share()}>
              {t('cricketShare', lang)}
            </button>
            <button type="button" className="metro-button cricket-quiet" onClick={onExit}>
              {t('cricketDone', lang)}
            </button>
          </div>
          <p className="cricket-shared" aria-live="polite">
            {shared && t(shared, lang)}
          </p>
        </div>
      )}
    </div>
  )
}
