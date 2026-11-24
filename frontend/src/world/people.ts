import * as THREE from 'three'
import type { LivePerson, ServerMsg } from '../net/protocol'
import { buildAvatar, lookFromWire, lookKey as figureKey } from '../player/avatar'
import { buildAutoGeometry } from './props'
import type { AvatarLook, Vec2 } from './types'

/** How quickly a body catches up with where its person last said they were: a time constant, in seconds. */
const FOLLOW_S = 0.12
/** Further than this from where a body is drawn, it jumps instead of gliding (a rejoin, a missed stretch). */
const SNAP_M = 20
/**
 * Bodies further than this from the player are hidden: the server sends moves only within 60 m of the viewer,
 * so past it a body would stand frozen where it was last heard of. A little short of 60, for the server's
 * view of where the player is lagging behind.
 */
export const DRAW_RANGE = 55
/** The invisible tap target around each body, as for the characters. */
const TAP_RADIUS = 0.75
const TAP_HEIGHT = 2.2
/** Most autos drawn under other people at once; more drivers than this go on foot in view. */
const MAX_RIDES = 48
/** A driver sits this far up in the auto's seat. */
const SEAT_Y = 0.35
/** For a look this build cannot draw (a newer client's outfit, say). */
const PLAIN: AvatarLook = { skin: 2, outfit: 'sandstone', head: 'none' }

/** One remote person: what the server said about them, and the body that follows it. */
export interface Remote {
  /** Their public face; `x`, `z` and `ry` are where the body is heading, not where it is drawn. */
  readonly person: LivePerson
  readonly body: THREE.Group
  /** Bumped whenever the name or status changes, so labels rewrite their text only then. */
  readonly ver: number
}

export interface People {
  apply(m: ServerMsg): void
  /** Eases every body toward its person's point, and hides those more than `DRAW_RANGE` from `from`. */
  update(dt: number, from: Vec2): void
  pick(ray: THREE.Raycaster): LivePerson | null
  /** Everyone listed, where they are drawn now. */
  list(): LivePerson[]
  /** Everyone listed, without copying: replaced when someone joins or leaves, never mutated. */
  entries(): readonly Remote[]
  /** Someone listed, by id, without copying. */
  get(id: string): Remote | undefined
  /** Takes everyone off the street (the socket that listed them is gone); the next welcome lists them again. */
  clear(): void
  setShadows(on: boolean): void
  dispose(): void
}

interface Entry extends Remote {
  person: LivePerson
  avatar: THREE.Mesh
  tap: THREE.Mesh
  look: string
  ver: number
}

const lookKey = (p: LivePerson) => figureKey(lookFromWire(p.look) ?? PLAIN)
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * The other people in the district, as the live socket describes them. Each is one avatar (shared geometry,
 * one draw call) and an invisible tap target; a frame eases every body toward its last reported point and
 * allocates nothing. `heightAt` says how high someone standing at (x, z) is (up on a rooftop; the street is 0).
 */
