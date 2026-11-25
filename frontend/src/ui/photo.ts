import type { Stage } from '../engine/stage'
import { pictureName, shareImage, type ShareOutcome } from './share'

/** The name printed small in the photo's corner (a name, not a sentence, so it is the same in both languages). */
export const WORDMARK = 'Gulabi Gali · Jaipur'

/** `gulabi-gali-20261115-090507.png`: by the moment, so two photos never overwrite each other. */
export const photoName = (at = new Date()): string => pictureName('', at)

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
      out.toBlob((blob) => {
        out.width = out.height = 0 // let the pixels go now, not at GC
        if (blob) resolve(blob)
        else reject(new Error('png encode failed'))
      }, 'image/png'),
    )
  })
}

/**
 * Hands the photo over: the phone's share sheet when the browser can share files, else a download, or in
 * Instagram's in-app browser the photo on its own to press and save (`hold`; see `shareImage`).
 */
export const sharePhoto = (blob: Blob): Promise<ShareOutcome> => shareImage(blob, photoName())
