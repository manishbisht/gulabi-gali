import type { AqiBand, CitySnapshot } from '../net/protocol'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** The month (1-12) and minute of the day on Jaipur's clock, whatever the device's own timezone. */
export function istClock(now: Date): { month: number; minutes: number } {
  const t = new Date(now.getTime() + IST_OFFSET_MS)
  return { month: t.getUTCMonth() + 1, minutes: t.getUTCHours() * 60 + t.getUTCMinutes() }
}

/** Jaipur's winter: 1 December to the last day of February (IST). */
export function isWinter(now: Date): boolean {
  const { month } = istClock(now)
  return month === 12 || month <= 2
}

const h = (hours: number) => hours * 60
/** The mist rises in the small hours, is thickest around dawn, and has burnt off by mid-morning. */
const RISE_FROM = h(4)
const FULL_FROM = h(5.5)
const FULL_UNTIL = h(8)
const GONE_BY = h(10)

const smooth = (k: number) => k * k * (3 - 2 * k)

/** How misty a winter morning is now, 0 to 1: nothing outside winter, after ~10:00 or before ~04:00 (IST). */
export function morningMist(now: Date): number {
  if (!isWinter(now)) return 0
  const { minutes: m } = istClock(now)
  if (m < RISE_FROM || m >= GONE_BY) return 0
  if (m < FULL_FROM) return smooth((m - RISE_FROM) / (FULL_FROM - RISE_FROM))
  if (m <= FULL_UNTIL) return 1
  return smooth((GONE_BY - m) / (GONE_BY - FULL_UNTIL))
}

/** A light winter fog on clean air. */
const WINTER_BASE = 0.009
/** What dirty air adds to it at the most. */
const WINTER_AIR = 0.009
/** What a fog report (poor visibility) adds to it. */
const WINTER_SEEN = 0.004
/**
 * Never thicker than this. At 25 m the scene fog still lets through about three quarters of a landmark
 * (exp(-(25 × 0.022)²) ≈ 0.74), and with the ground fog's banks over it at their thickest (`MAX_OPACITY` in
 * groundFog.ts) still over 0.6; names and the HUD are drawn over the scene anyway.
 */
export const WINTER_MAX = 0.022

const BAND_AIR: Record<AqiBand, number> = { good: 0, moderate: 0.25, poor: 0.5, unhealthy: 0.75, severe: 1 }
/** How dirty the air is, 0 (AQI 50 or better) to 1 (AQI 250 or worse); the band stands in for a missing AQI. */
export function airLoad(s: Pick<CitySnapshot, 'aqi' | 'aqiBand'>): number {
  if (typeof s.aqi === 'number' && Number.isFinite(s.aqi)) return Math.min(Math.max((s.aqi - 50) / 200, 0), 1)
  return BAND_AIR[s.aqiBand] ?? 0
}

/**
 * The winter morning's fog: its scene density (FogExp2) and how strong the ground fog is, 0 to 1 (that is, the
 * density as a share of `WINTER_MAX`, for the low banks of mist drawn near the ground). Thicker on dirty air and
 * when the weather reports fog; nothing at all outside a winter morning.
 */
export function winterFog(s: CitySnapshot, now: Date): { density: number; ground: number } {
  const mist = morningMist(now)
  if (mist === 0) return { density: 0, ground: 0 }
  const raw = WINTER_BASE + WINTER_AIR * airLoad(s) + (s.condition === 'fog' ? WINTER_SEEN : 0)
  const density = mist * Math.min(raw, WINTER_MAX)
  return { density, ground: density / WINTER_MAX }
}
