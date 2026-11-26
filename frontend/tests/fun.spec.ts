import { expect, test, type Locator, type Page } from '@playwright/test'

/*
 * The things to do, together on a small phone: the emote chip is over the joystick all the time, so each of the
 * street's other new buttons is measured with it there, shut and open, beside the joystick, in both languages.
 * (Each feature's own spec measures its buttons alone.) The city is offline, as in hud.spec.ts: a live district
 * would pull a teleported player back.
 */

/** A small phone, held upright. */
const PHONE = { width: 360, height: 740 }
test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
/** Room kept against the screen's right edge and foot: CI's Linux fonts run a few px wider than a Mac's. */
const SLACK = 10

const SUN = { sunrise: '2026-11-20T01:15:00Z', sunset: '2026-11-20T12:05:00Z' }
const NOON = '2026-11-20T06:30:00Z'

type L = 'hi' | 'en'
const WORDS = {
  hi: {
    enter: 'Padharo!',
    chip: 'Mood dikhao',
    kinds: ['Naacho', 'Taali', 'Baith jao', 'Selfie pose', 'Haath hilao'],
    taste: 'Chakho',
    sit: 'Baitho',
    call: 'Saath chalo',
    pet: 'Pyaar karo',
    home: 'Ghar jao',
    cricket: 'Cricket khelo',
    bell: 'Ghanti bajao',
    pump: 'Paani chalao',
    clap: 'Taali bajao',
    show: 'Kathputli ka khel',
    close: 'Band karo',
  },
  en: {
    enter: 'Come in',
    chip: 'Show a mood',
    kinds: ['Dance', 'Clap', 'Sit down', 'Selfie pose', 'Wave'],
    taste: 'Taste it',
    sit: 'Sit here',
    call: 'Come along',
    pet: 'Pet',
    home: 'Go home',
    cricket: 'Play cricket',
    bell: 'Ring the bell',
    pump: 'Work the pump',
    clap: 'Clap',
    show: 'Kathputli puppet show',
    close: 'Close',
  },
} as const

/** In the walled city at noon on a clear day, the monkey out of it and the animals standing still. */
async function enter(page: Page, lang: L) {
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await page.route('**/api/city*', (route) =>
    route.fulfill({
      json: {
        fetchedAt: NOON,
        tempC: 24,
        condition: 'clear',
        aqi: 60,
        aqiBand: 'moderate',
        ...SUN,
        festival: null,
        stale: false,
      },
    }),
  )
  await page.addInitScript((l) => {
    localStorage.setItem('gg-no-bandar', '1')
    localStorage.setItem('gg-lang', l)
  }, lang)
  await page.goto('/?gg-test=1')
  await page.getByRole('button', { name: WORDS[lang].enter }).click()
  await page.waitForFunction(() => {
    const gg = (window as { __gg?: { touchables?: unknown; shows?: unknown } }).__gg
    return gg?.touchables !== undefined && typeof gg.shows === 'function'
  })
  await page.evaluate((s) => window.__gg.setSnapshot(s), SUN)
  await page.evaluate((at) => window.__gg.setNow(at), NOON)
  await page.evaluate(() => window.__gg.freezeAnimals(true))
}

const standAt = (page: Page, x: number, z: number) =>
  page.evaluate((p) => window.__gg.teleport(p.x, p.z), { x, z })
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

/**
 * Every item whole on the screen with `SLACK` to spare at the right and the foot, the buttons a thumb's size,
 * and none on another. Measured once the row has settled (a button arriving a moment after another moves it up
 * a row; a card slides in): two readings alike.
 */
