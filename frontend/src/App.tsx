import * as THREE from 'three'
import { useEffect, useRef, useState } from 'react'
import { createStage, type QualityTier } from './engine/stage'
import { hasWebGL } from './engine/webgl'
import { useLang } from './i18n/lang'
import { t, type StringKey } from './i18n/strings'
import { cityLine } from './live/cityLine'
import { applySky, skyParams, type SkyParams } from './live/sky'
import { useLiveCity } from './live/useLiveCity'
import { createFestivalFx, festivalSky } from './live/festivalFx'
import { createWeatherFx } from './live/weatherFx'
import { createControls, type Controls } from './player/controls'
import { loadOrCreateLook } from './player/avatar'
import { createPlayer } from './player/player'
import { loadDistrict } from './world/district'
import { createBubbles } from './world/npcBubbles'
import { createNpcs } from './world/npcs'
import { useNpcCard } from './world/useNpcCard'
import { TOTAL_STAMPS } from './world/stamps'
import { useStamps } from './world/useStamps'
import type { FestivalId } from './net/protocol'
import type { DistrictDef } from './world/types'
import { Hud } from './ui/Hud'
import { Intro } from './ui/Intro'
import { LandmarkCard } from './ui/LandmarkCard'
import { Joystick } from './ui/Joystick'
import { NpcCard } from './ui/NpcCard'
import { NoWebGL } from './ui/NoWebGL'
import { installTestHooks } from './testHooks'

/** A hazy Jaipur blue, until the live sky (weather and time of day) paints it. */
const SKY = '#BFD6DE'
/** The sun moves slowly; the sky is recomputed from the clock this often. */
const SKY_REFRESH_MS = 30_000
/** A tap moves less than this many px and lasts less than this many ms. */
const TAP_SLOP = 10
const TAP_MS = 500
const FESTIVALS: Record<FestivalId, StringKey> = {
  sankranti: 'festivalSankranti',
  holi: 'festivalHoli',
  gangaur: 'festivalGangaur',
  teej: 'festivalTeej',
  diwali: 'festivalDiwali',
  jlf: 'festivalJlf',
}

/** `?gg-festival=<id>` stands in for the live festival, in test mode only. */
function festivalOverride(): FestivalId | null {
  const q = new URLSearchParams(location.search)
  const id = q.get('gg-festival')
  return q.get('gg-test') === '1' && id && id in FESTIVALS ? (id as FestivalId) : null
}

