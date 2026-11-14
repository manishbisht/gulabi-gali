import * as THREE from 'three'
import { useEffect, useRef, useState } from 'react'
import { createStage } from './engine/stage'
import { hasWebGL } from './engine/webgl'
import { useLang } from './i18n/lang'
import { fetchCity } from './net/api'
import type { CitySnapshot } from './net/protocol'
import { createControls, type Controls } from './player/controls'
import { loadOrCreateLook } from './player/avatar'
import { createPlayer } from './player/player'
import { PALETTE } from './world/palette'
import type { AABB } from './world/types'
import { Hud } from './ui/Hud'
import { Intro } from './ui/Intro'
import { Joystick } from './ui/Joystick'
import { NoWebGL } from './ui/NoWebGL'
import { installTestHooks } from './testHooks'

export default function App() {
  const [lang, setLang] = useLang()
  const [entered, setEntered] = useState(false)
  const [snapshot, setSnapshot] = useState<CitySnapshot | null>(null)
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
    // Stand-in dressing until the city lands: sky, sun and a flat lane to walk on.
    stage.scene.background = new THREE.Color(PALETTE.sandstone)
    stage.scene.add(new THREE.HemisphereLight(PALETTE.white, PALETTE.terracotta, 1.6))
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshLambertMaterial({ color: PALETTE.road }),
    )
    ground.rotation.x = -Math.PI / 2
    stage.scene.add(ground)

    const controls = createControls(window)
    controlsRef.current = controls
    const colliders: AABB[] = [] // Task 7 supplies the city's
    const player = createPlayer({
      scene: stage.scene,
      camera: stage.camera,
      controls,
      look: loadOrCreateLook(),
      colliders,
    })
    const offFrame = stage.onFrame((dt) => player.update(dt))
    installTestHooks({
      quality: () => stage.quality,
      framesSinceRestore: stage.framesSinceRestore,
      position: player.position,
      teleport: player.teleport,
    })
    return () => {
      offFrame()
      controls.dispose()
      controlsRef.current = null
      player.dispose()
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
      stage.dispose()
    }
  }, [entered])

  if (!webgl) return <NoWebGL lang={lang} />
  if (!entered) return <Intro lang={lang} onLang={setLang} onEnter={() => setEntered(true)} />
  return (
    <>
      <canvas ref={canvasRef} className="stage" />
      <Hud
        district="walled-city"
        snapshot={snapshot}
        lang={lang}
        onLang={setLang}
        bottom={<Joystick lang={lang} onChange={(v) => controlsRef.current?.setJoystick(v)} />}
      />
    </>
  )
}
