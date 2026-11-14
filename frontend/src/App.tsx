import * as THREE from 'three'
import { useEffect, useRef, useState } from 'react'
import { createStage, type QualityTier } from './engine/stage'
import { hasWebGL } from './engine/webgl'
import { useLang } from './i18n/lang'
import { t } from './i18n/strings'
import { fetchCity } from './net/api'
import type { CitySnapshot } from './net/protocol'
import { createControls, type Controls } from './player/controls'
import { loadOrCreateLook } from './player/avatar'
import { createPlayer } from './player/player'
import { loadDistrict } from './world/district'
import type { DistrictDef } from './world/types'
import { Hud } from './ui/Hud'
import { Intro } from './ui/Intro'
import { Joystick } from './ui/Joystick'
import { NoWebGL } from './ui/NoWebGL'
import { installTestHooks } from './testHooks'

/** A hazy Jaipur blue, until the live sky (weather and time of day) paints it. */
const SKY = '#BFD6DE'

export default function App() {
  const [lang, setLang] = useLang()
  const [entered, setEntered] = useState(false)
  const [snapshot, setSnapshot] = useState<CitySnapshot | null>(null)
  const [place, setPlace] = useState<DistrictDef['name'] | 'loading' | 'failed'>('loading')
  const [webgl] = useState(hasWebGL)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controlsRef = useRef<Controls | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetchCity(controller.signal).then((s) => {
      if (!controller.signal.aborted) setSnapshot(s)
    })
    return () => controller.abort()
  }, [])

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
        const offFrame = stage.onFrame((dt) => {
          player.update(dt)
          district.focus(player.position())
        })
        setPlace(district.def.name)
        installTestHooks({
          quality: () => stage.quality,
          framesSinceRestore: stage.framesSinceRestore,
          position: player.position,
          teleport: player.teleport,
          district: () => district.def.id,
        })
        leave = () => {
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
  }, [entered])

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
        lang={lang}
        onLang={setLang}
        bottom={<Joystick lang={lang} onChange={(v) => controlsRef.current?.setJoystick(v)} />}
      />
    </>
  )
}
