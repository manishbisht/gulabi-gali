// Makes the web app manifest's PNG icons from frontend/public/icon.svg: icon-192.png and icon-512.png (the arch on
// its rounded plum square, corners see-through, as the tab icon draws it) and icon-maskable-512.png (the square
// edge to edge, the arch shrunk into the middle 80 %, so a launcher can cut any shape out of it without clipping
// the arch). Not part of any test run: run it by hand after icon.svg changes (`npm run app-icons -w frontend`),
// look at the three images, and commit them.
//
// Drawn by Chrome through Playwright, which the repo already has; no image library needed.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const out = fileURLToPath(new URL('../frontend/public/', import.meta.url))
const svg = readFileSync(join(out, 'icon.svg'), 'utf8')
const PLUM = '#2a1d24'

/** icon.svg's shapes without its rounded square: the arch and its doorway. */
const arch = svg
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<rect[^>]*\/>/, '')
if (arch === svg || !arch.includes('<path'))
  throw new Error('icon.svg no longer looks like a square and an arch')

const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${PLUM}"/><g transform="translate(32 32) scale(0.8) translate(-32 -32)">${arch}</g></svg>`

const ICONS = [
  { file: 'icon-192.png', size: 192, source: svg, transparent: true },
  { file: 'icon-512.png', size: 512, source: svg, transparent: true },
  { file: 'icon-maskable-512.png', size: 512, source: maskable, transparent: false },
]

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())
try {
  for (const { file, size, source, transparent } of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } })
    const sized = source.replace('<svg ', `<svg width="${size}" height="${size}" `)
    await page.setContent(`<body style="margin:0;background:transparent">${sized}</body>`)
    await page.screenshot({ path: join(out, file), omitBackground: transparent })
    await page.close()
    console.log(`${join(out, file)}: ${size}x${size}`)
  }
} finally {
  await browser.close()
}
