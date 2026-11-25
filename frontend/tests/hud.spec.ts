import { expect, test, type Locator, type Page } from '@playwright/test'
import { closePeople, hopTo, resident, verify } from './support/people'

/** A small phone, held upright. */
const PHONE = { width: 360, height: 740 }
test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

/** The most of the screen's height the HUD's top block may take, so the street stays playable. */
const TOP_SHARE = 0.35
const API = 'http://127.0.0.1:8787'

test.afterEach(closePeople)

/** The festival with a procession, the city line and the weather, all at once: the busiest the news gets. */
/** Every Jaipur Darshan stamp (stamps.json), for the widest stamps chip: the collector's. */
const ALL_STAMPS = [
  'hawa-mahal',
  'jantar-mantar',
  'tripolia-gate',
  'badi-chaupar',
  'albert-hall',
  'ram-niwas-gate',
  'university-gate',
  'jkk',
  'wtp',
  'amer-fort',
  'nahargarh-fort',
  'jal-mahal',
  'city-palace',
  'galta-ji',
]

async function busiest(
  page: Page,
  district?: string,
  lang?: 'hi' | 'en',
  festival = 'gangaur',
  stamps: readonly string[] = [],
) {
  if (district) await page.addInitScript((d) => localStorage.setItem('gg-district', d), district)
  if (stamps.length)
    await page.addInitScript((s) => localStorage.setItem('gg-stamps', JSON.stringify(s)), stamps)
  if (lang) await page.addInitScript((l) => localStorage.setItem('gg-lang', l), lang)
  // The city line's text sets how the HUD wraps. A live /api/city reply (the local Worker asks Open-Meteo, up
  // to 8 s) could land after the patch below and swap in today's real weather, so the reply is fixed too.
  const now = new Date()
  const at = (h: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h).toISOString()
  await page.route('**/api/city*', (route) =>
    route.fulfill({
      json: {
        fetchedAt: now.toISOString(),
        tempC: 31,
        condition: 'clear',
        aqi: 162,
        aqiBand: 'unhealthy',
        sunrise: at(6),
        sunset: at(18),
        festival: null,
        stale: false,
      },
    }),
  )
  await page.goto(`/?gg-test=1&gg-festival=${festival}`)
  await page.getByRole('button', { name: lang === 'en' ? 'Come in' : 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  await page.evaluate(() =>
    window.__gg.setSnapshot({ stale: false, tempC: 31, aqi: 162, aqiBand: 'unhealthy', condition: 'clear' }),
  )
}

/**
 * Every item whole, on the screen and above `TOP_SHARE` of its height; none on another (but `inside`, a pair
 * where one is part of the other, like a badge on its button); the info chips one line each; the switches
 * thumb-sized.
 */
async function laidOut(items: Record<string, Locator>, inside: [string, string][] = []) {
  for (const item of Object.values(items)) await expect(item).toBeVisible()
  const boxes = Object.fromEntries(
    await Promise.all(Object.entries(items).map(async ([k, l]) => [k, (await l.boundingBox())!] as const)),
  )
  for (const [k, b] of Object.entries(boxes)) {
    // whole, on the screen, and above the street
    expect.soft(b.x, `${k} left`).toBeGreaterThanOrEqual(0)
    expect.soft(b.x + b.width, `${k} right`).toBeLessThanOrEqual(PHONE.width)
    expect.soft(b.y + b.height, `${k} bottom`).toBeLessThanOrEqual(PHONE.height * TOP_SHARE)
  }
  // nothing sits on anything else
  const keys = Object.keys(boxes)
  const nested = (a: string, b: string) =>
    inside.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      if (nested(keys[i]!, keys[j]!)) continue
      const a = boxes[keys[i]!]!
      const b = boxes[keys[j]!]!
      const apart =
        a.x + a.width <= b.x + 0.5 ||
        b.x + b.width <= a.x + 0.5 ||
        a.y + a.height <= b.y + 0.5 ||
        b.y + b.height <= a.y + 0.5
      expect.soft(apart, `${keys[i]} overlaps ${keys[j]}`).toBe(true)
    }
  // one line each, not squeezed into a column of words
  for (const k of ['place', 'weather', 'stamps'])
    expect.soft(boxes[k]!.height, `${k} height`).toBeLessThanOrEqual(40)
  // thumb-sized switches
  for (const k of ['lang', 'sound', 'bandar', 'look'].filter((k) => k in boxes)) {
    expect.soft(boxes[k]!.width, `${k} width`).toBeGreaterThanOrEqual(44)
    expect.soft(boxes[k]!.height, `${k} height`).toBeGreaterThanOrEqual(44)
  }
  // the "Aaj ka Darshan" chip is drawn slim, but its tap area (an ::after 5 px out each side) is thumb-sized
  if (boxes.today) {
    expect.soft(boxes.today.height, 'today height').toBeGreaterThanOrEqual(44)
    expect.soft(boxes.today.width + 10, 'today tap width').toBeGreaterThanOrEqual(44)
  }
}

type L = 'hi' | 'en'

/** The words the busiest HUD's items are found by, in each language. */
const WORDS = {
  hi: {
    map: 'Naksha',
    ghost: 'Abhi koi tumhe dekh nahi sakta',
    signIn: 'Dikhna hai? Login karo',
    sees: 'Jaipur tumhe dekh sakta hai',
  },
  en: {
    map: 'Map',
    ghost: 'Nobody can see you yet',
    signIn: 'Want to be seen? Sign in',
    sees: 'Jaipur can see you',
  },
} as const

/** The chips and switches every visitor has; the place chip is the map's button, named by the full name. */
function common(page: Page, place = 'Gulabi Shahar', lang: L = 'hi'): Record<string, Locator> {
  const toggles = page.locator('.hud-toggles')
  return {
    place: page.getByRole('button', { name: `${WORDS[lang].map} · ${place}`, exact: true }),
    weather: page.locator('.hud-top .hud-chip').nth(1),
    stamps: page.locator('.stamp-count'),
    lang: toggles.locator('.lang-toggle'),
    sound: toggles.locator('.sound-toggle'),
    // the monkey's switch, where the bandar lives: the Walled City and Galta Ji
    ...(place === 'Gulabi Shahar' || place === 'Pink City' || place === 'Galta Ji'
      ? { bandar: toggles.locator('.bandar-toggle') }
      : {}),
    banner: page.locator('.festival-banner'),
    procession: page.locator('.procession-line'),
    line: page.locator('.city-line'),
    // the card's own box, not only the lines in it
    news: page.locator('.hud-news'),
    // "Aaj ka Darshan": every visitor's, at the end of the identity row
    today: page.locator('.hud-identity .today-chip'),
  }
}

/** The festival card holds its lines. */
const NEWS: [string, string][] = [
  ['news', 'banner'],
  ['news', 'procession'],
  ['news', 'line'],
]

test('on a small phone the HUD keeps to the top, with every chip whole and in reach', async ({ page }) => {
  // the busiest HUD a guest has: a festival with a procession, the sign-in nudge, the city line
  await busiest(page)
  const items: Record<string, Locator> = {
    ...common(page),
    ghost: page.getByText(WORDS.hi.ghost, { exact: true }),
    signIn: page.getByRole('button', { name: WORDS.hi.signIn }),
    look: page.locator('.hud-toggles .look-button'),
  }
  await laidOut(items, NEWS)
  await expect(items.weather!).toContainText('AQI 162')
})

/** Every district, with the full name its map button is labelled by, in each language. */
const DISTRICTS = [
  ['walled-city', 'Gulabi Shahar', 'Pink City'],
  ['mi-road', 'MI Road–Raja Park', 'MI Road & Raja Park'],
  ['university', 'University–JKK', 'University & JKK'],
  ['malviya-nagar', 'Malviya Nagar–WTP', 'Malviya Nagar & WTP'],
  ['amer', 'Amer', 'Amer'],
  ['nahargarh', 'Nahargarh', 'Nahargarh'],
  ['galta', 'Galta Ji', 'Galta Ji'],
] as const
const LANGS: L[] = ['hi', 'en']

/** A picture of the busiest HUD, when GG_HUD_SHOTS names a directory. */
const shot = (page: Page, name: string) =>
  process.env.GG_HUD_SHOTS ? page.screenshot({ path: `${process.env.GG_HUD_SHOTS}/${name}.png` }) : undefined

for (const lang of LANGS)
  for (const [id, hi, en] of DISTRICTS)
    // Gangaur everywhere; a Teej day too, in the district with the longest name
    for (const festival of id === 'malviya-nagar' ? ['gangaur', 'teej'] : ['gangaur']) {
      const place = lang === 'en' ? en : hi
      test(`a guest's busiest HUD fits in ${place} (${lang}, ${festival}): festival, procession, city line, sign-in nudge`, async ({
        page,
      }) => {
        await busiest(page, id, lang, festival)
        await laidOut(
          {
            ...common(page, place, lang),
            ghost: page.getByText(WORDS[lang].ghost, { exact: true }),
            signIn: page.getByRole('button', { name: WORDS[lang].signIn }),
            look: page.locator('.hud-toggles .look-button'),
          },
          NEWS,
        )
        await shot(page, `guest-${lang}-${id}-${festival}`)
      })

      test(`signed in on a small phone, the identity row fits too in ${place} (${lang}, ${festival}): visibility, profile, invite, connections and its badge`, async ({
        browser,
      }) => {
        const phone = { viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
        const asha = await resident(browser, 'Asha', phone)
        // someone verified asks to meet her, so Connections carries a badge
        const ravi = await resident(browser, 'Ravi')
        expect(
          (await ravi.page.request.post(`${API}/api/dev/verify`, { data: { userId: ravi.id } })).status(),
        ).toBe(200)
        const token = await ravi.page.evaluate(() => sessionStorage.getItem('gg-dev-token')!)
        const asked = await ravi.page.request.post(`${API}/api/requests`, {
          headers: { Authorization: `Bearer ${token}` },
          data: { to: asha.id, reason: 'Mujhe bhi chai aur kitaabein pasand hain' },
        })
        expect(asked.status()).toBe(201)

        const { page } = asha
        await busiest(page, id, lang, festival)
        const conn = page.locator('.conn-button')
        const items: Record<string, Locator> = {
          ...common(page, place, lang),
          visibility: page.getByText(WORDS[lang].sees, { exact: true }),
          profile: page.locator('.hud-identity .profile-button:not(.invite-button):not(.conn-button)'),
          invite: page.locator('.invite-button'),
          connections: conn,
          badge: conn.locator('.conn-badge'),
        }
        await expect(items.badge!).toHaveText('1')
        await laidOut(items, [['connections', 'badge'], ...NEWS])
        await shot(page, `signed-${lang}-${id}-${festival}`)
      })
    }

// New Year: the greeting has no procession under it; it fits on MI Road, where its lights are, and in the
// district with the longest name, in each language.
const NEW_YEAR = {
  hi: 'Naya saal mubarak, Jaipur! 🎆',
  en: 'Happy New Year, Jaipur! 🎆',
}
for (const lang of LANGS)
  for (const [id, hi, en] of DISTRICTS.filter(([d]) => d === 'mi-road' || d === 'malviya-nagar')) {
    const place = lang === 'en' ? en : hi
    test(`New Year's greeting fits in ${place} (${lang}): festival, city line, sign-in nudge`, async ({
      page,
    }) => {
      await busiest(page, id, lang, 'newyear')
      const items = common(page, place, lang)
      delete items.procession
      await expect(page.locator('.procession-line')).toHaveCount(0)
      await expect(items.banner!).toHaveText(NEW_YEAR[lang])
      await laidOut(
        {
          ...items,
          ghost: page.getByText(WORDS[lang].ghost, { exact: true }),
          signIn: page.getByRole('button', { name: WORDS[lang].signIn }),
        },
        NEWS.filter(([, k]) => k !== 'procession'),
      )
      // the greeting keeps to one line of the card
      const lines = await items.banner!.evaluate((el) => {
        const range = document.createRange()
        range.selectNodeContents(el)
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size
      })
      expect(lines).toBe(1)
      await shot(page, `guest-${lang}-${id}-newyear`)
    })
  }

// A misty winter dawn over clean air: the city line speaks of the fog. With a Gangaur procession too, in the
// district with the longest name, in each language.
const MIST_LINE = {
  hi: 'Kohre wali subah — garam chai ka time.',
  en: 'A foggy winter morning. Hot chai weather.',
}
for (const lang of LANGS) {
  const place = lang === 'en' ? 'Malviya Nagar & WTP' : 'Malviya Nagar–WTP'
  test(`a misty winter morning's city line fits in ${place} (${lang})`, async ({ page }) => {
    await busiest(page, 'malviya-nagar', lang, 'gangaur')
    await page.evaluate(() => {
      window.__gg.setNow('2027-01-10T01:30:00Z') // 07:00 IST
      window.__gg.setSnapshot({ aqi: 40, aqiBand: 'good' })
    })
    const items = common(page, place, lang)
    await expect(items.line!).toHaveText(MIST_LINE[lang])
    await laidOut(
      {
        ...items,
        ghost: page.getByText(WORDS[lang].ghost, { exact: true }),
        signIn: page.getByRole('button', { name: WORDS[lang].signIn }),
      },
      NEWS,
    )
    await shot(page, `guest-${lang}-malviya-nagar-mist`)
  })
}

/** The stamps chip on the place's row, not wrapped onto one of its own. */
async function oneRow(page: Page, place: Locator) {
  const a = (await place.boundingBox())!
  const b = (await page.locator('.stamp-count').boundingBox())!
  expect(Math.abs(b.y + b.height / 2 - (a.y + a.height / 2)), 'stamps on the place chip row').toBeLessThan(4)
}

// The collector's chip, in the district with the longest short name: every stamp, guest and signed in.
for (const lang of LANGS) {
  const place = lang === 'en' ? 'Malviya Nagar & WTP' : 'Malviya Nagar–WTP'
  test(`with every stamp the busiest HUD still fits in ${place} (${lang}), the chip on the place's row`, async ({
    page,
  }) => {
    // and today's goal done, five days running: the chip's tick and the stamps chip's accent are on too
    await page.addInitScript(() => {
      const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
      localStorage.setItem('gg-today', JSON.stringify({ last: day, streak: 5, best: 5 }))
    })
    await busiest(page, 'malviya-nagar', lang, 'gangaur', ALL_STAMPS)
    const items: Record<string, Locator> = {
      ...common(page, place, lang),
      ghost: page.getByText(WORDS[lang].ghost, { exact: true }),
      signIn: page.getByRole('button', { name: WORDS[lang].signIn }),
      look: page.locator('.hud-toggles .look-button'),
      tick: page.locator('.today-chip .today-tick'),
    }
    await expect(page.locator('.stamp-count')).toHaveAccessibleName(/\(14\/14\)$/)
    await expect(page.locator('.stamp-count')).toHaveAttribute('data-streak', '')
    await laidOut(items, [['today', 'tick'], ...NEWS])
    await oneRow(page, items.place!)
    await shot(page, `guest-${lang}-malviya-nagar-all-stamps`)
  })

  test(`signed in with every stamp, the identity row fits too in ${place} (${lang})`, async ({ browser }) => {
    const phone = { viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    const asha = await resident(browser, 'Asha', phone)
    const { page } = asha
    await busiest(page, 'malviya-nagar', lang, 'gangaur', ALL_STAMPS)
    const items: Record<string, Locator> = {
      ...common(page, place, lang),
      visibility: page.getByText(WORDS[lang].sees, { exact: true }),
      profile: page.locator('.hud-identity .profile-button:not(.invite-button):not(.conn-button)'),
      invite: page.locator('.invite-button'),
    }
    await expect(page.locator('.stamp-count')).toHaveAccessibleName(/\(14\/14\)$/)
    await laidOut(items, NEWS)
    await oneRow(page, items.place!)
    await shot(page, `signed-${lang}-malviya-nagar-all-stamps`)
  })
}

// One stamp short of all of them, the chip says the whole "13/14": as wide as the count gets, and it has to fit too.
for (const lang of LANGS) {
  const place = lang === 'en' ? 'Malviya Nagar & WTP' : 'Malviya Nagar–WTP'
  test(`one stamp short, the widest count still fits in ${place} (${lang}), guest and signed in`, async ({
    page,
    browser,
  }) => {
    const short = ALL_STAMPS.slice(0, -1)
    await busiest(page, 'malviya-nagar', lang, 'gangaur', short)
    await expect(page.locator('.stamp-count')).toHaveText(`${short.length}/${ALL_STAMPS.length}`)
    const guest: Record<string, Locator> = {
      ...common(page, place, lang),
      ghost: page.getByText(WORDS[lang].ghost, { exact: true }),
      signIn: page.getByRole('button', { name: WORDS[lang].signIn }),
    }
    await laidOut(guest, NEWS)
    await oneRow(page, guest.place!)
    await shot(page, `guest-${lang}-malviya-nagar-one-short`)

    const phone = { viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    const asha = await resident(browser, 'Asha', phone)
    await busiest(asha.page, 'malviya-nagar', lang, 'gangaur', short)
    await expect(asha.page.locator('.stamp-count')).toHaveText(`${short.length}/${ALL_STAMPS.length}`)
    const signed: Record<string, Locator> = {
      ...common(asha.page, place, lang),
      visibility: asha.page.getByText(WORDS[lang].sees, { exact: true }),
      profile: asha.page.locator('.hud-identity .profile-button:not(.invite-button):not(.conn-button)'),
      invite: asha.page.locator('.invite-button'),
    }
    await laidOut(signed, NEWS)
    await oneRow(asha.page, signed.place!)
    await shot(asha.page, `signed-${lang}-malviya-nagar-one-short`)
  })
}

test('the HUD switches say what they do, and show their state only through aria-pressed', async ({
  page,
}) => {
  await page.goto('/?gg-test=1')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  const bandar = page.getByRole('button', { name: 'Bandar band karo' })
  await expect(bandar).toHaveAttribute('aria-pressed', 'false')
  await bandar.focus()
  await page.keyboard.press('Enter')
  // still the same switch, now pressed: the monkey is off
  await expect(bandar).toHaveAttribute('aria-pressed', 'true')
  // pressed, it shows its off edge; with the keyboard on it, the focus ring wins over that dashed edge
  await expect(bandar).toHaveCSS('outline-width', '3px')
  await expect(bandar).toHaveCSS('outline-style', 'solid')
  expect(await page.evaluate(() => localStorage.getItem('gg-no-bandar'))).toBe('1')
  await page.keyboard.press('Enter')
  await expect(bandar).toHaveAttribute('aria-pressed', 'false')
})

/** Each item whole on the screen, and none on another. */
async function sideBySide(items: Record<string, Locator>) {
  // A button appears a frame after the teleport that brings it into reach: measuring before it is there read
  // a null box (the one flake of a full run). Wait for each, then measure.
  for (const item of Object.values(items)) await expect(item).toBeVisible()
  const boxes = Object.entries(
    Object.fromEntries(
      await Promise.all(Object.entries(items).map(async ([k, l]) => [k, (await l.boundingBox())!] as const)),
    ),
  )
  for (const [k, b] of boxes) {
    expect.soft(b.x, `${k} left`).toBeGreaterThanOrEqual(0)
    expect.soft(b.x + b.width, `${k} right`).toBeLessThanOrEqual(PHONE.width)
    expect.soft(b.y + b.height, `${k} bottom`).toBeLessThanOrEqual(PHONE.height)
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
      expect.soft(apart, `${ka} overlaps ${kb}`).toBe(true)
    }
}

test('on a small phone with a dog in tow, the bottom row fits: on foot by an auto, and at its wheel', async ({
  page,
}) => {
  // the city offline, as in city.spec.ts: a live district would pull a teleported player back
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await page.goto('/?gg-test=1')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  // the street dog by the start (see animals.spec.ts) comes along
  await page.evaluate(() => window.__gg.freezeAnimals(true))
  const dog = await page.evaluate(() => window.__gg.animals().find((a) => a.id === 'walled-city-dog-0')!)
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z + 1.6), dog)
  await page.getByRole('button', { name: 'Saath chalo' }).click()
  await expect
    .poll(() =>
      page.evaluate(() => window.__gg.animals().find((a) => a.id === 'walled-city-dog-0')!.following),
    )
    .toBe(true)

  // on foot beside the walled city's auto: the joystick, "Auto chalao" and "Ghar jao"
  await page.evaluate(() => window.__gg.teleport(24, -2.5))
  const joystick = page.locator('.joystick')
  const mount = page.getByRole('button', { name: 'Auto chalao' })
  const home = page.getByRole('button', { name: 'Ghar jao' })
  await sideBySide({ joystick, mount, home })
  await page.screenshot({ path: '../.superpowers/sdd/2026-11-14-phase-4-extras/launch-b-onfoot-360.png' })

  // at the wheel: the joystick, the horn and the way out ("Ghar jao" waits until the player is out again)
  await mount.tap()
  const horn = page.getByRole('button', { name: 'Horn bajao' })
  const exit = page.getByRole('button', { name: 'Utro' })
  await expect(exit).toBeVisible()
  await expect(home).toBeHidden()
  await sideBySide({ joystick, horn, exit })
  await page.waitForTimeout(600) // the camera settles behind the auto, for the picture
  await page.screenshot({ path: '../.superpowers/sdd/2026-11-14-phase-4-extras/launch-b-driving-360.png' })
})

/** The Walled City's tapri by Johari Bazaar, at (-5.6, 36), its counter facing east. */
const TAPRI = { x: -5.6, z: 36 }

test('seated at a tapri on a small phone, the bench panel and the joystick fit side by side, with no street button on them', async ({
  browser,
}) => {
  // Seated and "Auto chalao" together cannot happen: benches.test.ts holds every seat out of an auto's
  // reach. So the bottom row seated is the panel and the joystick, and the street's buttons are gone.
  const phone = { viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  const asha = await resident(browser, 'Asha', phone)
  const { page } = asha
  await hopTo(page, TAPRI.x + 2.2, TAPRI.z + 0.5)
  await page.getByRole('button', { name: 'Baitho' }).click()
  const panel = page.getByRole('region', { name: 'Tapri pe' })
  await expect(panel).toBeVisible()
  // the card slides up for 220 ms: measure where it comes to rest, not where it starts
  await panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  await sideBySide({ panel, joystick: page.locator('.joystick') })
  await expect(page.locator('.hud-actions button')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Auto chalao' })).toHaveCount(0)
})

/** The most of the screen's height a card at the bottom may take, so the street above stays in view. */
const CARD_SHARE = 0.4

test('a landmark card on a small phone: "Bulao" sits on the stamp row, and the card stays beside the joystick', async ({
  page,
}) => {
  // in by a link to Albert Hall (offline, as in city.spec.ts), which stands you in its ring
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await page.goto('/?gg-test=1&at=mi-road:albert-hall')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  const card = page.getByRole('region', { name: 'Albert Hall' })
  await expect(card).toBeVisible()
  await card.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  const stamp = card.getByRole('button', { name: 'Stamp lo' })
  const bulao = card.getByRole('button', { name: 'Bulao: Albert Hall ka link bhejo' })
  await sideBySide({ card, joystick: page.locator('.joystick') })
  const [c, s, b] = [(await card.boundingBox())!, (await stamp.boundingBox())!, (await bulao.boundingBox())!]
  expect(c.height, 'card height').toBeLessThanOrEqual(PHONE.height * CARD_SHARE)
  // one row of actions: Bulao beside the stamp button, not wrapped under it, and thumb-sized
  expect(Math.abs(b.y + b.height / 2 - (s.y + s.height / 2)), 'Bulao on the stamp row').toBeLessThan(4)
  expect(b.x + b.width, 'Bulao inside the card').toBeLessThanOrEqual(c.x + c.width)
  expect(b.width).toBeGreaterThanOrEqual(44)
  expect(b.height).toBeGreaterThanOrEqual(44)
  if (process.env.GG_CARD_SHOT) await page.screenshot({ path: process.env.GG_CARD_SHOT })
})

test('seated at a tapri on a small phone, the panel head keeps its title, "Bulao" and Utho on one row', async ({
  browser,
}) => {
  const phone = { viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  const { page } = await resident(browser, 'Bina', phone)
  await hopTo(page, TAPRI.x + 2.2, TAPRI.z + 0.5)
  await page.getByRole('button', { name: 'Baitho' }).click()
  const panel = page.getByRole('region', { name: 'Tapri pe' })
  await expect(panel).toBeVisible()
  await panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  const title = panel.getByRole('heading', { name: 'Tapri pe' })
  const bulao = panel.getByRole('button', { name: /^Bulao: Chai ki tapri \d+ ka link bhejo$/ })
  const utho = panel.getByRole('button', { name: 'Utho' })
  await sideBySide({ panel, joystick: page.locator('.joystick') })
  await sideBySide({ title, bulao, utho })
  const boxes = await Promise.all([title, bulao, utho].map(async (l) => (await l.boundingBox())!))
  const mid = (b: { y: number; height: number }) => b.y + b.height / 2
  for (const b of boxes.slice(1)) expect(Math.abs(mid(b) - mid(boxes[0]!)), 'one row').toBeLessThan(6)
  for (const b of boxes.slice(1)) expect(b.height, 'thumb-sized').toBeGreaterThanOrEqual(44)
  if (process.env.GG_BENCH_SHOT) await page.screenshot({ path: process.env.GG_BENCH_SHOT })
})

/** The Pink City's poster wall on Johari Bazaar, at (-6, 48), its face to +x: 1.5 m in front of it. */
const BY_WALL = { x: -4.5, z: 48 }
/** A plan as long as a poster takes (140 characters), so the card is as tall as it gets. */
const LONG_PLAN = (tag: string) =>
  `Chai at the Tapri, then a slow walk round Johari Bazaar and up to the Hawa Mahal view, all welcome ${tag}`
    .padEnd(140, '.')
    .slice(0, 140)

/**
 * A card at the bottom fits between the top block and the screen's foot (it scrolls inside when it must), and
 * every control in it can be reached: scrolled into view it is on the screen, inside the card, and nothing
 * covers it (a trial tap would land on it).
 */
async function reachable(page: Page, card: Locator, controls: Locator[]) {
  await card.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  const head = (await page.locator('.hud-head').boundingBox())!
  const c = (await card.boundingBox())!
  expect.soft(c.y, 'card top below the HUD head').toBeGreaterThanOrEqual(head.y + head.height)
  expect.soft(c.y + c.height, 'card bottom on the screen').toBeLessThanOrEqual(PHONE.height)
  expect.soft(c.x, 'card left').toBeGreaterThanOrEqual(0)
  expect.soft(c.x + c.width, 'card right').toBeLessThanOrEqual(PHONE.width)
  for (const control of controls) {
    await expect(control).toBeVisible()
    await control.scrollIntoViewIfNeeded()
    const b = (await control.boundingBox())!
    const name = (await control.textContent()) ?? ''
    expect.soft(b.y, `${name} top`).toBeGreaterThanOrEqual(c.y - 0.5)
    expect
      .soft(b.y + b.height, `${name} bottom`)
      .toBeLessThanOrEqual(Math.min(PHONE.height, c.y + c.height) + 0.5)
    expect.soft(b.height, `${name} thumb-sized`).toBeGreaterThanOrEqual(44)
    await control.click({ trial: true, timeout: 2000 })
  }
}

test('a poster card on a small phone: a 140-character plan you are coming to, and its owner with the names, every button in reach', async ({
  browser,
}) => {
  const phone = { viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  const owner = await resident(browser, 'Asha', phone)
  await verify(owner.page)
  const viewer = await resident(browser, 'Bina', phone)
  await verify(viewer.page)
  const plan = LONG_PLAN(String(Date.now() % 100000))
  expect(plan).toHaveLength(140)
  const token = await owner.page.evaluate(() => sessionStorage.getItem('gg-dev-token')!)
  const pinned = await owner.page.request.post(`${API}/api/posters`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { district: 'walled-city', wall: 0, text: plan, when: Date.now() + 3 * 3600_000 },
  })
  expect(pinned.status()).toBe(201)

  const tapPlan = async (page: Page) => {
    await hopTo(page, BY_WALL.x, BY_WALL.z)
    await expect
      .poll(() => page.evaluate((text) => window.__gg.posters().some((p) => p.text === text), plan))
      .toBe(true)
    const [at] = await page.evaluate((text) => window.__gg.posters().filter((p) => p.text === text), plan)
    await page.mouse.click(at!.sx, at!.sy)
    const card = page.getByRole('region', { name: 'Deewar ka poster' })
    await expect(card).toBeVisible()
    return card
  }

  await test.step('a verified viewer who said they are coming', async () => {
    const card = await tapPlan(viewer.page)
    await card.getByRole('button', { name: 'Main aaunga/aaungi' }).click()
    await expect(card.getByText('Aane wale: 1')).toBeVisible()
    await reachable(viewer.page, card, [
      card.getByRole('button', { name: 'Nahi aa paunga/paungi' }),
      card.getByRole('button', { name: 'Block karo' }),
      card.getByRole('button', { name: 'Report karo' }),
      card.getByRole('button', { name: 'Band karo' }),
    ])
    if (process.env.GG_CARD_SHOT)
      await viewer.page.screenshot({ path: `${process.env.GG_CARD_SHOT}-poster-viewer.png` })
  })

  await test.step("the owner's card, with who is coming", async () => {
    const card = await tapPlan(owner.page)
    await expect(card.getByText(`Kaun aa raha hai: ${viewer.name}`)).toBeVisible()
    await reachable(owner.page, card, [
      card.getByRole('button', { name: 'Utaaro' }),
      card.getByRole('button', { name: 'Band karo' }),
    ])
    if (process.env.GG_CARD_SHOT)
      await owner.page.screenshot({ path: `${process.env.GG_CARD_SHOT}-poster-owner.png` })
  })
})

test('a person card on a small phone, with its greetings row, and a greeting toast offering a block: all in reach', async ({
  browser,
}) => {
  const phone = { viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  const ravi = await resident(browser, 'Ravi', phone)
  const asha = await resident(browser, 'Asha', phone)
  await verify(asha.page)
  // Asha's district socket goes through here, so the test can hand her page what the district would say
  let socket: import('@playwright/test').WebSocketRoute | null = null
  await asha.page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, (ws) => {
    socket = ws
    ws.connectToServer()
  })
  await asha.page.reload()
  await asha.page.getByRole('button', { name: 'Padharo!' }).click()
  await asha.page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  await expect(asha.page.getByText('Jaipur tumhe dekh sakta hai')).toBeVisible()
  await expect
    .poll(() => asha.page.evaluate((id) => window.__gg.people().some((p) => p.id === id), ravi.id))
    .toBe(true)

  await test.step("Ravi's card, with the greetings row", async () => {
    const at = await ravi.page.evaluate(() => window.__gg.position())
    await hopTo(asha.page, at.x + 1.2, at.z)
    await asha.page.keyboard.press('e')
    const card = asha.page.getByRole('region', { name: ravi.name })
    await expect(card).toBeVisible()
    const greet = card.getByRole('group', { name: 'Door se hi salaam' })
    await reachable(asha.page, card, [
      greet.getByRole('button', { name: 'Haath hilao 👋' }),
      greet.getByRole('button', { name: 'Namaste 🙏' }),
      card.getByRole('button', { name: 'Block karo' }),
      card.getByRole('button', { name: 'Band karo' }),
    ])
    if (process.env.GG_CARD_SHOT)
      await asha.page.screenshot({ path: `${process.env.GG_CARD_SHOT}-person.png` })
    await card.getByRole('button', { name: 'Band karo' }).click()
  })

  await test.step('a third greeting from the same person: the toast offers a block, in reach', async () => {
    for (let i = 0; i < 3; i++)
      socket!.send(JSON.stringify({ t: 'react', from: ravi.id, to: asha.id, kind: 'wave' }))
    const offer = asha.page.getByRole('button', { name: `${ravi.name} ko block karo` })
    await expect(offer).toBeVisible()
    const toast = asha.page.locator('.reaction-toast')
    const t = (await toast.boundingBox())!
    expect.soft(t.x, 'toast left').toBeGreaterThanOrEqual(0)
    expect.soft(t.x + t.width, 'toast right').toBeLessThanOrEqual(PHONE.width)
    expect.soft(t.y + t.height, 'toast bottom').toBeLessThanOrEqual(PHONE.height)
    const b = (await offer.boundingBox())!
    expect.soft(b.height, 'block offer thumb-sized').toBeGreaterThanOrEqual(44)
    expect.soft(b.y + b.height, 'block offer on the screen').toBeLessThanOrEqual(PHONE.height)
    await offer.click({ trial: true, timeout: 2000 })
    if (process.env.GG_CARD_SHOT)
      await asha.page.screenshot({ path: `${process.env.GG_CARD_SHOT}-toast.png` })
  })
})
