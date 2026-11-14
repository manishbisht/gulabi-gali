import * as THREE from 'three'
import { bake, box, merge } from '../kit/parts'
import type { PaletteKey } from '../palette'

/** Footprint, centred on the model's origin. The entrance faces +z. */
export const JKK = { w: 30, d: 30 }

const CELL = 10
const SQUARE = 9.2
const BAND = 0.6

type Parts = THREE.BufferGeometry[]

/** One closed square: red sandstone between pale bands, with a planet's sign on its street face. */
function square(parts: Parts, x: number, z: number, h: number, sign?: PaletteKey) {
  parts.push(box(SQUARE, h, SQUARE, x, 0, z, 'terracotta'))
  parts.push(box(SQUARE + 0.1, BAND, SQUARE + 0.1, x, 0, z, 'sandstone'))
  parts.push(box(SQUARE + 0.2, BAND, SQUARE + 0.2, x, h - BAND, z, 'sandstone'))
  if (sign) {
    const disc = new THREE.CircleGeometry(1.5, 10).translate(x, h * 0.55, z + SQUARE / 2 + 0.01)
    const ring = new THREE.RingGeometry(1.75, 2.0, 10).translate(x, h * 0.55, z + SQUARE / 2 + 0.01)
    parts.push(bake(disc, sign), bake(ring, 'white'))
  }
}

/** A square frame of four slabs, `size` across and `t` wide, `h` tall, on the ground. */
function frame(parts: Parts, size: number, t: number, h: number, color: PaletteKey) {
  const s = size / 2 - t / 2
  parts.push(box(size, h, t, 0, 0, s, color), box(size, h, t, 0, 0, -s, color))
  parts.push(box(t, h, size - 2 * t, s, 0, 0, color), box(t, h, size - 2 * t, -s, 0, 0, color))
}

/**
 * Jawahar Kala Kendra, after Charles Correa: nine squares, like the nine planets of the navagraha
 * and the nine wards of Jaipur's own plan. One corner square is turned to make the entrance, the
 * middle of the front row is an open gateway, and the centre is an open court with a stepped kund.
 */
export function buildJkk(): THREE.Group {
  const parts: Parts = []
  // back row, tallest
  square(parts, -CELL, -CELL, 7.2)
  square(parts, 0, -CELL, 7.6)
  square(parts, CELL, -CELL, 7.2)
  // middle row either side of the court
  square(parts, -CELL, 0, 6.6)
  square(parts, CELL, 0, 6.6)
  // front right, with the moon's sign; front left is the turned square, with the sun's
  square(parts, CELL, CELL, 6, 'white')
  const turned = box(7, 6.4, 7, 0, 0, 0, 'terracotta')
  const turnedBand = box(7.2, BAND, 7.2, 0, 6.4 - BAND, 0, 'sandstone')
  const sun = new THREE.CircleGeometry(1.4, 10).translate(0, 3.6, 3.51)
  for (const g of [turned, turnedBand, bake(sun, 'marigold')]) {
    g.rotateY(Math.PI / 4)
    g.translate(-CELL, 0, CELL)
    parts.push(g)
  }

  // the front gateway: two side walls and a lintel, open to the court behind
  const gh = 4.6
  parts.push(box(0.8, gh, SQUARE, -SQUARE / 2 + 0.4, 0, CELL, 'terracotta'))
  parts.push(box(0.8, gh, SQUARE, SQUARE / 2 - 0.4, 0, CELL, 'terracotta'))
  parts.push(box(SQUARE, 0.9, 1.2, 0, gh - 0.9, CELL + SQUARE / 2 - 0.6, 'sandstone'))
  parts.push(box(SQUARE, 0.05, SQUARE, 0, 0, CELL, 'sandstone'))

  // the court: a paved square round the kund, whose steps go down to a pale floor
  parts.push(box(SQUARE + 0.8, 0.05, SQUARE + 0.8, 0, 0, 0, 'white'))
  const steps = 4
  for (let k = 0; k < steps; k++) {
    const size = SQUARE - 0.4 - k * 1.6
    frame(parts, size, 0.8, 1.1 - k * 0.25, k % 2 ? 'white' : 'sandstone')
  }

  const mesh = new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true }))
  mesh.name = 'jkk'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}