async function together(items: Record<string, Locator>, what: string) {
  for (const [k, item] of Object.entries(items)) await expect(item, `${what}: ${k}`).toBeVisible()
  const read = async () =>
    Promise.all(Object.entries(items).map(async ([k, l]) => [k, (await l.boundingBox())!] as const))
  let boxes = await read()
  await expect
    .poll(async () => {
      const was = JSON.stringify(boxes)
      boxes = await read()
      return JSON.stringify(boxes) === was
    })
    .toBe(true)
  for (const [k, b] of boxes) {
    expect.soft(b.x, `${what}: ${k} left`).toBeGreaterThanOrEqual(0)
    expect.soft(b.x + b.width, `${what}: ${k} right`).toBeLessThanOrEqual(PHONE.width - SLACK)
    expect.soft(b.y, `${what}: ${k} top`).toBeGreaterThanOrEqual(0)
    expect.soft(b.y + b.height, `${what}: ${k} bottom`).toBeLessThanOrEqual(PHONE.height - SLACK)
    if (k !== 'card')
      expect.soft(Math.min(b.width, b.height), `${what}: ${k} is a thumb's size`).toBeGreaterThanOrEqual(44)
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [ka, a] = boxes[i]!
      const [kb, b] = boxes[j]!
      const apart =
        a.x + a.width <= b.x + 0.5 ||
        b.x + b.width <= a.x + 0.5 ||
        a.y + a.height <= b.y + 0.5 ||
        b.y + b.height <= a.y + 0.5
      expect.soft(apart, `${what}: ${ka} overlaps ${kb}`).toBe(true)
    }
}

/**
 * `others` (the street's buttons, or a card) beside the joystick with the emote chip shut, then with its five
 * open: nothing on anything else either way, and every one of `others` still takes a tap with the wheel open.
 */
async function withTheWheel(page: Page, lang: L, others: Record<string, Locator>, what: string) {
  const words = WORDS[lang]
  const joystick = page.locator('.joystick')
  const chip = button(page, words.chip)
  await together({ joystick, chip, ...others }, what)
  await chip.tap()
  const group = page.getByRole('group', { name: words.chip })
  const kinds = Object.fromEntries(
    words.kinds.map((name) => [name, group.getByRole('button', { name, exact: true })] as const),
  )
  await together({ joystick, chip, ...kinds, ...others }, `${what}, wheel open`)
  for (const [k, item] of Object.entries({ ...kinds, ...others }))
    if (k !== 'card') await item.click({ trial: true, timeout: 2000 })
  // shut again, for whatever is measured next
  await chip.tap()
  await expect(group).toHaveCount(0)
}

/** Johari Bazaar's tapri at (5.8, -40), its counter facing -x: it serves ghewar, and has a bench to sit on. */
const GHEWAR = { x: 5.8 - 2, z: -40 }
/** Sireh Deori bazaar's wayside bell. */
const BELL = { x: -5.5, z: -28 }

