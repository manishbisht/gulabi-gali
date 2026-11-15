import * as THREE from 'three'
import { POSTER_AFTER_MS, POSTER_SLOTS, type PosterView, type ServerMsg } from '../net/protocol'
import { PALETTE } from './palette'
import type { DistrictDef, Vec2 } from './types'

/** "Deewar pe chipkao" shows this close to a poster wall (to the wall itself, not its middle). */
export const WALL_RANGE = 3

/** A poster wall: the n-th `poster-wall` prop of its district, as the server numbers them. */
export interface Wall {
  index: number
  at: Vec2
  /** Degrees, as on the prop. */
  rot: number
}

/** Every poster wall in a district, in the order the server numbers them. */
export function wallsOf(def: DistrictDef): Wall[] {
  return def.props
    .filter((p) => p.kind === 'poster-wall')
    .map((p, index) => ({ index, at: p.at, rot: p.rot ?? 0 }))
}

/** The wall's footprint (the prop's, see props.ts): 4.2 m across its face, 0.5 m through. */
const HALF_W = 2.1
const HALF_D = 0.25

/** How far `pos` is from the wall's footprint, in metres (0 inside it). */
export function wallDistance(pos: Vec2, wall: Wall): number {
  // Into the prop's own frame: it is drawn turned by -rot about y (see buildProps), so turn back by +rot.
  const a = (wall.rot * Math.PI) / 180
  const dx = pos.x - wall.at.x
  const dz = pos.z - wall.at.z
  const lx = dx * Math.cos(a) + dz * Math.sin(a)
  const lz = -dx * Math.sin(a) + dz * Math.cos(a)
  return Math.hypot(Math.max(0, Math.abs(lx) - HALF_W), Math.max(0, Math.abs(lz) - HALF_D))
}

/** The wall nearest `pos` within `range`, or null. */
export function nearestWall(pos: Vec2, walls: readonly Wall[], range = WALL_RANGE): Wall | null {
  let best: Wall | null = null
  let bestD = range
  for (let i = 0; i < walls.length; i++) {
    const d = wallDistance(pos, walls[i]!)
    if (d <= bestD) {
      best = walls[i]!
      bestD = d
    }
  }
  return best
}

/**
 * The posters' sheet on a wall, in the prop's frame: over the 3.7 × 1.9 m sandstone board, whose face is at
 * z = 0.22 and whose middle is 1.55 m up. Six slots, three across and two down; slot 0 is top left.
 */
const SHEET = { w: 3.6, h: 1.8, y: 1.55, z: 0.225 }
const COLS = 3
const ROWS = POSTER_SLOTS / COLS
/** One canvas per wall: 640 × 320 px (each slot 213 × 160), well under a megabyte with its mipmaps. */
const CANVAS_W = 640
const CANVAS_H = 320

/** The slot under a point of the sheet, by its texture coordinates (v runs up). */
export function slotAt(u: number, v: number): number {
  const col = Math.min(COLS - 1, Math.max(0, Math.floor(u * COLS)))
  const row = Math.min(ROWS - 1, Math.max(0, Math.floor((1 - v) * ROWS)))
  return row * COLS + col
}

/** Where slot `n`'s middle is on the sheet, in the prop's frame. */
function slotCentre(n: number): { x: number; y: number } {
  const col = n % COLS
  const row = Math.floor(n / COLS)
  return {
    x: -SHEET.w / 2 + (col + 0.5) * (SHEET.w / COLS),
    y: SHEET.y + SHEET.h / 2 - (row + 0.5) * (SHEET.h / ROWS),
  }
}

/** A poster's time as the wall prints it: in Jaipur, whatever the phone's own zone. */
const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
})
export const posterWhen = (at: number) => WHEN.format(at)

/** Paper colours, by slot, so neighbours never match. */
const PAPERS = ['#FFF4D6', '#FFE0E6', '#E2F3EC', '#FFEBD2', '#E8EEF8', '#F6E6FF']
/**
 * Your own poster that reports have hidden (only you are ever sent one): on grey paper, its words faded, so it
 * reads as off the wall for everyone else. Its card says why.
 */