export function createPeople(scene: THREE.Object3D, heightAt?: (x: number, z: number) => number): People {
  const tapMaterial = new THREE.MeshBasicMaterial({ visible: false })
  const tapGeometry = new THREE.CylinderGeometry(TAP_RADIUS, TAP_RADIUS, TAP_HEIGHT, 8)
  const byId = new Map<string, Entry>()
  let all: Entry[] = []
  let taps: THREE.Object3D[] = []
  let shadows = false
  /** One mesh for every auto under a remote driver: merged geometry, one instance each, none until needed. */
  const rides = new THREE.InstancedMesh(
    buildAutoGeometry(),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
    MAX_RIDES,
  )
  rides.name = 'remote-autos'
  rides.count = 0
  rides.frustumCulled = false // its instances move every frame; the bounds computed at the start would not follow
  rides.castShadow = false
  scene.add(rides)
  /** Whether the last frame drew any rider, so a street with none keeps its buffer untouched. */
  let hadRides = false
  const ride = new THREE.Matrix4()
  const turned = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const spot = new THREE.Vector3()
  const unit = new THREE.Vector3(1, 1, 1)
  /** The viewer, as the server knows them: never drawn as someone else. */
  let self: string | null = null

  const reindex = () => {
    all = [...byId.values()]
    taps = all.map((e) => e.tap)
  }

  function dress(e: Entry, p: LivePerson) {
    const key = lookKey(p)
    if (e.look === key) return
    e.avatar.removeFromParent() // shared geometry and material: nothing to dispose
    e.avatar = buildAvatar(lookFromWire(p.look) ?? PLAIN, { castShadow: shadows })
    e.body.add(e.avatar)
    e.look = key
  }

  /** Adds `p`, or (someone already listed, back on a new socket) updates them in place. */
  function upsert(p: LivePerson): boolean {
    if (p.id === self) return false
    const had = byId.get(p.id)
    if (had) {
      if (had.person.name !== p.name || had.person.status !== p.status) had.ver++
      dress(had, p)
      had.person = { ...p }
      const { position } = had.body
      if (Math.hypot(p.x - position.x, p.z - position.z) > SNAP_M) position.set(p.x, 0, p.z)
      return false
    }
    const body = new THREE.Group()
    body.name = `person-${p.id}`
    const avatar = buildAvatar(lookFromWire(p.look) ?? PLAIN, { castShadow: shadows })
    const tap = new THREE.Mesh(tapGeometry, tapMaterial)
    tap.name = 'tap'
    tap.position.y = TAP_HEIGHT / 2
    body.add(avatar, tap)
    body.position.set(p.x, 0, p.z)
    body.rotation.y = p.ry
    scene.add(body)
    byId.set(p.id, { person: { ...p }, body, avatar, tap, look: lookKey(p), ver: 0 })
    return true
  }

  function remove(id: string): boolean {
    const e = byId.get(id)
    if (!e) return false
    e.body.removeFromParent()
    byId.delete(id)
    return true
  }

  const drawn = (e: Entry): LivePerson => ({
    ...e.person,
    x: e.body.position.x,
    z: e.body.position.z,
    ry: e.body.rotation.y,
  })

  return {
    apply(m) {
      switch (m.t) {
        case 'welcome': {
          self = m.you.id
          const listed = new Set(m.people.map((p) => p.id))
          let changed = false
          for (const id of [...byId.keys()])
            if (!listed.has(id) || id === self) changed = remove(id) || changed
          for (const p of m.people) changed = upsert(p) || changed
          if (changed) reindex()
          return
        }
        case 'join':
          if (upsert(m.p)) reindex()
          return
        case 'leave':
          if (remove(m.id)) reindex()
          return
        case 'moves':
          for (const [id, x, z, ry, v] of m.m) {
            const e = byId.get(id)
            if (!e) continue
            e.person.x = x
            e.person.z = z
            e.person.ry = ry
            // a move without the flag is one on foot
            if (v === 'auto') e.person.v = v
            else delete e.person.v
          }
          return
        case 'status': {
          const e = byId.get(m.id)
          if (e && e.person.status !== m.text) {
            e.person.status = m.text
            e.ver++
          }
          return
        }
      }
    },
    update(dt, from) {
      // Exponential easing: each frame closes the same share of the gap, so a body never passes its target.
      const k = Math.exp(-dt / FOLLOW_S)
      const range = DRAW_RANGE * DRAW_RANGE
      let riding = 0
      for (let i = 0; i < all.length; i++) {
        const { person, body, avatar } = all[i]!
        const pos = body.position
        pos.x = person.x - (person.x - pos.x) * k
        pos.z = person.z - (person.z - pos.z) * k
        pos.y = heightAt ? heightAt(pos.x, pos.z) : 0
        body.rotation.y = wrap(person.ry - wrap(person.ry - body.rotation.y) * k)
        const dx = pos.x - from.x
        const dz = pos.z - from.z
        body.visible = dx * dx + dz * dz <= range
        // a driver sits in an auto: one instance under them, and their body a little higher
        const driving = body.visible && person.v === 'auto' && riding < MAX_RIDES
        avatar.position.y = driving ? SEAT_Y : 0
        if (driving) {
          turned.setFromAxisAngle(up, body.rotation.y)
          rides.setMatrixAt(riding++, ride.compose(spot.set(pos.x, 0, pos.z), turned, unit))
        }
      }
      rides.count = riding
      if (riding > 0 || hadRides) rides.instanceMatrix.needsUpdate = true
      hadRides = riding > 0
    },
    pick(ray) {
      for (let i = 0; i < all.length; i++) all[i]!.body.updateMatrixWorld(true)
      // a ray hits a hidden body's tap target as well: the nearest one that is drawn is the one tapped
      const hit = ray.intersectObjects(taps, false).find((h) => h.object.parent?.visible)
      const e = hit && all.find((x) => x.body === hit.object.parent)
      return e ? drawn(e) : null
    },
    list: () => all.map(drawn),
    entries: () => all,
    get: (id) => byId.get(id),
    clear() {
      if (!all.length) return
      for (const e of all) e.body.removeFromParent()
      byId.clear()
      reindex()
    },
    setShadows(on) {
      shadows = on
      for (let i = 0; i < all.length; i++) all[i]!.avatar.castShadow = on
    },
    dispose() {
      for (const e of all) e.body.removeFromParent()
      byId.clear()
      all = []
      taps = []
      rides.removeFromParent()
      rides.geometry.dispose()
      ;(rides.material as THREE.Material).dispose()
      rides.dispose()
      tapGeometry.dispose()
      tapMaterial.dispose()
    },
  }
}