for (const lang of ['hi', 'en'] as const) {
  const words = WORDS[lang]

  test(`the emote chip and its wheel with "${words.taste}" and "${words.sit}" (${lang})`, async ({
    page,
  }) => {
    await enter(page, lang)
    await standAt(page, GHEWAR.x, GHEWAR.z)
    await withTheWheel(
      page,
      lang,
      { sit: button(page, words.sit), taste: button(page, words.taste) },
      'at a stall',
    )
  })

  test(`the emote chip and its wheel with an animal's two buttons and "${words.home}" (${lang})`, async ({
    page,
  }) => {
    await enter(page, lang)
    const animal = (id: string) => page.evaluate((i) => window.__gg.animals().find((a) => a.id === i)!, id)
    const dog = await animal('walled-city-dog-0')
    await standAt(page, dog.x, dog.z + 1.6)
    const call = button(page, words.call)
    const pet = button(page, words.pet)
    await withTheWheel(page, lang, { call, pet }, 'by a dog')
    await call.tap()
    await expect.poll(async () => (await animal('walled-city-dog-0')).following).toBe(true)
    // with the dog in tow beside a cat: come along, a pat, and the follower's way home
    const cat = await animal('walled-city-cat-0')
    await standAt(page, cat.x, cat.z + 1.6)
    await withTheWheel(page, lang, { call, pet, home: button(page, words.home) }, 'by a cat, a dog in tow')
  })

  test(`the emote chip and its wheel with "${words.cricket}" (${lang})`, async ({ page }) => {
    await enter(page, lang)
    const pitch = await page.evaluate(() => window.__gg.cricketPitch()!)
    await standAt(page, (pitch.stumps.x + pitch.bowler.x) / 2, (pitch.stumps.z + pitch.bowler.z) / 2 + 1.2)
    await withTheWheel(page, lang, { cricket: button(page, words.cricket) }, 'by the pitch')
  })

  test(`the emote chip and its wheel with a touch button: "${words.bell}", "${words.pump}" (${lang})`, async ({
    page,
  }) => {
    await enter(page, lang)
    await standAt(page, BELL.x + 1.6, BELL.z)
    await withTheWheel(page, lang, { bell: button(page, words.bell) }, 'by the bell')
    const pump = await page.evaluate(() => window.__gg.touchables().find((t) => t.kind === 'pump')!)
    await standAt(page, pump.x, pump.z + 1.6)
    await withTheWheel(page, lang, { pump: button(page, words.pump) }, 'by the pump')
  })

  test(`the emote chip and its wheel with a show's card, and then "${words.clap}" (${lang})`, async ({
    page,
  }) => {
    await enter(page, lang)
    const show = () => page.evaluate(() => window.__gg.shows().find((s) => s.kind === 'kathputli'))
    await expect.poll(show).toMatchObject({ out: true, phase: 'idle' })
    const stage = (await show())!
    // where its audience stands: it plays, and the first time its card comes up with the clap on it
    await standAt(page, stage.x, stage.z + 4.2)
    await expect.poll(async () => (await show())!.phase).toBe('playing')
    const card = page.getByRole('region', { name: words.show })
    await expect(card).toBeVisible()
    await card.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
    await withTheWheel(page, lang, { card }, "with the show's card")
    const onCard = card.getByRole('button', { name: words.clap, exact: true })
    await expect(onCard).toBeInViewport({ ratio: 1 })
    expect((await onCard.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await card.getByRole('button', { name: words.close }).tap()
    await expect(card).toBeHidden()
    // the card gone, the clap is one of the street's buttons
    // (by its class: in English the wheel has a "Clap" of its own, the emote)
    const clap = page.locator('.show-button')
    await expect(clap).toHaveText(words.clap)
    await withTheWheel(page, lang, { clap }, 'while the show plays')
    // and by the bench on the same patch, still in earshot, it shares the row with the bench's button
    await standAt(page, 30, 18.4)
    await withTheWheel(
      page,
      lang,
      { clap, sit: button(page, words.sit) },
      'by a bench in earshot of the show',
    )
  })
}

test('the map lists the cricket pitch with its bat, picking it points the compass there, and a link stands you at the stumps', async ({
  page,
}) => {
  await enter(page, 'en')
  await page.getByRole('button', { name: 'Map · Pink City', exact: true }).tap()
  const map = page.getByRole('dialog', { name: 'Map · Pink City' })
  await expect(map.locator('.map-item[data-kind="cricket"]')).toHaveAccessibleName('Gali cricket pitch')
  const row = map.locator('.map-list:not(.map-more-list) button[data-kind="cricket"]')
  await expect(row).toContainText(/🏏 Gali cricket pitch · \d+ m/)
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await row.tap()
  await expect(map).toBeHidden()
  await expect(page.getByRole('button', { name: /^Gali cricket pitch · \d+ m/ })).toBeVisible()

  // its link: the preview page forwards to the app, which stands the visitor behind the stumps, in reach
  await page.goto('/p/mi-road/cricket/?gg-test=1')
  await page.getByRole('button', { name: 'Come in' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  await expect(button(page, 'Play cricket')).toBeVisible()
  const pitch = await page.evaluate(() => window.__gg.cricketPitch()!)
  const at = await page.evaluate(() => window.__gg.position())
  expect(Math.hypot(at.x - pitch.stumps.x, at.z - pitch.stumps.z)).toBeLessThan(2)
})
