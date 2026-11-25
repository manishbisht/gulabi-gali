import type { Stage } from '../engine/stage'
import { t, type Lang } from '../i18n/strings'
import { darshanComplete, darshanEntries } from '../world/darshan'
import { PALETTE } from '../world/palette'
import { STREAK_ACCENT } from '../world/today'
import { TOTAL_STAMPS } from '../world/stamps'
import {
  CARD_H,
  CARD_W,
  coverCrop,
  ellipsize,
  fitBand,
  initials,
  SEP,
  SITE_ADDRESS,
  stampGrid,
  type Measure,
  type Rect,
  wrapTwo,
} from './cardLayout'

/*
 * The shareable pictures, drawn on a plain 2D canvas at Instagram Story size (1080×1920). Loaded only when
 * someone makes one (see PhotoMode and DarshanList), so none of it is in the first load.
 *
 * Neither picture carries an account id or anyone's name but the visitor's own first name on the Darshan card,
 * and that only when they ticked "naam dikhao". The postcard is the street as the WebGL canvas draws it: the
 * name labels and bubbles over people are DOM nodes (see `createPeopleLabels`), never in that canvas, and
 * poster sheets (which print authors' names) are `noPhoto` and left out of every capture.
 */

const PLUM = '#2a1d24'
const CREAM = '#f5e6d8'
const TITLE = (size: number) => `700 ${size}px 'Baloo 2', system-ui, sans-serif`
const BODY = (size: number) => `600 ${size}px Mukta, system-ui, sans-serif`
/** How long the site's own fonts are waited for before a system font is drawn instead. */
const FONT_WAIT_MS = 2000

/** The site's two web fonts, loaded (or given up on): a picture is never held up by a slow font host. */
async function fontsReady(): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  if (typeof fonts?.load !== 'function') return
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<void>((resolve) => (timer = setTimeout(resolve, FONT_WAIT_MS)))
  const loaded = Promise.resolve()
    .then(() => Promise.all([fonts.load(TITLE(64)), fonts.load(BODY(40))]))
    .then(() => fonts.ready)
    .then(() => undefined)
    .catch(() => undefined)
  await Promise.race([loaded, late])
  clearTimeout(timer)
}

function newCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d canvas')
  return { canvas, ctx }
}

const toPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png encode failed'))), 'image/png'),
  )

const measureWith =
  (ctx: CanvasRenderingContext2D, font: (size: number) => string): Measure =>
  (text, size) => {
    ctx.font = font(size)
    return ctx.measureText(text).width
  }

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

/** Text in the current font centred on `x`, cut short with "…" if it is wider than `maxWidth`. */
function centred(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  ctx.textAlign = 'center'
  ctx.fillText(
    ellipsize((s) => ctx.measureText(s).width, text, 0, maxWidth),
    x,
    y,
  )
}

/** The postcard's band: where it sits, inside a Story's safe area (its top 250 px are Instagram's own). */
export const BAND = { x: 60, y: 250, w: 960, h: 220, pad: 48 } as const

/**
 * The postcard band: "Gulabi Gali · <place> · Jaipur" on one line (the place in marigold), the address
 * under it, on a plum strip at the top of the picture.
 */
export function drawBand(ctx: CanvasRenderingContext2D, place: string): void {
  ctx.save()
  roundRect(ctx, BAND.x, BAND.y, BAND.w, BAND.h, 36)
  ctx.fillStyle = 'rgb(42 29 36 / 0.84)'
  ctx.fill()
  ctx.lineWidth = 4
  ctx.strokeStyle = PALETTE.marigold
  ctx.stroke()
  const title = measureWith(ctx, TITLE)
  const line = fitBand(title, ['Gulabi Gali', place, 'Jaipur'], BAND.w - 2 * BAND.pad, 64, 40)
  ctx.font = TITLE(line.size)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const segments: [string, string][] = []
  line.parts.forEach((part, i) => {
    if (part === '') return
    if (segments.length) segments.push([SEP, CREAM])
    segments.push([part, i === 1 ? PALETTE.marigold : CREAM])
  })
  const whole = segments.reduce((w, [s]) => w + ctx.measureText(s).width, 0)
  let x = CARD_W / 2 - whole / 2
  for (const [text, colour] of segments) {
    ctx.fillStyle = colour
    ctx.fillText(text, x, BAND.y + 112)
    x += ctx.measureText(text).width
  }
  ctx.font = BODY(40)
  ctx.fillStyle = PALETTE.sandstone
  centred(ctx, SITE_ADDRESS, CARD_W / 2, BAND.y + 178, BAND.w - 2 * BAND.pad)
  ctx.restore()
}

/**
 * A postcard of the street: one frame (see `Stage.capture`), cut to 9:16 from its middle and scaled to
 * 1080×1920, with the band. The frame is copied in the capture's own task; fonts are waited for after it, so
 * the picture is the moment the shutter was pressed.
 */
export async function composePostcard(stage: Pick<Stage, 'capture'>, place: string): Promise<Blob> {
  const { canvas, ctx } = newCanvas()
  // the screen's own 9:16 middle, in CSS px: the ratio that draws it at the postcard's width
  const view = coverCrop(window.innerWidth, window.innerHeight, CARD_W, CARD_H)
  const minRatio = view.w > 0 ? CARD_W / view.w : 0
  stage.capture((source) => {
    const crop = coverCrop(source.width, source.height, CARD_W, CARD_H)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, CARD_W, CARD_H)
  }, minRatio)
  await fontsReady()
  drawBand(ctx, place)
  return toPng(canvas)
}