/** Labels show only for people this close to the player, in metres. */
export const LABEL_RANGE = 15
/** Labels drawn at once: the nearest people get them. */
const LABELS = 6
const ABOVE_HEAD = 2.5

/**
 * Name and status over the nearest people's heads, as a few pooled DOM nodes inside `host` (the same idea as
 * the characters' bubbles, without their badge: these are real people). Text is rewritten only when a slot
 * changes hands or its person changes their status, so a frame costs a few transforms.
 */
export function createPeopleLabels(host: HTMLElement) {
  const v = new THREE.Vector3()
  const pool = Array.from({ length: LABELS }, () => {
    const el = document.createElement('div')
    el.className = 'person-label'
    el.hidden = true
    const name = document.createElement('strong')
    name.className = 'person-name'
    const status = document.createElement('span')
    status.className = 'person-status'
    el.append(name, status)
    host.append(el)
    return { el, name, status, who: null as Remote | null, ver: -1 }
  })
  /** The nearest people in range this frame, nearest first, and how far each is. */
  const near: (Remote | null)[] = new Array(LABELS).fill(null)
  const dist = new Float64Array(LABELS)

  return {
    update(camera: THREE.Camera, people: Pick<People, 'entries'>, from: Vec2) {
      const w = window.innerWidth
      const h = window.innerHeight
      let n = 0
      for (const r of people.entries()) {
        const d = Math.hypot(r.body.position.x - from.x, r.body.position.z - from.z)
        if (d > LABEL_RANGE || (n === LABELS && d >= dist[LABELS - 1]!)) continue
        let i = n < LABELS ? n++ : LABELS - 1
        for (; i > 0 && dist[i - 1]! > d; i--) {
          dist[i] = dist[i - 1]!
          near[i] = near[i - 1]!
        }
        dist[i] = d
        near[i] = r
      }
      for (let i = 0; i < LABELS; i++) {
        const slot = pool[i]!
        const r = i < n ? near[i]! : null
        near[i] = null
        if (r) v.set(r.body.position.x, r.body.position.y + ABOVE_HEAD, r.body.position.z).project(camera)
        if (!r || v.z > 1) {
          // nobody for this slot, or they are behind the camera; let go of whoever it showed
          slot.el.hidden = true
          slot.who = null
          continue
        }
        if (slot.who !== r || slot.ver !== r.ver) {
          slot.who = r
          slot.ver = r.ver
          slot.name.textContent = r.person.name
          slot.status.textContent = r.person.status
          slot.status.hidden = !r.person.status
        }
        slot.el.hidden = false
        slot.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`
      }
    },
    dispose() {
      for (const { el } of pool) el.remove()
    },
  }
}
