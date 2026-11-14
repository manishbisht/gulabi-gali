import { mkdirSync, writeFileSync } from 'node:fs'
import { devices, expect, test } from '@playwright/test'
import type { CDPSession, Page } from '@playwright/test'

/**
 * A mid-range phone, approximated: Pixel 7 emulation, the CPU slowed six times
 * and DevTools' "Fast 4G" network, against the built site and the real Worker.
 * It records how the city loads (FCP, LCP, the first walkable frame), how
 * frames come while walking the bazaar for 8 s, which quality tier the stage
 * settled on, and the JS heap. Not a pass/fail test: the numbers go to
 * test-results/device-perf.json and docs/device-performance.md. It only runs
 * when asked: `npm run test:device`.
 *
 * What it cannot tell you: the phone's GPU. Headless Chrome on a desktop draws
 * WebGL on the desktop's GPU (or SwiftShader), so the frame numbers are a CPU
 * story first. The real-device checklist in docs/device-performance.md covers the rest.
 */

test.skip(!process.env.DEVICE_PERF, 'Measurement, not a test: set DEVICE_PERF=1 to run it.')

// Everything but `defaultBrowserType`, which a file may not change.
const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['Pixel 7']
test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent })

/** Chrome DevTools' "Fast 4G" preset (SDK.NetworkManager): 9 Mbps down, 1.5 up, 60 ms x 2.75. */
const FAST_4G = {
  offline: false,
  latency: 165,
  downloadThroughput: (9000 * 1000 * 0.9) / 8,
  uploadThroughput: (1500 * 1000 * 0.9) / 8,
}
const CPU_SLOWDOWN = 6
/** How long the walk along the bazaar is watched. */
const WALK_MS = 8000

interface Result {
  fcp: number | null
  lcp: number | null
  /** ms from navigation start to the first frame drawn once the district is in and the player exists. */
  walkable: number | null
  /** ms the Padharo! button was pressed at, so the load can be split into before and after it. */
  entered: number | null
  frames: { count: number; p50: number; p95: number; p99: number; max: number; over33: number }
  qualityAfter: number | null
  /** Other people drawn at the end of the walk (the stress check runs scripts/fake-residents.mjs alongside). */
  people: number
  heapMB: number
  renderer: string
}

async function throttle(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Network.emulateNetworkConditions', FAST_4G)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN })
  await cdp.send('Performance.enable')
  return cdp
}

interface Perf {
  lcp: number | null
  fcp: number | null
  walkable: number | null
  frames: number[]
}

/** Paint timings and a frame recorder, installed before the page's own scripts. */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __perf: Perf; __gg?: { position?: unknown } }
    w.__perf = { lcp: null, fcp: null, walkable: null, frames: [] }
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__perf.lcp = entry.startTime
    }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (entry.name === 'first-contentful-paint') w.__perf.fcp = entry.startTime
    }).observe({ type: 'paint', buffered: true })
    let last = 0
    let seen = false
    const tick = (now: number) => {
      if (last) w.__perf.frames.push(now - last)
      last = now
      // Walkable: the player exists (the hooks are installed once the district is in) and
      // a frame has been drawn after that. This callback runs before the next paint, so the
      // frame after the one that first saw the hooks is the first with the player in it.
      if (w.__perf.walkable === null && w.__gg?.position) {
        if (seen) w.__perf.walkable = now
        seen = true
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

const percentile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0

test('the walled city on a throttled Pixel 7', async ({ page }) => {
  test.setTimeout(240000)
  await instrument(page)
  const cdp = await throttle(page)

  // Load: a cold visit, past the intro, to the first walkable frame.
  await page.goto('/?gg-test=1', { waitUntil: 'load', timeout: 120000 })
  await page.getByRole('button', { name: 'Padharo!' }).click()
  const entered = await page.evaluate(() => performance.now())
  await page.waitForFunction(() => (window as unknown as { __perf: Perf }).__perf.walkable !== null, null, {
    timeout: 120000,
  })
  const load = await page.evaluate(() => {
    const { lcp, fcp, walkable } = (window as unknown as { __perf: Perf }).__perf
    return { lcp, fcp, walkable }
  })
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'no webgl'
  })

  // Frames: walk the bazaar, turning at the end of the lane so the whole 8 s is moving.
  await page.evaluate(() => {
    ;(window as unknown as { __perf: Perf }).__perf.frames = []
  })
  const start = Date.now()
  let key = 'w'
  await page.keyboard.down(key)
  while (Date.now() - start < WALK_MS) {
    await page.waitForTimeout(1500)
    await page.keyboard.up(key)
    key = key === 'w' ? 's' : 'w'
    await page.keyboard.down(key)
  }
  await page.keyboard.up(key)
  const frames = (await page.evaluate(() => (window as unknown as { __perf: Perf }).__perf.frames)).sort(
    (a, b) => a - b,
  )
  const qualityAfter = await page.evaluate(() => window.__gg.quality())
  const people = await page.evaluate(() => window.__gg.people().length)
  const { metrics } = await cdp.send('Performance.getMetrics')
  const heap = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0

  const result: Result = {
    ...load,
    entered,
    frames: {
      count: frames.length,
      p50: percentile(frames, 50),
      p95: percentile(frames, 95),
      p99: percentile(frames, 99),
      max: frames.at(-1) ?? 0,
      over33: frames.filter((f) => f > 33.4).length,
    },
    qualityAfter,
    people,
    heapMB: heap / 2 ** 20,
    renderer,
  }
  mkdirSync('test-results', { recursive: true })
  writeFileSync('test-results/device-perf.json', JSON.stringify(result, null, 2))
  const ms = (v: number | null) => (v === null ? '-' : `${Math.round(v)}`)
  console.log(
    '\n| FCP ms | LCP ms | Walkable ms | Frames | p50 | p95 | p99 | max | >33ms | Tier | People | Heap MB |',
  )
  console.log(
    `| ${ms(result.fcp)} | ${ms(result.lcp)} | ${ms(result.walkable)} | ${result.frames.count} | ${result.frames.p50.toFixed(1)} | ${result.frames.p95.toFixed(1)} | ${result.frames.p99.toFixed(1)} | ${result.frames.max.toFixed(0)} | ${result.frames.over33} | ${result.qualityAfter} | ${result.people} | ${result.heapMB.toFixed(1)} |`,
  )
  console.log(`\nRenderer: ${result.renderer}`)
  expect(frames.length).toBeGreaterThan(0)
})
