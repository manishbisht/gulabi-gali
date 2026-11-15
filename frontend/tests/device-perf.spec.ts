import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
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
 *
 * Clerk mode: against a build with a (test) VITE_CLERK_PUBLISHABLE_KEY, set
 * DEVICE_PERF_CLERK to how Clerk's CDN is stood in for, since the run must not
 * reach Clerk:
 * - `abort`: every request to Clerk's host fails. The app's Clerk chunk still
 *   loads and mounts; clerk-js itself never arrives.
 * - a directory: the real clerk-js and ui bundles, unpacked from their npm
 *   tarballs into `<dir>/js/package` and `<dir>/ui/package`, are served for
 *   the CDN's `/npm/...` URLs, held back as long as Fast 4G would take
 *   (latency plus gzipped size over the throughput), and Clerk's API calls
 *   fail. So clerk-js downloads, parses and runs, and then finds no Clerk.
 *
 * Every phase-4 extra at once (DEVICE_PERF_EXTRAS=1): the page opens on Sankranti, so its kites are in the
 * sky, a Gangaur procession is forced onto the street beside them, the street dog by the spawn is called to
 * follow, and after the walk the player drives the auto parked by the spawn for another 8 s, recorded on its
 * own. The 60 residents come from `node scripts/fake-residents.mjs 60 walled-city <seconds>`, run alongside;
 * the posters and the animals are always there. Results go to test-results/device-perf-extras.json.
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
/** How long the walk along the bazaar is watched (and, with every extra on, the drive after it). */
const WALK_MS = 8000
const EXTRAS = !!process.env.DEVICE_PERF_EXTRAS
/** The street dog that lives a few steps from the spawn, and the auto parked just past it. */
const DOG = 'walled-city-dog-0'
const AUTO_SIDE = { x: 0.8, z: 54 }

type Frames = Result['frames']

interface Result {
  fcp: number | null
  lcp: number | null
  /** ms from navigation start to the first frame drawn once the district is in and the player exists. */
  walkable: number | null
  /** ms the Padharo! button was pressed at, so the load can be split into before and after it. */
  entered: number | null
  frames: {
    count: number
    p50: number
    p95: number
    p99: number
    max: number
    over33: number
    /** Main-thread ms per frame: all tasks, and script within them, under the CPU throttle. */
    taskPerFrame: number
    scriptPerFrame: number
  }
  qualityAfter: number | null
  /** Other people drawn at the end of the walk (the stress check runs scripts/fake-residents.mjs alongside). */
  people: number
  heapMB: number
  renderer: string
  /** Clerk mode only: what of Clerk the page fetched. */
  clerk?: { mode: string; chunk: boolean; cdn: string[] }
  /** What the renderer drew in the walk's last frame. */
  render: { calls: number; triangles: number; geometries: number; textures: number; programs: number }
  /** Every-extra mode only: what was up during the walk, and the drive recorded after it. */
  extras?: {
    festival: string | null
    procession: number
    following: boolean
    animals: number
    drive: Frames & { qualityAfter: number; people: number; moved: number }
    driveRender: Result['render']
  }
}

/** Clerk's CDN, stood in for (see the header). Answers the CDN URLs it was asked for. */
async function standInForClerk(page: Page, mode: string): Promise<string[]> {
  const cdn: string[] = []
  await page.route(
    (url) => url.hostname.endsWith('.clerk.accounts.dev') || url.hostname.startsWith('clerk.'),
    async (route) => {
      const url = new URL(route.request().url())
      const m = url.pathname.match(/^\/npm\/@clerk\/(clerk-js|ui)@[^/]+\/dist\/([\w.-]+\.js)$/)
      const file =
        m && mode !== 'abort' ? join(mode, m[1] === 'ui' ? 'ui' : 'js', 'package/dist', m[2]) : null
      if (!file || !existsSync(file)) return route.abort()
      const body = readFileSync(file)
      cdn.push(url.pathname)
      const ms = FAST_4G.latency + (gzipSync(body).length / FAST_4G.downloadThroughput) * 1000
      await new Promise((r) => setTimeout(r, ms))
      await route.fulfill({
        body,
        contentType: 'application/javascript',
        headers: { 'access-control-allow-origin': '*' },
      })
    },
  )
  return cdn
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

/** Main-thread busy time so far, in ms: all tasks, and the JavaScript within them (CPU-throttled time). */
async function busy(cdp: CDPSession) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  const get = (name: string) => (metrics.find((m) => m.name === name)?.value ?? 0) * 1000
  return { task: get('TaskDuration'), script: get('ScriptDuration') }
}

/**
 * Holds W and S in turn for `WALK_MS` (walking or driving), recording every frame interval, and how much of
 * each frame the main thread was busy (tasks, and script within them), averaged over the window.
 */
async function record(page: Page, cdp: CDPSession): Promise<Frames> {
  await page.evaluate(() => {
    ;(window as unknown as { __perf: Perf }).__perf.frames = []
  })
  const before = await busy(cdp)
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
  const after = await busy(cdp)
  const frames = (await page.evaluate(() => (window as unknown as { __perf: Perf }).__perf.frames)).sort(
    (a, b) => a - b,
  )
  expect(frames.length).toBeGreaterThan(0)
  return {
    taskPerFrame: (after.task - before.task) / frames.length,
    scriptPerFrame: (after.script - before.script) / frames.length,
    count: frames.length,
    p50: percentile(frames, 50),
    p95: percentile(frames, 95),
    p99: percentile(frames, 99),
    max: frames.at(-1) ?? 0,
    over33: frames.filter((f) => f > 33.4).length,
  }
}