export default function App() {
  const [lang, setLang] = useLang()
  const [entered, setEntered] = useState(false)
  const [place, setPlace] = useState<DistrictDef['name'] | 'loading' | 'failed'>('loading')
  const [webgl] = useState(hasWebGL)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controlsRef = useRef<Controls | null>(null)
  const { near, have, toast, collectHere, track } = useStamps(lang)
  const { npc: talking, open: openNpc, close: closeNpc, isOpen: npcOpen, step: stepNpc } = useNpcCard()
  const bubbleHost = useRef<HTMLDivElement>(null)
  const langRef = useRef(lang)
  useEffect(() => {
    langRef.current = lang
  }, [lang])
  const { snapshot, current, now, patch, freeze } = useLiveCity()
  /** Re-paints the sky from the current snapshot and clock; set once the district is in. */
  const repaint = useRef<() => void>(() => {})
  useEffect(() => repaint.current(), [snapshot])
  const [override] = useState(festivalOverride)
  const festival = override ?? snapshot?.festival ?? null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!entered || !canvas) return
    const stage = createStage(canvas)
    stage.scene.background = new THREE.Color(SKY) // until the live sky takes over
    const controls = createControls(window)
    controlsRef.current = controls
    let cancelled = false
    let leave = () => {}

    loadDistrict('walled-city').then(
      (district) => {
        if (cancelled) return district.dispose()
        stage.scene.add(district.root)
        // Shadows are the first thing a slow phone gives up.
        const shadows = (q: QualityTier) => void (district.lights.sun.castShadow = q === 2)
        shadows(stage.quality)
        const offQuality = stage.onQuality((q) => {
          shadows(q)
          festivalFx.set(festivalNow(), q)
        })
        const player = createPlayer({
          scene: stage.scene,
          camera: stage.camera,
          controls,
          look: loadOrCreateLook(),
          colliders: district.colliders,
          occluders: district.occluders,
        })
        player.teleport(district.def.spawn.x, district.def.spawn.z)
        const fx = createWeatherFx(stage)
        const festivalFx = createFestivalFx(stage, district)
        const festivalNow = () => override ?? current().festival
        let sky: SkyParams | null = null
        const paint = () => {
          sky = festivalSky(skyParams(current(), now()), festivalNow(), current().sunset, now())
          applySky(stage, district, sky)
          fx.set(sky)
          festivalFx.set(festivalNow(), stage.quality)
        }
        repaint.current = paint
        paint()
        const skyTimer = setInterval(paint, SKY_REFRESH_MS)
        const npcs = createNpcs(district.def.npcs, stage.scene)
        const bubbles = createBubbles(bubbleHost.current!)
        // A tap, not a drag: the pointer barely moved. Taps that start on the joystick, card or HUD
        // buttons never reach the canvas, since those capture their own pointers.
        const ray = new THREE.Raycaster()
        let down: { x: number; y: number; at: number } | null = null
        const onDown = (e: PointerEvent) => void (down = { x: e.clientX, y: e.clientY, at: e.timeStamp })
        const onUp = (e: PointerEvent) => {
          const d = down
          down = null
          if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP || e.timeStamp - d.at > TAP_MS)
            return
          const r = canvas.getBoundingClientRect()
          ray.setFromCamera(
            new THREE.Vector2(
              ((e.clientX - r.left) / r.width) * 2 - 1,
              -((e.clientY - r.top) / r.height) * 2 + 1,
            ),
            stage.camera,
          )
          const hit = npcs.pick(ray)
          if (hit) openNpc(hit)
        }
        canvas.addEventListener('pointerdown', onDown)
        canvas.addEventListener('pointerup', onUp)
        const offFrame = stage.onFrame((dt) => {
          player.update(dt)
          npcs.update(dt)
          fx.update(dt)
          festivalFx.update(dt)
          district.focus(player.position())
          const pos = player.position()
          const pressed = controls.interact()
          const landmark = track(pos, district.def.landmarks, pressed && !npcOpen())
          stepNpc(pos, npcs, pressed, landmark !== null)
          bubbles.update(stage.camera, npcs, pos, langRef.current)
        })
        setPlace(district.def.name)
        installTestHooks({
          quality: () => stage.quality,
          framesSinceRestore: stage.framesSinceRestore,
          position: player.position,
          teleport: player.teleport,
          district: () => district.def.id,
          npcs: () =>
            npcs.entries.map(({ def, body }) => {
              const p = body.position.clone().setY(1.2).project(stage.camera)
              return {
                id: def.id,
                x: body.position.x,
                z: body.position.z,
                sx: ((p.x + 1) / 2) * innerWidth,
                sy: ((1 - p.y) / 2) * innerHeight,
              }
            }),
          festival: festivalNow,
          sky: () => sky!,
          setSnapshot: (partial) => {
            patch(partial)
            paint()
          },
          setNow: (iso) => {
            freeze(iso)
            paint()
          },
        })
        leave = () => {
          clearInterval(skyTimer)
          repaint.current = () => {}
          fx.dispose()
          festivalFx.dispose()
          offFrame()
          canvas.removeEventListener('pointerdown', onDown)
          canvas.removeEventListener('pointerup', onUp)
          bubbles.dispose()
          npcs.dispose()
          closeNpc()
          offQuality()
          player.dispose()
          district.dispose()
        }
      },
      () => {
        if (!cancelled) setPlace('failed')
      },
    )

    return () => {
      cancelled = true
      leave()
      controls.dispose()
      controlsRef.current = null
      stage.dispose()
    }
  }, [entered, track, openNpc, closeNpc, npcOpen, stepNpc, current, now, patch, freeze, override])

  if (!webgl) return <NoWebGL lang={lang} />
  if (!entered) return <Intro lang={lang} onLang={setLang} onEnter={() => setEntered(true)} />
  return (
    <>
      <canvas ref={canvasRef} className="stage" />
      <div ref={bubbleHost} className="npc-bubbles" aria-hidden="true" />
      <Hud
        place={
          typeof place === 'string' ? t(place === 'failed' ? 'loadFailed' : 'loading', lang) : place[lang]
        }
        snapshot={snapshot}
        line={snapshot && !snapshot.stale ? cityLine(snapshot, lang) : undefined}
        banner={festival ? t(FESTIVALS[festival], lang) : undefined}
        stamps={`${have.length}/${TOTAL_STAMPS}`}
        lang={lang}
        onLang={setLang}
        top={
          toast && (
            <div className="toast" role="status">
              {toast}
            </div>
          )
        }
        bottom={
          <>
            <Joystick lang={lang} onChange={(v) => controlsRef.current?.setJoystick(v)} />
            {talking && <NpcCard npc={talking} lang={lang} onClose={closeNpc} />}
            {near && !talking && (
              <LandmarkCard
                landmark={near}
                lang={lang}
                stamped={have.includes(near.id)}
                onCollect={collectHere}
              />
            )}
          </>
        }
      />
    </>
  )
}
