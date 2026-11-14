# Device performance

The target is a mid-range Android phone inside Instagram's in-app browser: a first walkable frame in about 5 s
on Fast 4G and a steady 30 fps. Two parts: a checklist for a real phone, and the numbers from a desktop
approximation (`frontend/tests/device-perf.spec.ts`) to compare against.

## Targets

| Measure                                 | Target                 |
| --------------------------------------- | ---------------------- |
| First walkable frame                    | at most 5 s            |
| Frame interval p50                      | at most 33 ms          |
| Frames over 33 ms                       | under 10%              |
| Quality tier after 8 s of walking       | stays at 1 or above    |
| JS heap                                 | under 150 MB           |
| Initial JS, excluding the `three` chunk | at most 250 kB gzipped |

## Real-device checklist

**Set up once.** On the phone: Settings, About phone, tap _Build number_ seven times, Developer options,
_USB debugging_ on. Connect by USB, open Chrome on the desktop at `chrome://inspect/#devices`, accept the
prompt. Note the model, Android and Chrome versions and the GPU (`chrome://gpu`, _GL_RENDERER_). Charge above
50%, battery saver off, other apps closed.

**Before each run.** Open a new tab (the stage remembers a slow device for the tab session), click _inspect_,
tick _Network, Disable cache_, and set throttling to _No throttling_. Record each item three times, keep the
median.

| #   | What                                   | How                                                                                                                                                                                   | Target (mid-range, 4G)                                             |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Load: FCP, LCP                         | Performance panel, _Record and reload_ on the site. Read FCP and LCP off _Timings_.                                                                                                   | FCP at most 1.8 s, LCP at most 2.5 s                               |
| 2   | First walkable frame                   | Same recording, tap _Padharo!_: the first frame showing the street with the player in it.                                                                                             | at most 5 s from navigation                                        |
| 3   | Bytes                                  | Network panel footer: _transferred_ for the load in (1).                                                                                                                              | note it; compare release to release                                |
| 4   | Walking frames                         | Walk the bazaar for about 10 s. _Frames_ track: dropped and partial frames; _Main_: long tasks. Rendering drawer, _Frame rendering stats_, for live FPS.                              | at least 30 fps throughout; no task over 200 ms                    |
| 5   | Quality tier                           | Console: `sessionStorage.getItem('gg-quality')`. `null` or `'2'` is full; `'1'` caps the pixel ratio at 1.25; `'0'` is ratio 1 and no shadows. Read it after (4) and after 5 minutes. | stays at 2 or 1 on a mid-range phone                               |
| 6   | Memory                                 | _Performance monitor_: _JS heap size_ after (4) and after 5 minutes.                                                                                                                  | heap under 150 MB and flat                                         |
| 7   | Metro travel                           | Open the metro, go to another district, come back. Watch for a stall or a blank frame while its chunk loads.                                                                          | no blank canvas; walking resumes at once                           |
| 8   | Heat                                   | Five minutes of walking, then repeat (4) and (5). A drop in FPS or tier is thermal throttling.                                                                                        | no tier drop from heat alone                                       |
| 9   | Touch                                  | Joystick with one thumb, tap a landmark, rotate the phone mid-walk.                                                                                                                   | no stuck input, no blank canvas                                    |
| 10  | **Open the link from an Instagram DM** | On Android, send the link to yourself in an Instagram DM and open it in the in-app browser.                                                                                           | the canvas shows, the joystick works, and nothing scrolls the page |

**How the tier moves.** The stage measures every frame (the city draws continuously). Once it has about 2.5 s
of frames, if more than 60% of that time was spent in frames slower than 22 ms it steps one tier down
(`frontend/src/engine/stage.ts`, `measure` and `applyQuality`). It never steps back up within a tab session, so
to measure full quality again open a new tab or run `sessionStorage.removeItem('gg-quality')` and reload.

Paste results into a copy of the table below with the device in the heading.

## Desktop approximation

`npm run test:device` from the repo root (it starts the Worker and a production build of the site through
`playwright.config.ts`). In a fresh context: Playwright's _Pixel 7_ descriptor (412 x 915, DPR 2.625, touch,
mobile UA), CPU slowed 6x (`Emulation.setCPUThrottlingRate`), DevTools' _Fast 4G_ (9 Mbps x 0.9 down,
1.5 Mbps x 0.9 up, 165 ms RTT) with the cache disabled. It loads `/?gg-test=1`, taps _Padharo!_, and waits for
the first walkable frame: `window.__gg.position` exists (the hooks install once the district is in) and one
frame has drawn after that. Then it walks the bazaar for 8 s (holding W and S in turn so the player never
stands at a wall) recording main-thread `requestAnimationFrame` intervals, and reads the tier and
`JSHeapUsedSize`. Results go to `frontend/test-results/device-perf.json`.

Run 2026-11-14 on an Apple M3 Pro, headless Chrome through ANGLE/Metal, production build against a local
`wrangler dev` Worker. Two runs:

| Run | FCP ms | LCP ms | Walkable ms | Frames (8 s) | p50 ms | p95 ms | p99 ms | Max ms | Frames over 33 ms | Tier after | JS heap MB |
| --- | -----: | -----: | ----------: | -----------: | -----: | -----: | -----: | -----: | ----------------: | ---------- | ---------: |
| 1   |    960 |    960 |        1782 |          539 |   16.7 |   16.8 |   16.8 |     83 |                 1 | 2          |        8.8 |
| 2   |    948 |    948 |        1798 |          539 |   16.7 |   16.7 |   16.8 |    100 |                 1 | 2          |        9.0 |

Against the targets: first walkable frame 1.8 s (limit 5 s), p50 16.7 ms (limit 33), 1 of 539 frames over
33 ms (0.2%, limit 10%), tier still 2, heap 9 MB (limit 150).

Initial JS from `npm run build`, gzipped: the entry chunk `index` is 88.9 kB, plus 1.5 kB for the shared
`layout` chunk and 4.4 kB for the walled city, which loads on entering. The `three` chunk (143.8 kB gzipped)
is separate, and the other three districts are 2.1 to 3.1 kB each, loaded on travel. The total excluding
`three` is about 95 kB, against a 250 kB limit.

**Fixes made in this pass.** Nothing missed a target, so no render-path fixes were needed. Go-live fixes from
the same pass: Google Fonts moved from a render-blocking CSS `@import` to `preconnect` plus a `display=swap`
stylesheet `<link>` in `index.html`; the `three` chunk now has an explicit `chunkSizeWarningLimit`, so the
build is warning-free.

**What this cannot show:** the phone's GPU. WebGL here runs on the M3's GPU, so fill rate and shader cost
(pixel ratio 2.6, shadows) are far cheaper than on a Mali or Adreno mid-ranger, and the frame numbers are an
optimistic CPU story. That is what the real-device checklist is for; expect the tier to drop sooner there.