export const HIDDEN_PAPER = '#D6D1C9'
const HIDDEN_INK = '#8A847B'

/** The 2D context calls the wall uses: a real canvas's, or a test's stand-in. */
export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  'fillStyle' | 'font' | 'textBaseline' | 'fillRect' | 'fillText' | 'measureText'
>
export interface Sheet {
  canvas: HTMLCanvasElement
  ctx: Ctx2D
}

function makeSheet(): Sheet {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  return { canvas, ctx: canvas.getContext('2d')! }
}

/**
 * `text` in lines no wider than `max` px: by words, and a word too long for a line by characters. Whatever
 * someone typed is drawn as plain text with `fillText`: nothing in it is ever read as markup.
 */
export function wrap(ctx: Pick<Ctx2D, 'measureText'>, text: string, max: number): string[] {
  const lines: string[] = []
  let line = ''
  const fits = (s: string) => ctx.measureText(s).width <= max
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (fits(next)) {
      line = next
      continue
    }
    if (line) lines.push(line)
    line = ''
    for (const ch of word) {
      if (line && !fits(line + ch)) {
        lines.push(line)
        line = ''
      }
      line += ch
    }
  }
  if (line) lines.push(line)
  return lines
}

/** Draws a wall's whole sheet: the board, and each poster on its paper. */
function draw(ctx: Ctx2D, posters: ReadonlyMap<number, PosterView>): void {
  const sw = CANVAS_W / COLS
  const sh = CANVAS_H / ROWS
  ctx.fillStyle = PALETTE.sandstone
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.textBaseline = 'top'
  for (const [slot, p] of posters) {
    const x = (slot % COLS) * sw
    const y = Math.floor(slot / COLS) * sh
    ctx.fillStyle = p.hidden ? HIDDEN_PAPER : PAPERS[slot % PAPERS.length]!
    ctx.fillRect(x + 8, y + 8, sw - 16, sh - 16)
    const pad = 16
    const width = sw - pad * 2
    ctx.fillStyle = p.hidden ? HIDDEN_INK : PALETTE.road
    ctx.font = '600 15px system-ui, sans-serif'
    const lines = wrap(ctx, p.text, width).slice(0, 6)
    lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + i * 18, width))
    ctx.font = '13px system-ui, sans-serif'
    ctx.fillStyle = p.hidden ? HIDDEN_INK : PALETTE.terracotta
    const by = p.when === null ? `— ${p.name}` : `${posterWhen(p.when)} · ${p.name}`
    // How many said "Main aaunga": a number only, the same for everyone (see GoingView).
    const foot = p.going ? `${by} · 🙋 ${p.going}` : by
    ctx.fillText(foot, x + pad, y + sh - pad - 18, width)
  }
}

/** What the poster walls tell React. */
export interface PosterHooks {
  /** The wall in reach, and whether it has nothing on it, or null. Called only when either changes. */
  near(wall: Wall | null, empty: boolean): void
  /** A poster was tapped. */
  tap(poster: PosterView): void
  /** These posters are no longer on any wall here (taken down, hidden, blocked, replaced). */
  gone(ids: string[]): void
}

/** After a nudge's fetch fails, it is tried once more after this long (meanwhile the walls stay bare). */
export const NUDGE_RETRY_MS = 2000
/** How often the walls look for a poster whose time has passed: once a minute, never per frame. */
export const EXPIRY_CHECK_MS = 60_000

export interface Posters {
  /** Every frame: which wall is in reach. Allocates nothing. */
  update(pos: Vec2): void
  /** The district socket's news about posters: one up or down, or (`posters`) fetch them all again. */
  apply(m: ServerMsg): void
  /** Fetches every wall's posters again (a new socket, a block, signing in or out). */
  refresh(): void
  /** A poster this page just pinned, before the socket's word on it arrives. */
  upsert(p: PosterView): void
  remove(id: string): void
  /** The poster under a ray from the camera, on a wall that has any. */
  pick(ray: THREE.Raycaster): PosterView | null
  near(): Wall | null
  /** Every poster up, and where its middle is in the world: for the test hooks. */
  all(): { poster: PosterView; at: THREE.Vector3 }[]
  dispose(): void
}

