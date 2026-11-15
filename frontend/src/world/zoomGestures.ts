import type { Controls } from '../player/controls'

/** A wheel's roll in CSS px scales the camera's distance by e^(px * this): a 100 px notch is about 16 %. */
const ZOOM_PER_PX = 0.0015
/** A wheel that counts in lines (Firefox), or in pages, rolls about this many px for each. */
const PX_PER_LINE = 33
const PX_PER_PAGE = 800

/**
 * Zooming on the street: the mouse wheel (rolled toward you, farther; a trackpad's pinch arrives as one too)
 * and two fingers on the canvas (spread, nearer; pinched, farther, by the ratio of how far apart they are). Both
 * go to `controls.addZoom`; the camera clamps. The wheel's default is prevented, so neither the page nor the
 * browser's own zoom moves under it. Only pointers that went down on the canvas count: the joystick's thumb is on
 * its own element, so a thumb walking and a finger looking is never a pinch. The look (in the session) stops
 * when the second finger lands. Moves allocate nothing.
 */
export function createZoomGestures(canvas: HTMLCanvasElement, controls: Pick<Controls, 'addZoom'>) {
  /** Each pointer down on the canvas, and where it last was. */
  const pointers: { id: number; x: number; y: number }[] = []
  /** How far apart the two fingers of a pinch were at the last move; 0 when there is no pinch. */
  let apart = 0

  const spread = () =>
    pointers.length === 2 ? Math.hypot(pointers[0]!.x - pointers[1]!.x, pointers[0]!.y - pointers[1]!.y) : 0
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    if (!e.deltaY) return
    const px = e.deltaY * (e.deltaMode === 1 ? PX_PER_LINE : e.deltaMode === 2 ? PX_PER_PAGE : 1)
    controls.addZoom(Math.exp(px * ZOOM_PER_PX))
  }
  const onDown = (e: PointerEvent) => {
    if (!pointers.some((p) => p.id === e.pointerId))
      pointers.push({ id: e.pointerId, x: e.clientX, y: e.clientY })
    apart = spread()
  }
  const onMove = (e: PointerEvent) => {
    // kept up to date alone too, so the pinch starts from where the first finger is when the second lands
    let p = null
    for (let i = 0; i < pointers.length; i++) if (pointers[i]!.id === e.pointerId) p = pointers[i]!
    if (!p) return
    p.x = e.clientX
    p.y = e.clientY
    if (pointers.length !== 2) return
    const now = spread()
    if (apart > 0 && now > 0) controls.addZoom(apart / now)
    apart = now
  }
  const onUp = (e: PointerEvent) => {
    const i = pointers.findIndex((p) => p.id === e.pointerId)
    if (i >= 0) pointers.splice(i, 1)
    apart = spread()
  }
  // A pointer whose up never came (a backgrounded tab, a call over the page) must not pair with the next
  // finger into a pinch that was never made.
  const forget = () => {
    pointers.length = 0
    apart = 0
  }
  const onHidden = () => {
    if (document.visibilityState === 'hidden') forget()
  }
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  canvas.addEventListener('lostpointercapture', onUp)
  window.addEventListener('blur', forget)
  document.addEventListener('visibilitychange', onHidden)
  return {
    dispose() {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('lostpointercapture', onUp)
      window.removeEventListener('blur', forget)
      document.removeEventListener('visibilitychange', onHidden)
      forget()
    },
  }
}
