// Makes the link previews' pictures (frontend/public/og/*.jpg, 1200x630): one per landmark
// (`<district>-<landmark>.jpg`), one per district (`<district>.jpg`, for its benches, tapris, poster walls, metro and
// viewpoint) and the site's (`default.jpg`, also the home page's card). See src/preview/pages.ts, which uses
// whichever exist. Not part of any test run: run it after a district or landmark is added or its look changes
// (`npm run og-images -w frontend`; `-- hawa-mahal amer` makes only the pictures whose names hold one of those),
// look at the pictures, and commit them. Run on a Mac with Chrome (it draws with the GPU), not in CI.
//
// Each picture is a real render: the site is built with test hooks, opened at 1200x630, entered through the place's
// own link (`?at=`, so the player stands where a link stands them, facing the landmark), stepped back so the camera
// takes it in, and shot at golden hour with the HUD hidden and NO ONE in the picture: the player, the characters
// and other people are all hidden (`__gg.hideFigures`), and the district socket is stubbed out (no one else is
// there to see). The places come from the built preview pages (dist/p/<district>/<place>/), so a new district or
// landmark gets its picture with no change here. A small wordmark names the place.
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { DISTRICT_NAMES } from '../frontend/src/world/districtNames.ts'

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url))
const out = join(frontend, 'public', 'og')
const PORT = 5179
const QUALITY = 78
const MAX_BYTES = 120 * 1024
// Today, 17:20 in Jaipur: a low, warm sun (the stubbed API's sunset is today's 18:00 IST).
const GOLDEN_HOUR = `${new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)}T17:20:00+05:30`
/** Not landmarks: these previews use the district's picture. */
const SMALL = /^(metro|viewpoint|(bench|tapri|poster)-\d+)$/

/**
 * How a landmark is framed, where the default (a few steps back from where its link stands you, the camera drawn
 * out a little and tilted up) does not suit: `turn` px dragged right across the screen first (960 is a half-turn
 * at 1200 px wide; negative turns left), `back` ms walked backwards (`walk`: the key, `s` unless said), `up` px
 * dragged down the screen (negative: up, tilting the view up), `zoom` wheel steps out.
 */
const FRAMING = {
  default: { back: 2600, up: -80, zoom: 2 },
  // the forts' links stand you at the gate facing out: turn round to them
  'amer-fort': { turn: 688, back: 1500, up: -120, zoom: 3 },
  'nahargarh-fort': { turn: 960, back: 1500, up: -100, zoom: 3 },
  'city-palace': { turn: -160, back: 1200, up: -200, zoom: 4 },
  wtp: { back: 1800, up: -280, zoom: 6 },
}

/** `OG_FRAME='{"back":1200,"up":-40,"zoom":0}'` tries a framing on whatever is made this run. */
const TRY = process.env.OG_FRAME ? JSON.parse(process.env.OG_FRAME) : null
const only = process.argv.slice(2)
const wanted = (name) => !only.length || only.some((w) => name.includes(w))