interface WallView {
  wall: Wall
  posters: Map<number, PosterView>
  sheet: Sheet
  texture: THREE.CanvasTexture
  material: THREE.MeshLambertMaterial
  mesh: THREE.Mesh
  /** What was last drawn, so a wall is redrawn only when its posters change. */
  drawn: string
}

/**
 * The district's poster walls. Each wall with anything on it is one mesh with one canvas texture (one draw
 * call), redrawn only when its posters change; an empty wall draws nothing. `load` fetches the district's list
 * (the server has already left out anyone blocked either way); socket news received while it runs is replayed
 * on top of what it brings. Everything here is disposed with the district.
 */
export function createPosters(opts: {
  scene: THREE.Object3D
  def: DistrictDef
  hooks: PosterHooks
  load(signal: AbortSignal): Promise<PosterView[]>
  /** Tests hand in a canvas stand-in. */
  sheet?: () => Sheet
}): Posters {
  const { scene, hooks } = opts
  const geometry = new THREE.PlaneGeometry(SHEET.w, SHEET.h).translate(0, SHEET.y, SHEET.z)
  const walls: WallView[] = wallsOf(opts.def).map((wall) => {
    const sheet = (opts.sheet ?? makeSheet)()
    const texture = new THREE.CanvasTexture(sheet.canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    const material = new THREE.MeshLambertMaterial({ map: texture })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = `posters-${wall.index}`
    mesh.userData.noPhoto = true // the sheet prints authors' names: photo mode leaves it out
    mesh.position.set(wall.at.x, 0, wall.at.z)
    // The same turn as the prop (see buildProps): `rot` degrees, clockwise seen from above.
    mesh.rotation.y = (-wall.rot * Math.PI) / 180
    mesh.updateMatrix()
    mesh.updateMatrixWorld()
    mesh.matrixAutoUpdate = false
    mesh.visible = false
    scene.add(mesh)
    return { wall, posters: new Map(), sheet, texture, material, mesh, drawn: '' }
  })
  const plain = walls.map((w) => w.wall)
  let near: WallView | null = null
  let nearEmpty = true
  let loading: AbortController | null = null
  /** Socket news that came while a load was out: replayed once it lands. */
  let pending: ServerMsg[] = []
  let retry: ReturnType<typeof setTimeout> | null = null
  /** A closed refresh (a block's nudge) has not landed yet: any refresh until one does counts as closed. */
  let owing = false
  let disposed = false

  const repaint = (w: WallView) => {
    const key = JSON.stringify([...w.posters].sort((a, b) => a[0] - b[0]))
    if (key === w.drawn) return
    w.drawn = key
    w.mesh.visible = w.posters.size > 0
    if (w.posters.size) {
      draw(w.sheet.ctx, w.posters)
      w.texture.needsUpdate = true
    }
    if (w === near) tellNear()
  }
  const tellNear = () => {
    const empty = !near || near.posters.size === 0
    nearEmpty = empty
    hooks.near(near?.wall ?? null, empty)
  }
  const find = (id: string) => {
    for (const w of walls) for (const [slot, p] of w.posters) if (p.id === id) return { w, slot }
    return null
  }
  const remove = (id: string) => {
    const at = find(id)
    if (!at) return
    at.w.posters.delete(at.slot)
    repaint(at.w)
    hooks.gone([id])
  }
  const upsert = (p: PosterView) => {
    const w = walls[p.wall]
    if (!w || p.slot < 0 || p.slot >= POSTER_SLOTS) return
    const was = find(p.id)
    if (was) was.w.posters.delete(was.slot)
    const displaced = w.posters.get(p.slot)
    if (displaced && displaced.id !== p.id) hooks.gone([displaced.id])
    if (was && was.w !== w) repaint(was.w)
    w.posters.set(p.slot, p)
    repaint(w)
  }
  const handle = (m: ServerMsg) => {
    if (m.t === 'posters') return refresh(true)
    if (m.t !== 'poster') return
    if (m.op === 'add') upsert(m.poster)
    else remove(m.id)
  }

  /** Every wall shows `list` (and nothing else), and whatever left is said to be gone. */
  const show = (list: PosterView[]) => {
    const before = new Set<string>()
    for (const w of walls) for (const p of w.posters.values()) before.add(p.id)
    for (const w of walls) w.posters.clear()
    for (const p of list) walls[p.wall]?.posters.set(p.slot, p)
    for (const w of walls) repaint(w)
    for (const p of list) before.delete(p.id)
    if (before.size) hooks.gone([...before])
  }

  /**
   * Fetches the walls again. `closed`: the server said what this person may see changed (a block), so on a
   * failed fetch the walls go bare rather than keep showing what may now be someone they must not see, and
   * the fetch is tried once more (`retried`). Any other failed fetch leaves them as they are.
   */
  function refresh(asked = false, retried = false) {
    // A welcome's refresh that supersedes a block's nudge does not forget that the nudge was owed.
    owing ||= asked
    const closed = owing
    loading?.abort()
    if (retry) clearTimeout(retry)
    retry = null
    const ctl = new AbortController()
    loading = ctl
    pending = []
    opts
      .load(ctl.signal)
      .then((list) => {
        if (disposed || ctl.signal.aborted) return
        loading = null
        owing = false
        show(list)
        const replay = pending
        pending = []
        for (const m of replay) handle(m)
      })
      .catch(() => {
        if (disposed || ctl.signal.aborted) return
        loading = null
        pending = []
        if (!closed) return
        show([])
        if (!retried) retry = setTimeout(() => refresh(true, true), NUDGE_RETRY_MS)
      })
  }

  // The server drops a poster `POSTER_AFTER_MS` after its `when`; a page does not wait for its next fetch (a
  // poster without a `when` runs from its pinning, which only the server knows, so it waits for the fetch).
  const expiry = setInterval(() => {
    const now = Date.now()
    const over: string[] = []
    for (const w of walls)
      for (const [slot, p] of w.posters)
        if (p.when !== null && p.when + POSTER_AFTER_MS <= now) {
          w.posters.delete(slot)
          over.push(p.id)
        }
    if (!over.length) return
    for (const w of walls) repaint(w)
    hooks.gone(over)
  }, EXPIRY_CHECK_MS)

  return {
    update(pos) {
      const w = nearestWall(pos, plain)
      const next = w ? walls[w.index]! : null
      if (next !== near || (next && (next.posters.size === 0) !== nearEmpty)) {
        near = next
        tellNear()
      }
    },
    apply(m) {
      if (m.t !== 'poster' && m.t !== 'posters') return
      if (loading && m.t === 'poster') pending.push(m)
      else handle(m)
    },
    refresh: () => refresh(),
    upsert,
    remove,
    pick(ray) {
      const shown = walls.filter((w) => w.mesh.visible)
      if (!shown.length) return null
      const hit = ray.intersectObjects(
        shown.map((w) => w.mesh),
        false,
      )[0]
      if (!hit?.uv) return null
      const w = shown.find((s) => s.mesh === hit.object)!
      return w.posters.get(slotAt(hit.uv.x, hit.uv.y)) ?? null
    },
    near: () => near?.wall ?? null,
    all() {
      const out: { poster: PosterView; at: THREE.Vector3 }[] = []
      for (const w of walls)
        for (const [slot, poster] of w.posters) {
          const c = slotCentre(slot)
          out.push({ poster, at: new THREE.Vector3(c.x, c.y, SHEET.z).applyMatrix4(w.mesh.matrixWorld) })
        }
      return out
    },
    dispose() {
      disposed = true
      clearInterval(expiry)
      loading?.abort()
      if (retry) clearTimeout(retry)
      for (const w of walls) {
        w.mesh.removeFromParent()
        w.texture.dispose()
        w.material.dispose()
      }
      geometry.dispose()
      if (near) hooks.near((near = null), true)
    },
  }
}
