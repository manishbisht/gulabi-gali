import * as THREE from 'three'
import { beaconError } from '../net/errorBeacon'
import { testRenderLite } from '../testHooks'

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
  /**
   * Draws one frame at the device's pixel ratio and runs `read` on the canvas straight away (it must copy or
   * encode synchronously: the drawing buffer is only good until this task ends), then goes back to the tier's
   * ratio. No `preserveDrawingBuffer`: that would cost every frame on a phone. `minRatio` asks for at least that
   * ratio (a postcard cut from a low-ratio screen), still capped at the photo ceiling, and only on the top tier (a device stepped down keeps its own ratio).
   */
  capture<T>(read: (canvas: HTMLCanvasElement) => T, minRatio?: number): T
  /** Frames drawn since the WebGL context was last restored (or since start). */
  framesSinceRestore(): number
  /** Seconds of game time the frames have run: the sum of their clamped dts, so slow frames count less than the wall clock. */
  gameTime(): number
  /**
   * Starts a warm-up (about 2 s of frames) in which frame times are not measured for quality: a district has just
   * opened, and its shader compiles and texture uploads are a burst, not a slow phone.
   */
  settle(): void
  dispose(): void
}

/** Frame time in ms to seconds, capped so coming back from a background tab cannot fling the player. */
export function clampDelta(ms: number): number {
  if (!Number.isFinite(ms)) return 0
  return Math.min(Math.max(ms / 1000, 0), 0.1)
}

/** The most one frame can add to the quality window: a longer one is a hitch, and still counts as this much. */
const HITCH_MS = 600
/** Slow frames a window needs before it can step down; two hitches alone are not a slow device. */
const MIN_SLOW_FRAMES = 4
/** Frame time, in ms, after a start, a district load or a context restore that is not measured for quality. */
const WARMUP_MS = 2000
/** Length of one quality window, in ms of frames. */
const WINDOW_MS = 2000
/** Bad windows in a row before a step down: one burst fills one window, a slow phone fills every window. */
const BAD_WINDOWS = 2
const QUALITY_KEY = 'gg-quality'
/** Vertical field of view, in degrees: landscape screens, and phones held upright. */
const FOV = 60
const PORTRAIT_FOV = 70
/** Pixel ratio ceiling per tier. */
const RATIO_CAP: Record<QualityTier, number> = { 2: 2, 1: 1.25, 0: 1 }
/** A test page's pixel ratio (see `testRenderLite`): a quarter of the CSS size each way, whatever the tier. */
const LITE_RATIO = 0.25
/** A photo's pixel ratio ceiling: enough for a phone's screen, and a canvas a phone can still hold. */
const PHOTO_RATIO_CAP = 3

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
  const lite = testRenderLite()
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite, powerPreference: 'high-performance' })
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
  let gameClock = 0
  let slow = 0
  let slowFrames = 0
  let badWindows = 0
  let warmup = WARMUP_MS
  let sampled = 0

  /** The size last fitted, in CSS px: a capture draws at this and goes back to it. */
  let fitW = 0
  let fitH = 0
  const tierRatio = () => (lite ? LITE_RATIO : Math.min(window.devicePixelRatio, RATIO_CAP[quality]))

  function resize() {
    const width = window.innerWidth
    const height = window.innerHeight
    if (!width || !height) return
    fitW = width
    fitH = height
    renderer.setPixelRatio(tierRatio())
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    // A phone held upright sees a narrow slice of street; open the lens a little so a lane fits.
    camera.fov = camera.aspect < 1 ? PORTRAIT_FOV : FOV
    camera.updateProjectionMatrix()
  }

  /*
   * Adaptive quality. The city draws every frame, so every frame is measured:
   * if over 60% of ~2 s of frames took longer than 22 ms (under ~45 fps) it
   * steps one tier down. It never steps back up within a tab session; flapping
   * between tiers looks worse than either one.
   * A very long frame is clamped (to HITCH_MS), not skipped: a phone at 2 to 4 fps
   * must still step down. One hitch (a tab switch, a GC pause, a district load)
   * cannot, because it is at most HITCH_MS of the ~2 s window and the window
   * also needs MIN_SLOW_FRAMES slow frames.
   */
  function measure(delta: number) {
    if (quality === 0) return
    const ms = Math.min(delta, HITCH_MS)
    if (warmup > 0) {
      warmup -= ms
      return
    }
    sampled += ms
    if (ms > 22) {
      slow += ms
      slowFrames++
    }
    if (sampled < WINDOW_MS) return
    const tooSlow = slow / sampled > 0.6 && slowFrames >= MIN_SLOW_FRAMES
    slow = sampled = slowFrames = 0
    badWindows = tooSlow ? badWindows + 1 : 0
    if (badWindows >= BAD_WINDOWS) {
      applyQuality((quality - 1) as QualityTier)
      warmUp() // the new pixel ratio and shadow setting recompile things
    }
  }

  /** Forget the window so far and skip the next WARMUP_MS of frames. */
  function warmUp() {
    slow = sampled = slowFrames = badWindows = 0
    warmup = WARMUP_MS
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
    gameClock += dt
    for (const cb of frameListeners) cb(dt)
    renderer.render(scene, camera)
    sinceRestore++
    measure(delta)
  }

  function start() {
    cancelAnimationFrame(frame)
    last = performance.now()
    warmUp()
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
    // how often phones drop the GPU is worth knowing (our own dispose removes this listener first)
    beaconError('webgl-lost', 'WebGL context lost')
  }
  const onRestored = () => {
    // three.js re-creates its GL state and re-uploads resources itself; we re-fit and start counting again.
    lost = false
    sinceRestore = 0
    warmUp()
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
    capture(read, minRatio = 0) {
      const gone = () => disposed || lost || !fitW || renderer.getContext().isContextLost()
      if (gone()) throw new Error('capture: the WebGL context is lost')
      // only a device still on the top tier draws bigger than its own ratio: one stepped down is already slow
      const asked = quality === 2 ? minRatio : 0
      renderer.setPixelRatio(
        lite ? LITE_RATIO : Math.min(Math.max(window.devicePixelRatio, asked), PHOTO_RATIO_CAP),
      )
      renderer.setSize(fitW, fitH, false)
      // Poster sheets print people's names; whatever is marked noPhoto stays out of the picture.
      const hidden: THREE.Object3D[] = []
      scene.traverse((o) => {
        if (o.userData.noPhoto && o.visible) {
          o.visible = false
          hidden.push(o)
        }
      })
      try {
        renderer.render(scene, camera)
        // the bigger buffer can cost a low-end phone its context; a lost one draws nothing
        if (gone()) throw new Error('capture: the WebGL context was lost while drawing')
        return read(renderer.domElement)
      } finally {
        for (const o of hidden) o.visible = true
        // directly, not resize(): that bails out when the window reports no size
        renderer.setPixelRatio(tierRatio())
        renderer.setSize(fitW, fitH, false)
      }
    },
    framesSinceRestore: () => sinceRestore,
    gameTime: () => gameClock,
    settle: warmUp,
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
      // The sky paints its backdrop as a canvas texture on the scene; free it with the stage.
      if (scene.background instanceof THREE.Texture) scene.background.dispose()
      renderer.dispose()
      // dispose() frees GL objects but keeps the context; a long session of remounts would run out.
      renderer.forceContextLoss()
    },
  }
}