const dist = mkdtempSync(join(tmpdir(), 'gg-og-'))
let preview
let browser
try {
  execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], {
    cwd: frontend,
    env: { ...process.env, GG_ALLOW_LOCAL_API: '1', VITE_TEST_HOOKS: '1' },
    stdio: 'inherit',
  })
  preview = spawn(
    'npx',
    ['vite', 'preview', '--outDir', dist, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: frontend, stdio: 'ignore' },
  )
  const base = `http://127.0.0.1:${PORT}`
  for (let i = 0; ; i++) {
    if (
      await fetch(base).then(
        (r) => r.ok,
        () => false,
      )
    )
      break
    if (i > 100) throw new Error('vite preview did not start')
    await new Promise((r) => setTimeout(r, 200))
  }

  /** Every place with a preview page, by district, with the name its page gives it. */
  const districts = readdirSync(join(dist, 'p')).map((district) => ({
    district,
    landmarks: readdirSync(join(dist, 'p', district))
      .filter((place) => !SMALL.test(place))
      .map((place) => {
        const html = readFileSync(join(dist, 'p', district, place, 'index.html'), 'utf8')
        const name = /<h1>([^<]*)<\/h1>/.exec(html)[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'")
        return { place, name }
      }),
  }))

  // Installed Chrome draws with the GPU; Playwright's own Chromium is the fallback.
  browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())
  mkdirSync(out, { recursive: true })

  /** Opens the city at `at` (`<district>:<place>`), framed, and saves the shot as `file` with `mark` on it. */
  async function shoot(at, file, mark, framing) {
    const frame = { ...framing, ...TRY }
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
    await page.addInitScript(() => localStorage.setItem('gg-hinted', '1'))
    await page.routeWebSocket(/\/live$|\/inbox$/, () => {})
    await page.route('http://127.0.0.1:8787/**', (route) => route.abort())
    // gg-full: the real picture, not the test build's coarse one
    await page.goto(`${base}/?gg-test=1&gg-full=1&at=${at}`)
    await page.getByRole('button', { name: 'Padharo!' }).click()
    await page.waitForFunction(() => window.__gg !== undefined && window.__gg.framesSinceRestore() > 10)
    await page.evaluate((iso) => {
      window.__gg.setNow(iso)
      window.__gg.hideFigures(true)
    }, GOLDEN_HOUR)
    // nothing over the street but the wordmark below
    await page.addStyleTag({
      content:
        'body * { visibility: hidden !important; } canvas, .og-mark { visibility: visible !important; }',
    })
    const canvas = page.locator('canvas').first()
    const box = await canvas.boundingBox()
    const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    // turn first (a drag across the canvas; its full width turns the view 1.25 half-turns), in short drags
    for (let left = frame.turn ?? 0; Math.abs(left) > 0;) {
      const dx = Math.sign(left) * Math.min(Math.abs(left), 400)
      await page.mouse.move(mid.x - dx / 2, mid.y)
      await page.mouse.down()
      await page.mouse.move(mid.x + dx / 2, mid.y, { steps: 10 })
      await page.mouse.up()
      left -= dx
    }
    await page.waitForTimeout(600)
    if (frame.back) {
      await page.keyboard.down(frame.walk ?? 's')
      await page.waitForTimeout(frame.back)
      await page.keyboard.up(frame.walk ?? 's')
    }
    await page.mouse.move(mid.x, mid.y)
    for (let i = 0; i < frame.zoom; i++) {
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(40)
    }
    if (frame.up) {
      // a drag down the canvas tilts the view up
      await page.mouse.down()
      await page.mouse.move(mid.x, mid.y + frame.up, { steps: 10 })
      await page.mouse.up()
    }
    await page.evaluate((text) => {
      const el = document.createElement('div')
      el.className = 'og-mark'
      el.textContent = text
      Object.assign(el.style, {
        position: 'fixed',
        left: '32px',
        bottom: '28px',
        padding: '8px 20px',
        borderRadius: '999px',
        background: 'rgb(42 29 36 / 0.88)',
        color: '#f5e6d8',
        font: "700 30px 'Baloo 2', system-ui, sans-serif",
        zIndex: '10',
      })
      document.body.append(el)
    }, mark)
    await page.waitForTimeout(2500)
    const target = join(out, file)
    writeFileSync(target, await page.screenshot({ type: 'jpeg', quality: QUALITY }))
    await page.close()
    const size = statSync(target).size
    console.log(`${target}: ${Math.round(size / 1024)} kB`)
    if (size > MAX_BYTES) console.warn(`  over ${MAX_BYTES / 1024} kB`)
  }

  if (wanted('default.jpg'))
    await shoot('walled-city:nowhere', 'default.jpg', 'Gulabi Gali · Jaipur', {
      back: 900,
      walk: 'w',
      zoom: 0,
      up: 0,
    })
  for (const { district, landmarks } of districts) {
    const name = DISTRICT_NAMES[district]?.hi ?? district
    if (wanted(`${district}.jpg`))
      await shoot(`${district}:nowhere`, `${district}.jpg`, `${name} · Gulabi Gali`, {
        back: 1200,
        walk: 'w',
        zoom: 3,
        up: 0,
      })
    for (const { place, name: landmark } of landmarks) {
      const file = `${district}-${place}.jpg`
      if (wanted(file))
        await shoot(
          `${district}:${place}`,
          file,
          `${landmark} · Gulabi Gali`,
          FRAMING[place] ?? FRAMING.default,
        )
    }
  }
} finally {
  await browser?.close()
  preview?.kill()
  rmSync(dist, { recursive: true, force: true })
}
