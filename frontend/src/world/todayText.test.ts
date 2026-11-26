import { describe, expect, it } from 'vitest'
import type { Lang } from '../i18n/strings'
import { DISTRICTS, loadDef } from './district'
import { DISTRICT_SHORT_NAMES } from './districtNames'
import { showsOf } from './shows'
import { dishDistricts } from './swaad'
import { GOAL_KINDS, goalById, goalFor } from './today'
import { CRICKET_DISTRICTS, goalText, SHOW_DISTRICTS } from './todayText'

const LANGS: Lang[] = ['hi', 'en']

describe("the day's goal in words", () => {
  it('every goal and hint is filled in, in both languages, on every day of a long run', () => {
    const start = Date.parse('2026-11-01T00:00:00Z')
    const seen = new Set<string>()
    for (let i = 0; i < GOAL_KINDS.length * 30; i++) {
      const goal = goalFor(new Date(start + i * 86400_000).toISOString().slice(0, 10))
      seen.add(goal.kind)
      for (const lang of LANGS) {
        const text = goalText(goal, lang)
        for (const line of [text.goal, text.hint]) {
          expect(line.trim(), goal.id).not.toBe('')
          expect(line, goal.id).not.toMatch(/[{}]|undefined/)
        }
      }
    }
    expect(seen.size).toBe(GOAL_KINDS.length)
  })

  it('a goal that is not in every district says where, by the names the place chip shows', () => {
    for (const lang of LANGS) {
      const cricket = goalText(goalById('cricket')!, lang).goal
      for (const id of CRICKET_DISTRICTS) expect(cricket).toContain(DISTRICT_SHORT_NAMES[id][lang])
      const show = goalText(goalById('show')!, lang)
      for (const id of [...SHOW_DISTRICTS.kathputli, ...SHOW_DISTRICTS.ravanhatta]) {
        expect(show.goal).toContain(DISTRICT_SHORT_NAMES[id][lang])
        expect(show.hint).toContain(DISTRICT_SHORT_NAMES[id][lang])
      }
    }
    expect(goalText(goalById('cricket')!, 'hi').goal).toBe(
      'Gulabi Shahar, MI Road ya Malviya Nagar mein gali cricket ki ek paari khelo',
    )
    expect(goalText(goalById('show')!, 'en').goal).toBe(
      'Watch a street show to the end in Pink City, Amer, MI Road or Nahargarh',
    )
    expect(goalText(goalById('show')!, 'hi').hint).toContain(
      'Kathputli Gulabi Shahar aur Amer mein hai, ravanhatta MI Road aur Nahargarh mein.',
    )
  })

  it('never names the evening: the show goal is for the shows that are out all day', () => {
    for (const lang of LANGS) {
      const { goal, hint } = goalText(goalById('show')!, lang)
      expect(`${goal} ${hint}`).not.toMatch(/dancer|nritya|kalbelia|shaam|evening/i)
    }
  })
})

describe('where the goals can be done', () => {
  it('the places named are the districts that have a pitch, and a show that is out at any hour', async () => {
    const cricket: string[] = []
    const shows: Record<string, string[]> = { kathputli: [], ravanhatta: [] }
    for (const id of DISTRICTS) {
      const def = await loadDef(id)
      if (def.cricket) cricket.push(id)
      for (const s of showsOf(def)) if (s.kind !== 'dancers') shows[s.kind]!.push(id)
    }
    expect([...CRICKET_DISTRICTS]).toEqual(cricket)
    expect(SHOW_DISTRICTS).toEqual(shows)
    expect(cricket.length).toBeGreaterThan(0)
    expect(shows.kathputli!.length + shows.ravanhatta!.length).toBeGreaterThan(0)
  })

  it('the rest can be done in whichever district the player is in, by day: chai, and a bell or a pump', async () => {
    // "Chai har mohalle mein milti hai"
    expect([...dishDistricts('chai')].sort()).toEqual([...DISTRICTS].sort())
    for (const id of DISTRICTS) {
      const def = await loadDef(id)
      // a diya waits for sunset and the pigeons are no deed: something else must answer a touch at noon
      const byDay = (def.touchables ?? []).filter((s) => s.kind === 'bell' || s.kind === 'pump')
      expect(byDay.length, id).toBeGreaterThan(0)
      // and an animal to feed or pet
      expect(def.animals.cow, id).toBeDefined()
    }
  })
})
