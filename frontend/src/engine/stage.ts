import * as THREE from 'three'

export type QualityTier = 0 | 1 | 2

export interface Stage {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  quality: QualityTier
  /** Runs every drawn frame with seconds since the last one, clamped to [0, 0.1]. */
  onFrame(cb: (dt: number) => void): () => void
  /** Runs when the quality tier steps down. */
  onQuality(cb: (q: QualityTier) => void): () => void
  /** Frames drawn since the WebGL context was last restored (or since start). */
  framesSinceRestore(): number
  dispose(): void
}

/** Frame time in ms to seconds, capped so coming back from a background tab cannot fling the player. */
export function clampDelta(ms: number): number {
  return Math.min(Math.max(ms / 1000, 0), 0.1)
}

const QUALITY_KEY = 'gg-quality'
/** Vertical field of view, in degrees: landscape screens, and phones held upright. */
const FOV = 60
const PORTRAIT_FOV = 70
/** Pixel ratio ceiling per tier. */
const RATIO_CAP: Record<QualityTier, number> = { 2: 2, 1: 1.25, 0: 1 }

/** A device that was slow once will be slow again this session; start where it ended up. */
function readQuality(): QualityTier {
  try {
    // Read as a string: Number(null) is 0, which would start every visit at the lowest tier.
    const saved = sessionStorage.getItem(QUALITY_KEY)
    return saved === '0' ? 0 : saved === '1' ? 1 : 2
  } catch {
    return 2
  }
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.shadowMap.type = THREE.PCFShadowMap
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400)

  const frameListeners = new Set<(dt: number) => void>()
  const qualityListeners = new Set<(q: QualityTier) => void>()
  let quality = readQuality()
  let frame = 0
  let last = 0
  let lost = false
  let disposed = false
  let sinceRestore = 0
  let slow = 0
  let sampled = 0

  function resize() {
    const width = window.innerWidth
    const height = window.innerHeight
    if (!width || !height) return
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, RATIO_CAP[quality]))
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    // A phone held upright sees a narrow slice of street; open the lens a little so a lane fits.
    camera.fov = camera.aspect < 1 ? PORTRAIT_FOV : FOV
    camera.updateProjectionMatrix()
  }

  /*
   * Adaptive quality. The city draws every frame, so every frame is measured:
   * if over 60% of ~2.5 s of frames took longer than 22 ms (under ~45 fps) it
   * steps one tier down. It never steps back up within a tab session; flapping
   * between tiers looks worse than either one.
   */
  function measure(delta: number) {
    if (quality === 0 || delta > 250) return // 250+: a stall or a tab coming back, not sustained slowness
    sampled += delta
    if (delta > 22) slow += delta
    if (sampled < 2500) return
    const tooSlow = slow / sampled > 0.6
    slow = sampled = 0
    if (tooSlow) applyQuality((quality - 1) as QualityTier)
  }

  function applyQuality(tier: QualityTier) {
    quality = tier
    try {
      sessionStorage.setItem(QUALITY_KEY, String(tier))
    } catch {
      // Only this stage remembers it then.
    }
    const shadows = tier > 0
    if (renderer.shadowMap.enabled !== shadows) {
      renderer.shadowMap.enabled = shadows
      // Materials compiled with shadow code must be rebuilt without it.
      scene.traverse((object) => {
        const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
        if (material) for (const m of Array.isArray(material) ? material : [material]) m.needsUpdate = true
      })
    }
    resize()
    for (const cb of qualityListeners) cb(tier)
  }

  function tick(now: number) {
    if (disposed) return
    frame = requestAnimationFrame(tick)
    const delta = now - last
    last = now
    if (lost) return
    const dt = clampDelta(delta)
    for (const cb of frameListeners) cb(dt)
    renderer.render(scene, camera)
    sinceRestore++
    measure(delta)
  }

  function start() {
    cancelAnimationFrame(frame)
    last = performance.now()
    slow = sampled = 0
    frame = requestAnimationFrame(tick)
  }

  const onVisibility = () => {
    if (document.hidden) cancelAnimationFrame(frame)
    else if (!disposed) start()
  }
  const onLost = (event: Event) => {
    // Without preventDefault the browser never offers the context back.
    event.preventDefault()
    lost = true
  }
  const onRestored = () => {
    // three.js re-creates its GL state and re-uploads resources itself; we re-fit and start counting again.
    lost = false
    sinceRestore = 0
    slow = sampled = 0
    resize()
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('resize', resize)
  // Phones report the old window size for a moment after rotating; fit again once it settles.
  let settle = 0
  const onOrientation = () => {
    resize()
    clearTimeout(settle)
    settle = window.setTimeout(resize, 250)
  }
  window.addEventListener('orientationchange', onOrientation)

  applyQuality(quality)
  if (!document.hidden) start()

  return {
    scene,
    camera,
    renderer,
    get quality() {
      return quality
    },
    onFrame(cb) {
      frameListeners.add(cb)
      return () => void frameListeners.delete(cb)
    },
    onQuality(cb) {
      qualityListeners.add(cb)
      return () => void qualityListeners.delete(cb)
    },
    framesSinceRestore: () => sinceRestore,
    dispose() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(frame)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', resize)
      window.removeEventListener('orientationchange', onOrientation)
      clearTimeout(settle)
      renderer.dispose()
    },
  }
}
