// Makes the link preview image (frontend/public/og.png, 1200x630) and the home-screen icon
// (frontend/public/apple-touch-icon.png, 180x180). Not part of any test run: run it by hand after the city's
// look changes (`npm run og-image -w frontend`), then look at the image before committing it.
//
// The preview is a real render: the site is built with test hooks, opened at 1200x630 in Chrome, walked a few
// steps up Johari Bazaar at golden hour with the HUD hidden, and shot. The district socket and the API are
// stubbed out, so it needs no Worker and draws the same street every time (the characters wander, so no two
// shots are identical), with a small wordmark in the corner. Then it is cut to a 256-colour palette to stay well under the 300 kB the scrapers like.
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url))
const out = join(frontend, 'public')
const PORT = 5179
const MAX_BYTES = 300 * 1024
// Today, 17:35 in Jaipur: the low sun the sky paints gold (the stubbed API's sunset is today's 18:00 IST).
const GOLDEN_HOUR = `${new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)}T17:35:00+05:30`

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
    {
      cwd: frontend,
      stdio: 'ignore',
    },
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

  // Installed Chrome draws with the GPU; Playwright's own Chromium is the fallback.
  browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
  await page.addInitScript(() => localStorage.setItem('gg-hinted', '1'))
  await page.routeWebSocket(/\/live$|\/inbox$/, () => {})
  await page.route('http://127.0.0.1:8787/**', (route) => route.abort())
  await page.goto(`${base}/?gg-test=1`)
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => window.__gg !== undefined)
  await page.evaluate((iso) => window.__gg.setNow(iso), GOLDEN_HOUR)
  // a few steps up the bazaar, so the camera has settled behind the player
  await page.keyboard.down('w')
  await page.waitForTimeout(900)
  await page.keyboard.up('w')
  await page.addStyleTag({ content: '.hud, .npc-bubbles { display: none !important; }' })
  // a small wordmark, bottom left, in the site's own type and colours
  await page.evaluate(() => {
    const mark = document.createElement('div')
    mark.textContent = 'Gulabi Gali · Jaipur'
    Object.assign(mark.style, {
      position: 'fixed',
      left: '32px',
      bottom: '28px',
      padding: '8px 20px',
      borderRadius: '999px',
      background: 'rgb(42 29 36 / 0.88)',
      color: '#f5e6d8',
      font: "700 30px 'Baloo 2', system-ui, sans-serif",
    })
    document.body.append(mark)
  })
  await page.waitForTimeout(2500)
  const raw = await page.screenshot({ type: 'png' })

  // The palette cut is sharp's; it is not a dependency of this repo, so fall back to the raw shot.
  const sharp = await import('sharp').then((m) => m.default).catch(() => null)
  const og = join(out, 'og.png')
  if (sharp) await sharp(raw).png({ palette: true, colours: 256, effort: 10 }).toFile(og)
  else (await import('node:fs')).writeFileSync(og, raw)
  const size = statSync(og).size
  console.log(`${og}: ${Math.round(size / 1024)} kB${sharp ? '' : ' (not palette-cut: sharp is missing)'}`)
  if (size > MAX_BYTES) console.warn(`over ${MAX_BYTES / 1024} kB: scrapers may skip it`)

  // The home-screen icon: the arch on its plum square, edge to edge (iOS rounds the corners itself).
  const icon = await browser.newPage({ viewport: { width: 180, height: 180 } })
  await icon.setContent(
    `<body style="margin:0;background:#2a1d24"><img src="${base}/icon.svg" width="180" height="180"></body>`,
  )
  await icon.waitForFunction(() => document.querySelector('img').complete)
  await icon.screenshot({ path: join(out, 'apple-touch-icon.png') })
  console.log(`${join(out, 'apple-touch-icon.png')}: 180x180`)
} finally {
  await browser?.close()
  preview?.kill()
  rmSync(dist, { recursive: true, force: true })
}
