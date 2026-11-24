import * as THREE from 'three'
import { avatarMaterial, buildBodyGeometry } from '../player/avatar'
import { PALETTE } from '../world/palette'
import type { AvatarLook } from '../world/types'

export interface LookPreview {
  /** Dresses the figure in `look`. */
  show(look: AvatarLook): void
  /** Turns the figure by `radians` (a drag, or the arrow keys). */
  turn(radians: number): void
  /** Stops drawing and frees the context, its geometry and material. Safe to call twice. */
  dispose(): void
}

/** Turns per second, when motion is welcome. */
const SPIN = 0.5

/**
 * The dressing room's turning figure, on a small canvas of its own: its own renderer, scene, geometry and
 * material, all freed (and the context let go) on `dispose`, so nothing is shared with the city's stage. Lit as
 * the street is. With reduced motion it stands still at three-quarters until turned. Null when the browser
 * cannot give a WebGL context (the editor then shows the flat figure).
 */
export function createLookPreview(
  canvas: HTMLCanvasElement,
  look: AvatarLook,
  reducedMotion: boolean,
): LookPreview | null {
  let renderer: THREE.WebGLRenderer
  try {
    const attributes = { antialias: true, alpha: true, powerPreference: 'low-power' } as const
    const context = canvas.getContext('webgl2', attributes) as WebGL2RenderingContext | null
    if (!context) return null
    renderer = new THREE.WebGLRenderer({ canvas, context, ...attributes })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight('#E4EEF4', PALETTE.sandstone, 1.6))
  const sun = new THREE.DirectionalLight('#FFF7EE', 2.2)
  sun.position.set(2, 4, 3)
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20)
  camera.position.set(0, 1.35, 4.6)
  camera.lookAt(0, 1.08, 0)
  const material = avatarMaterial()
  const figure = new THREE.Mesh(buildBodyGeometry(look), material)
  figure.rotation.y = 0.6 // three-quarters, facing the viewer's left
  scene.add(figure)

  let raf = 0
  let last = 0
  let dirty = true
  let lost = false
  let disposed = false

  let fitW = 0
  let fitH = 0
  const fit = () => {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h || (w === fitW && h === fitH)) return
    fitW = w
    fitH = h
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    dirty = true
  }

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
    last = now
    if (lost) return
    if (!reducedMotion) {
      figure.rotation.y += SPIN * dt
      dirty = true
    }
    fit()
    if (!dirty) return
    dirty = false
    renderer.render(scene, camera)
  }
  const onLost = (e: Event) => {
    e.preventDefault()
    lost = true
  }
  const onRestored = () => {
    lost = false
    dirty = true
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)
  raf = requestAnimationFrame(frame)

  return {
    show(next) {
      if (disposed) return
      const old = figure.geometry
      figure.geometry = buildBodyGeometry(next)
      old.dispose()
      dirty = true
    },
    turn(radians) {
      figure.rotation.y += radians
      dirty = true
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(raf)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      figure.geometry.dispose()
      material.dispose()
      renderer.dispose()
      // let the context go now, not whenever the canvas is collected: a phone may only hold a few
      renderer.forceContextLoss()
    },
  }
}
