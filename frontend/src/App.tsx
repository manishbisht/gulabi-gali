import * as THREE from 'three'
import { useEffect, useRef, useState } from 'react'
import { createStage, type QualityTier } from './engine/stage'
import { hasWebGL } from './engine/webgl'
import { useLang } from './i18n/lang'
import { t } from './i18n/strings'
import { cityLine } from './live/cityLine'
import { applySky, skyParams, type SkyParams } from './live/sky'
import { useLiveCity } from './live/useLiveCity'
import { createWeatherFx } from './live/weatherFx'
import { createControls, type Controls } from './player/controls'
import { loadOrCreateLook } from './player/avatar'
import { createPlayer } from './player/player'
import { loadDistrict } from './world/district'
import { TOTAL_STAMPS } from './world/stamps'
import { useStamps } from './world/useStamps'
import type { DistrictDef } from './world/types'
import { Hud } from './ui/Hud'
import { Intro } from './ui/Intro'
import { LandmarkCard } from './ui/LandmarkCard'
import { Joystick } from './ui/Joystick'
import { NoWebGL } from './ui/NoWebGL'
import { installTestHooks } from './testHooks'

/** A hazy Jaipur blue, until the live sky (weather and time of day) paints it. */
const SKY = '#BFD6DE'
/** The sun moves slowly; the sky is recomputed from the clock this often. */
const SKY_REFRESH_MS = 30_000

export default function App() {
  const [lang, setLang] = useLang()
  const [entered, setEntered] = useState(false)
  const [place, setPlace] = useState<DistrictDef['name'] | 'loading' | 'failed'>('loading')
  const [webgl] = useState(hasWebGL)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controlsRef = useRef<Controls | null>(null)
  const { near, have, toast, collectHere, track } = useStamps(lang)
  const { snapshot, current, now, patch, freeze } = useLiveCity()
  /** Re-paints the sky from the current snapshot and clock; set once the district is in. */
  const repaint = useRef<() => void>(() => {})
  useEffect(() => repaint.current(), [snapshot])

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
        const offQuality = stage.onQuality(shadows)
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
        let sky: SkyParams | null = null
        const paint = () => {
          sky = skyParams(current(), now())
          applySky(stage, district, sky)
          fx.set(sky)
        }
        repaint.current = paint
        paint()
        const skyTimer = setInterval(paint, SKY_REFRESH_MS)
        const offFrame = stage.onFrame((dt) => {
          player.update(dt)
          fx.update(dt)
          district.focus(player.position())
          track(player.position(), district.def.landmarks, controls)
        })
        setPlace(district.def.name)
        installTestHooks({
          quality: () => stage.quality,
          framesSinceRestore: stage.framesSinceRestore,
          position: player.position,
          teleport: player.teleport,
          district: () => district.def.id,
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
          offFrame()
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
  }, [entered, track, current, now, patch, freeze])

  if (!webgl) return <NoWebGL lang={lang} />
  if (!entered) return <Intro lang={lang} onLang={setLang} onEnter={() => setEntered(true)} />
  return (
    <>
      <canvas ref={canvasRef} className="stage" />
      <Hud
        place={
          typeof place === 'string' ? t(place === 'failed' ? 'loadFailed' : 'loading', lang) : place[lang]
        }
        snapshot={snapshot}
        line={snapshot && !snapshot.stale ? cityLine(snapshot, lang) : undefined}
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
            {near && (
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
