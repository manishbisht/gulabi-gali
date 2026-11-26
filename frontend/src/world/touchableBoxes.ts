import type { AABB, TouchableSpec } from './types'

/** Footprint of each standing kind before turning: w across its front, d front to back. */
const SIZE: Record<Exclude<TouchableSpec['kind'], 'pigeons'>, { w: number; d: number }> = {
  bell: { w: 1.4, d: 0.6 },
  pump: { w: 0.7, d: 1.5 },
  diyas: { w: 1.7, d: 0.8 },
}

/**
 * The colliders of a district's bells, pumps and diya stands (see touchables.ts): the axis-aligned box round
 * each, turned by its `rot`. The pigeons have none: they are walked through.
 */
export function touchableColliders(list: readonly TouchableSpec[] = []): AABB[] {
  const out: AABB[] = []
  for (const s of list) {
    if (s.kind === 'pigeons') continue
    const { w, d } = SIZE[s.kind]
    const a = ((s.rot ?? 0) * Math.PI) / 180
    const c = Math.abs(Math.cos(a))
    const n = Math.abs(Math.sin(a))
    const hx = (w * c + d * n) / 2
    const hz = (w * n + d * c) / 2
    out.push({ minX: s.at.x - hx, maxX: s.at.x + hx, minZ: s.at.z - hz, maxZ: s.at.z + hz })
  }
  return out
}