test('the walled city on a throttled Pixel 7', async ({ page }) => {
  test.setTimeout(240000)
  await instrument(page)
  const clerkMode = process.env.DEVICE_PERF_CLERK
  const cdn = clerkMode ? await standInForClerk(page, clerkMode) : []
  const cdp = await throttle(page)

  // Load: a cold visit, past the intro, to the first walkable frame. gg-full: drawn in full, as a phone
  // draws it (other test pages draw lite, see testRenderLite).
  await page.goto(EXTRAS ? '/?gg-test=1&gg-full=1&gg-festival=sankranti' : '/?gg-test=1&gg-full=1', {
    waitUntil: 'load',
    timeout: 120000,
  })
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

  let extras: Result['extras']
  if (EXTRAS) {
    // a procession under the kites, and the dog by the spawn at the player's heels
    await page.evaluate(() => window.__gg.forceProcession('gangaur'))
    const dog = await page.evaluate((id) => window.__gg.animals().find((a) => a.id === id)!, DOG)
    await page.evaluate(({ x, z }) => window.__gg.teleport(x, z + 1.6), dog)
    await page.getByRole('button', { name: 'Saath chalo' }).click()
    await expect
      .poll(() => page.evaluate((id) => window.__gg.animals().find((a) => a.id === id)!.following, DOG))
      .toBe(true)
  }
  const during = EXTRAS
    ? await page.evaluate(() => ({
        festival: window.__gg.festival(),
        procession: window.__gg.procession().count,
        animals: window.__gg.animals().length,
      }))
    : null

  // Frames: walk the bazaar, turning at the end of the lane so the whole 8 s is moving.
  const walk = await record(page, cdp)
  const qualityAfter = await page.evaluate(() => window.__gg.quality())
  const people = await page.evaluate(() => window.__gg.people().length)
  const render = await page.evaluate(() => window.__gg.renderInfo())
  const following = await page.evaluate(
    (id) => window.__gg.animals().find((a) => a.id === id)?.following ?? false,
    DOG,
  )

  if (EXTRAS && during) {
    // then into the auto parked by the spawn, and 8 s at the wheel
    await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), AUTO_SIDE)
    await page.getByRole('button', { name: 'Auto chalao' }).click()
    await expect(page.getByRole('button', { name: 'Utro' })).toBeVisible()
    const from = await page.evaluate(() => window.__gg.position())
    const drive = await record(page, cdp)
    const to = await page.evaluate(() => window.__gg.position())
    extras = {
      ...during,
      following,
      drive: {
        ...drive,
        qualityAfter: await page.evaluate(() => window.__gg.quality()),
        people: await page.evaluate(() => window.__gg.people().length),
        moved: Math.hypot(to.x - from.x, to.z - from.z),
      },
      driveRender: await page.evaluate(() => window.__gg.renderInfo()),
    }
  }
  const { metrics } = await cdp.send('Performance.getMetrics')
  const heap = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0

  const result: Result = {
    ...load,
    entered,
    frames: walk,
    qualityAfter,
    people,
    heapMB: heap / 2 ** 20,
    renderer,
    render,
    extras,
  }
  if (clerkMode) {
    const chunk = await page.evaluate(() =>
      performance.getEntriesByType('resource').some((e) => /\/assets\/clerk-[\w-]+\.js$/.test(e.name)),
    )
    result.clerk = { mode: clerkMode === 'abort' ? 'abort' : 'stub', chunk, cdn }
  }
  mkdirSync('test-results', { recursive: true })
  writeFileSync(`test-results/device-perf${EXTRAS ? '-extras' : ''}.json`, JSON.stringify(result, null, 2))
  const ms = (v: number | null) => (v === null ? '-' : `${Math.round(v)}`)
  console.log(
    '\n| FCP ms | LCP ms | Walkable ms | Frames | p50 | p95 | p99 | max | >33ms | Tier | People | Heap MB |',
  )
  console.log(
    `| ${ms(result.fcp)} | ${ms(result.lcp)} | ${ms(result.walkable)} | ${result.frames.count} | ${result.frames.p50.toFixed(1)} | ${result.frames.p95.toFixed(1)} | ${result.frames.p99.toFixed(1)} | ${result.frames.max.toFixed(0)} | ${result.frames.over33} | ${result.qualityAfter} | ${result.people} | ${result.heapMB.toFixed(1)} |`,
  )
  const x = result.extras
  if (x) {
    const d = x.drive
    console.log(
      `| drive | | | ${d.count} | ${d.p50.toFixed(1)} | ${d.p95.toFixed(1)} | ${d.p99.toFixed(1)} | ${d.max.toFixed(0)} | ${d.over33} | ${d.qualityAfter} | ${d.people} | |`,
    )
    console.log(
      `\nExtras: festival ${x.festival}, procession ${x.procession}, animals ${x.animals}, following ${x.following}, drove ${d.moved.toFixed(1)} m`,
    )
    console.log(`Draw (walk): ${JSON.stringify(result.render)}; (drive): ${JSON.stringify(x.driveRender)}`)
  } else console.log(`\nDraw: ${JSON.stringify(result.render)}`)
  const busyLine = (f: Frames) =>
    `${f.taskPerFrame.toFixed(1)} ms task, ${f.scriptPerFrame.toFixed(1)} ms script`
  console.log(
    `Main thread per frame (walk): ${busyLine(result.frames)}${x ? `; (drive): ${busyLine(x.drive)}` : ''}`,
  )
  console.log(`Renderer: ${result.renderer}`)
  if (result.clerk) console.log(`Clerk: ${JSON.stringify(result.clerk)}`)
})
