import type { Stage } from '../engine/stage'

/** The name printed small in the photo's corner (a name, not a sentence, so it is the same in both languages). */
export const WORDMARK = 'Gulabi Gali · Jaipur'

const pad = (n: number) => String(n).padStart(2, '0')

/** `gulabi-gali-20261115-090507.png`: by the moment, so two photos never overwrite each other. */
export function photoName(at = new Date()): string {
  const day = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
  return `gulabi-gali-${day}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}.png`
}

/**
 * One frame of the street as a PNG, with the wordmark in the corner. The frame is copied into a plain canvas
 * inside the stage's capture (the WebGL buffer is only good until the task ends); the PNG is encoded from
 * that copy, so the live canvas never keeps its drawing buffer.
 */
export async function capturePhoto(stage: Pick<Stage, 'capture'>): Promise<Blob> {
  return stage.capture((source) => {
    const out = document.createElement('canvas')
    out.width = source.width
    out.height = source.height
    const ctx = out.getContext('2d')
    if (!ctx) throw new Error('no 2d canvas')
    ctx.drawImage(source, 0, 0)
    const size = out.width * 0.045 // the wordmark is about ten times that wide, so it always fits
    ctx.save()
    ctx.font = `600 ${size}px system-ui, sans-serif`
    ctx.fillStyle = '#f6efe4'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.shadowColor = 'rgb(42 29 36 / 0.7)'
    ctx.shadowBlur = size / 3
    ctx.fillText(WORDMARK, out.width / 2, out.height - size * 1.2)
    ctx.restore()
    return new Promise<Blob>((resolve, reject) =>
      out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png encode failed'))), 'image/png'),
    )
  })
}

export type PhotoOutcome = 'shared' | 'downloaded' | 'cancelled'

/**
 * Hands the photo over: the phone's share sheet when the browser can share files, else a download (many
 * in-app browsers, Instagram's among them, cannot share files). Closing the share sheet is `cancelled`, not
 * a failure. Rejects only if even the download cannot start.
 */
export async function sharePhoto(blob: Blob): Promise<PhotoOutcome> {
  const file = new File([blob], photoName(), { type: 'image/png' })
  const data = { files: [file] }
  if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
    try {
      if (navigator.canShare(data)) {
        await navigator.share(data)
        return 'shared'
      }
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return 'cancelled'
      // the share sheet failed after all: download instead
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    link.hidden = true
    document.body.append(link)
    link.click()
    link.remove()
  } finally {
    // the click has already handed the URL to the browser's download
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return 'downloaded'
}