export interface DarshanCardInput {
  /** The landmark ids stamped so far. */
  ids: readonly string[]
  lang: Lang
  /** The visitor's first name, only when they asked for it (see `cardName`); null prints no name. */
  name: string | null
  /** Days in a row of "Aaj ka Darshan": shown from `STREAK_ACCENT` on. */
  streak: number
}

/** Where the Darshan card's stamps go: two to a row, in stamp order. */
export const GRID = { x: 90, y: 790, w: 900, h: 730 } as const
const NAME_SIZE = 34

/**
 * One stamp: a pink seal with its initials and the landmark's name beside it, or, for one still to find, a
 * dashed ring with "?" and "Abhi baaki hai" (never its name).
 */
function drawStamp(ctx: CanvasRenderingContext2D, cell: Rect, got: boolean, name: string, lang: Lang) {
  const r = Math.min(cell.h * 0.36, 44)
  const cx = cell.x + 20 + r
  const cy = cell.y + cell.h / 2
  const faint = 'rgb(217 179 130 / 0.7)'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  if (got) {
    ctx.fillStyle = PALETTE.pink
    ctx.fill()
    ctx.lineWidth = 5
    ctx.strokeStyle = PALETTE.marigold
    ctx.stroke()
  } else {
    ctx.setLineDash([10, 8])
    ctx.lineWidth = 4
    ctx.strokeStyle = faint
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.font = TITLE(Math.round(r * (got ? 0.8 : 0.95)))
  ctx.fillStyle = got ? CREAM : faint
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(got ? initials(name) : '?', cx, cy + r * 0.06)
  ctx.textBaseline = 'alphabetic'

  const x = cx + r + 22
  const room = cell.x + cell.w - x - 12
  const label = got ? name : t('darshanLocked', lang)
  ctx.font = BODY(NAME_SIZE)
  ctx.fillStyle = got ? CREAM : faint
  ctx.textAlign = 'left'
  const lines = wrapTwo((s) => ctx.measureText(s).width, label, NAME_SIZE, room)
  const first = lines.length === 1 ? cy + NAME_SIZE * 0.35 : cy - NAME_SIZE * 0.25
  lines.forEach((line, i) => ctx.fillText(line, x, first + i * NAME_SIZE * 1.1))
}

/**
 * The Darshan card: "Mera Jaipur Darshan", the visitor's first name if they asked, the count out of every
 * stamp there is, the run of days if it is a long one, every landmark in stamp order (collected ones in colour
 * and named, the rest as dashed rings), and the address.
 */
export async function composeDarshanCard({ ids, lang, name, streak }: DarshanCardInput): Promise<Blob> {
  const { canvas, ctx } = newCanvas()
  await fontsReady()
  const entries = darshanEntries(ids, lang)
  const got = entries.filter((e) => e.got).length

  const bg = ctx.createLinearGradient(0, 0, 0, CARD_H)
  bg.addColorStop(0, '#3b2430')
  bg.addColorStop(1, PLUM)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  roundRect(ctx, 40, 40, CARD_W - 80, CARD_H - 80, 48)
  ctx.lineWidth = 4
  ctx.strokeStyle = PALETTE.marigold
  ctx.stroke()

  const wide = CARD_W - 180
  ctx.textBaseline = 'alphabetic'
  ctx.font = TITLE(92)
  ctx.fillStyle = PALETTE.marigold
  centred(ctx, t('cardTitle', lang), CARD_W / 2, 340, wide)
  if (name) {
    ctx.font = BODY(52)
    ctx.fillStyle = CREAM
    centred(ctx, name, CARD_W / 2, 420, wide)
  }
  ctx.font = TITLE(168)
  ctx.fillStyle = PALETTE.pink
  centred(ctx, `${got}/${TOTAL_STAMPS}`, CARD_W / 2, 600, wide)
  ctx.font = BODY(44)
  ctx.fillStyle = PALETTE.sandstone
  centred(ctx, t('cardCountLabel', lang), CARD_W / 2, 670, wide)
  const extra = darshanComplete(ids)
    ? t('darshanBadge', lang)
    : streak >= STREAK_ACCENT
      ? t('todayStreakBadge', lang, { n: streak })
      : null
  if (extra) {
    ctx.font = BODY(38)
    ctx.fillStyle = PALETTE.marigold
    centred(ctx, extra, CARD_W / 2, 735, wide)
  }

  stampGrid(entries.length, GRID, 2, 130).forEach((cell, i) =>
    drawStamp(ctx, cell, entries[i]!.got, entries[i]!.name, lang),
  )

  ctx.font = TITLE(60)
  ctx.fillStyle = CREAM
  centred(ctx, 'Gulabi Gali · Jaipur', CARD_W / 2, 1600, wide)
  ctx.font = BODY(40)
  ctx.fillStyle = PALETTE.sandstone
  centred(ctx, SITE_ADDRESS, CARD_W / 2, 1660, wide)
  return toPng(canvas)
}
