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

**How the tier moves.** The stage measures every frame (the city draws continuously) in windows of about 2 s.
A window is bad if more than 60% of its time was spent in frames slower than 22 ms, and it holds at least 4 such
frames. Two bad windows in a row step the tier down one step (`frontend/src/engine/stage.ts`, `measure` and
`applyQuality`); a good window in between starts the count again. A very long frame is clamped to 600 ms, not
ignored, so a phone running at 2 to 4 fps still steps down, about 6 to 7 s after the city opens (2 s warm-up, then two
windows). Nothing is measured for the first 2 s after the stage starts, after a district opens (the session calls
`stage.settle()`), after a context restore, and after a step down, so the shader compiles and texture uploads of a
load cannot count. One hitch or one burst (a tab switch, a GC pause, a district load) fills at most one window and
cannot step it down. It never steps back up within a tab session, so to measure full quality again open a new tab
or run `sessionStorage.removeItem('gg-quality')` and reload.

Paste results into a copy of the table below with the device in the heading.

## Desktop approximation

`npm run test:device` from the repo root (it starts the Worker and a production build of the site through
`playwright.config.ts`). In a fresh context: Playwright's _Pixel 7_ descriptor (412 x 915, DPR 2.625, touch,
mobile UA), CPU slowed 6x (`Emulation.setCPUThrottlingRate`), DevTools' _Fast 4G_ (9 Mbps x 0.9 down,
1.5 Mbps x 0.9 up, 165 ms RTT) with the cache disabled. It loads `/?gg-test=1&gg-full=1` (drawn in full, not lite), taps _Padharo!_, and waits for
the first walkable frame: `window.__gg.position` exists (the hooks install once the district is in) and one
frame has drawn after that. Then it walks the bazaar for 8 s (holding W and S in turn so the player never
stands at a wall) recording main-thread `requestAnimationFrame` intervals, and reads the tier and
`JSHeapUsedSize`. Results go to `frontend/test-results/device-perf.json`. With `DEVICE_PERF_EXTRAS=1` it
runs with every phase-4 extra on and drives an auto after the walk (see Phase 4 below), writing
`device-perf-extras.json`.

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

### Phase 2: 60 residents in the Walled City

Run 2026-11-14, same machine and spec. A local `wrangler dev` Worker with `DEV_AUTH=1` (local D1 migrated),
and `node scripts/fake-residents.mjs 60 walled-city 400` running beside it: 60 dev-signed-in residents, each
with a live socket in the Walled City, wandering 20 m around the spawn at 1.4 m/s and reporting at 10 Hz
(about 600 moves a second in, the Worker fanning them out). The script's counters stayed at 60 open sockets
with no errors and no closes throughout. The spec itself is a guest (no sign-in), so it receives the crowd
and is not part of it; it counted 60 people drawn at the end of each walk (`window.__gg.people()`).

| Run | FCP ms | LCP ms | Walkable ms | Frames (8 s) | p50 ms | p95 ms | p99 ms | Max ms | Frames over 33 ms | Tier after | People | JS heap MB |
| --- | -----: | -----: | ----------: | -----------: | -----: | -----: | -----: | -----: | ----------------: | ---------- | -----: | ---------: |
| 1   |    976 |    976 |        1659 |          536 |   16.7 |   16.7 |   16.8 |    117 |                 1 | 2          |     60 |        9.5 |
| 2   |    980 |    980 |        1687 |          537 |   16.7 |   16.7 |   16.8 |     67 |                 2 | 2          |     60 |       10.7 |

Against the targets: first walkable frame 1.7 s (limit 5 s), p50 16.7 ms (limit 33), 2 of 537 frames over
33 ms at worst (0.4%, limit 10%), tier still 2, heap under 11 MB (limit 150). That is within noise of the
phase-1 run without a crowd (1 of 539 over 33 ms, heap 9 MB), so 60 people on screen cost no measurable frame
time here, even with the CPU slowed 6x. No render-path fixes were needed. Remote people cast shadows only at tier 2 (`src/world/people.ts`).

**Read this with care.** This is a desktop GPU (Apple M3 Pro, ANGLE/Metal) behind a 6x CPU throttle, and it
flatters the numbers: 60 figures are mostly a vertex and draw-call load, which an M3 shrugs off, while a
Mali or Adreno mid-ranger pays far more for fill rate and shadows. Everyone stood within 20 m of the spawn,
the densest case for one district but a case where the 60 m interest radius never trims anything. The real
phone is still unmeasured: run the checklist above with `fake-residents.mjs` pointed at a Worker the phone can
reach (`GG_API`), and expect the tier to drop sooner than it did here. The Worker side (one `DistrictDO`
fanning out 60 movers) is measured only against a local `wrangler dev`, not Cloudflare's network.

**Fixes made in the phase-1 pass.** Nothing missed a target, so no render-path fixes were needed. Go-live fixes from
the same pass: Google Fonts moved from a render-blocking CSS `@import` to `preconnect` plus a `display=swap`
stylesheet `<link>` in `index.html` (no longer chained behind the CSS bundle; preconnect + display=swap
keeps text visible while the font loads); the `three` chunk now has an explicit `chunkSizeWarningLimit`, so the
build is warning-free.

**What this cannot show:** the phone's GPU. WebGL here runs on the M3's GPU, so fill rate and shader cost
(pixel ratio 2.6, shadows) are far cheaper than on a Mali or Adreno mid-ranger, and the frame numbers are an
optimistic CPU story. That is what the real-device checklist is for; expect the tier to drop sooner there.

### Phase 4: every extra at once

Run 2026-11-15, same machine and spec, test-hooks build, local `wrangler dev` Worker with `DEV_AUTH=1`, and
`node scripts/fake-residents.mjs 60 walled-city 600` running beside it (60 open sockets, no errors or closes in
any run). `DEVICE_PERF_EXTRAS=1 npm run test:device` opens the page on Sankranti (`gg-festival=sankranti`: 120
kites and their strings over the rooftops at tier 2), forces a Gangaur procession onto the street under them
(`__gg.forceProcession`: 40 women and drummers and the palanquin), calls the street dog by the spawn to follow,
and walks the bazaar for 8 s as before; then it gets into the auto parked by the spawn and drives it for 8 s
(W and S in turn), recorded on its own. The district's 8 animals wander throughout, the poster walls are up, and
the 60 residents are drawn the whole time. The spec now also reads the renderer's counters
(`__gg.renderInfo`) at the end of each window, and the main thread's busy time per frame from DevTools'
`TaskDuration` and `ScriptDuration` over the window (CPU-throttled milliseconds).

Before any change in this pass (the extras as they landed in phase 4), two runs each:

| Run           | Walkable ms | Window | Frames | p50 ms | p95 ms | p99 ms | Max ms | Over 33 ms | Tier after | People | Heap MB | Draw calls | Triangles |
| ------------- | ----------: | ------ | -----: | -----: | -----: | -----: | -----: | ---------: | ---------- | -----: | ------: | ---------: | --------: |
| Crowd only, 1 |        1730 | walk   |    537 |   16.7 |   16.8 |   16.8 |    117 |          1 | 2          |     60 |     9.3 |        121 |    73,986 |
| Crowd only, 2 |        1716 | walk   |    537 |   16.7 |   16.8 |   16.8 |    117 |          1 | 2          |     60 |    11.6 |        118 |    73,466 |
| All extras, 1 |        1925 | walk   |    542 |   16.7 |   16.8 |   16.8 |     17 |          0 | 2          |     60 |    12.9 |        123 |    85,960 |
|               |             | drive  |    542 |   16.7 |   16.7 |   16.8 |     17 |          0 | 2          |     60 |         |        157 |    90,864 |
| All extras, 2 |        1795 | walk   |    542 |   16.7 |   16.7 |   16.8 |     17 |          0 | 2          |     60 |    10.3 |        120 |    85,596 |
|               |             | drive  |    542 |   16.7 |   16.8 |   16.8 |     17 |          0 | 2          |     60 |         |        146 |    88,852 |

After this pass (the HUD regrouped, the bandar's switch fixes), two runs each:

| Run           | Walkable ms | Window | Frames | p50 ms | p95 ms | p99 ms | Max ms | Over 33 ms | Tier after | People | Heap MB | Draw calls | Main thread ms/frame (task, script) |
| ------------- | ----------: | ------ | -----: | -----: | -----: | -----: | -----: | ---------: | ---------- | -----: | ------: | ---------: | ----------------------------------- |
| Crowd only, 1 |        1716 | walk   |    536 |   16.7 |   16.8 |   16.8 |    117 |          1 | 2          |     60 |    11.4 |        118 | 2.8, 1.8                            |
| Crowd only, 2 |        1711 | walk   |    536 |   16.7 |   16.7 |   16.8 |    117 |          1 | 2          |     60 |    11.4 |        117 | 2.8, 1.8                            |
| All extras, 1 |        1811 | walk   |    543 |   16.7 |   16.7 |   16.8 |     17 |          0 | 2          |     60 |     9.9 |        117 | 2.9, 2.0                            |
|               |             | drive  |    542 |   16.7 |   16.7 |   16.8 |     17 |          0 | 2          |     60 |         |        148 | 2.9, 2.1                            |
| All extras, 2 |        1819 | walk   |    544 |   16.7 |   16.7 |   16.8 |     17 |          0 | 2          |     60 |    11.1 |        126 | 2.9, 2.0                            |
|               |             | drive  |    542 |   16.7 |   16.8 |   16.8 |     17 |          0 | 2          |     60 |         |        163 | 3.2, 2.2                            |

Against the targets: first walkable frame 1.8 s (limit 5 s), p50 16.7 ms (limit 33), no frame over 33 ms in
either window with everything on (limit 10%), tier still 2, heap 10 to 13 MB (limit 150). FCP was 1.0 s in
every run. Every extra together costs about 0.1 to 0.4 ms of throttled main-thread time per frame over the
crowd alone, 12,000 to 13,000 more triangles, 5 more geometries and 4 more shader programs (the kites, their
strings and the procession); the draw calls barely move while walking because each extra is one to three
instanced meshes. The drive sees more of the city at once (it covers about 15 m), hence about 30 more draw
calls. The first walkable frame is about 0.1 s later on Sankranti, for the kite and string shaders. The
crowd-only run's one slow frame (117 ms) is the first step of the walk compiling what walking draws; the
extras run takes that hit while it calls the dog, before its window opens.

**No target was missed, so no render-path fix was made.** The per-frame paths of the extras (animals,
procession, kites, driving, posters, the bandar) were read for allocations and found clean; each extra is a
few instanced meshes sharing one geometry and material per kind (the poster walls share one plane and
draw a canvas texture per wall). What changed in this pass is the phone HUD (see
below) and three small bandar fixes, none of which touch the frame loop.

**Initial JS.** From the shipped build (`GG_ALLOW_LOCAL_API=1 vite build`, no test hooks), gzipped: the entry
chunk `index` is 156.0 kB (130.9 kB at the end of phase 3, 88.9 kB in phase 1), plus 4.5 kB for the walled city
on entering and 0.8 kB for the shared `cast` chunk; `three` is 143.8 kB on its own and Clerk's chunk (34.1 kB)
loads only in Clerk mode. Excluding `three`, about 161 kB against the 250 kB limit. Phase 4 put about 25 kB
into the entry chunk (posters, autos and the horn, animals, the procession, the kite fight, the bandar). That is
still under the limit; if it gets close, the kite fight (Sankranti only) and the poster composer are the first
candidates for lazy chunks.

**The phone HUD.** At 360 x 740 the HUD used to spread down the screen: the top row squeezed the place and
weather chips into two- and three-line columns, the festival banner and procession line floated at fixed
offsets, and the visibility chip and city line were pushed by `justify-content: space-between` to the middle of
the street (the city line ended at y = 471, two thirds of the way down). It is now one block at the top: place,
weather and stamps on one line; who can see you; one card for the festival greeting, procession line and city
line; and the language, sound and monkey switches as a column of 44 px buttons down the right edge (a row on
screens 600 px and wider). With a Gangaur procession, a guest's sign-in nudge and the city line all showing, it
ends at y = 228 (31% of the height). `frontend/tests/hud.spec.ts` checks that at phone width: every item whole
on screen, above 35% of the height, none overlapping, the info chips one line each, and the switches at least
44 px.

**Read this with care**, as for phase 2: the frame numbers are vsync-bound on an M3 GPU and say little about a
Mali or Adreno's fill rate. With every extra on, the extra cost on a phone is mostly the 120 kites (alpha
strings, double-sided quads high in the sky, so overdraw is low) and the procession's 40 figures; the tier
system drops the kites to 60 and 25, the procession to 20 and 8, and the shadows, as it steps down. Not
measured here: the kite fight itself (a separate mode that freezes walking), the bandar's rooftop run (a
chance event), and a real phone. The real-device checklist above, run with the extras on
(`?gg-test=1&gg-festival=sankranti`, which needs a build made with `VITE_TEST_HOOKS=1`: the shipped build ignores
the override, so a link can never change what someone's city shows; on a real festival day it is the live
festival), is still owed.

### Winter and New Year

Run 2026-11-24, same machine and spec, no residents. `DEVICE_PERF_WINTER=1 npm run test:device` opens MI Road
with the New Year override (`gg-festival=newyear`: 279 bulbs on 17 strands and their wire), then sets the clock
to 05:45 IST on 1 January under a fog report and AQI 180, so the winter ground fog is near its thickest (scene
fog 0.032, six mist sprites at 0.86 of full) while the lights are still up, and walks for 8 s as before.
"Before" is the same scenario on the code before this work (no lights, no mist; the override did nothing).

| Run                    | Walkable ms | Frames | p50 ms | p95 ms | p99 ms | Max ms | Over 33 ms | Tier after | Heap MB | Draw calls | Triangles | Programs | Main thread ms/frame (task, script) |
| ---------------------- | ----------: | -----: | -----: | -----: | -----: | -----: | ---------: | ---------- | ------: | ---------: | --------: | -------: | ----------------------------------- |
| Walled City, before    |        2636 |    544 |   16.7 |   16.7 |   16.8 |    167 |          1 | 2          |    11.5 |         51 |    61,770 |       11 | 2.2, 1.5                            |
| Walled City, after     |        1756 |    543 |   16.7 |   16.7 |   16.8 |    233 |          1 | 2          |    11.5 |         51 |    61,770 |       11 | 2.1, 1.4                            |
| Winter MI Road, before |        1731 |    543 |   16.7 |   16.7 |   16.8 |    167 |          1 | 2          |     9.0 |         46 |    49,870 |       11 | 1.8, 1.3                            |
| Winter MI Road, 1      |        1784 |    545 |   16.7 |   16.7 |   16.8 |    133 |          1 | 2          |    10.5 |         52 |    55,418 |       14 | 2.4, 1.7                            |
| Winter MI Road, 2      |        1816 |    543 |   16.7 |   16.7 |   16.8 |    150 |          1 | 2          |    10.7 |         52 |    55,418 |       14 | 1.8, 1.4                            |

Each run has one long frame (the max) and no others over 33 ms. The lights and mist together cost 6
draw calls (the bulbs, their wire, and the mist sprites in view), about 5,500 triangles (the bulbs), 3 shader
programs, one 64 x 64 texture, and 0 to 0.6 ms of throttled main-thread time per frame (the run-to-run spread is
about as wide). The twinkle is worked out 15 times a second, not every frame. On the lowest tier the mist
sprites go (the scene fog alone carries the morning) and half the bulbs. (These runs predate a review that thinned the winter fog to at most 0.022 and the mist sprites' opacity
to 0.16: the same draws and the same work per frame.) Not measured: a real phone's fill rate
under six large transparent sprites, which is what the lowest tier drops first.

### Makar Sankranti

Run 2026-11-25, same machine and spec (throttled Pixel 7, test-hooks build, local `wrangler dev` Worker), no
residents. `DEVICE_PERF_SANKRANTI=1 npm run test:device` opens the Walled City with the Sankranti override and
sets the clock to noon on 14 January 2027 under that day's sun, so the kites are up (`__gg.kites()`: 120 in the
sky, 15 of them cut and drifting down, and 4 people flying theirs from the roofs, at tier 2), then walks for 8 s
as before. "Walled City" is the same walk with no festival, on the same build.

| Run                  | Walkable ms | Frames | p50 ms | p95 ms | p99 ms | Max ms | Over 33 ms | Tier after | Heap MB | Draw calls | Triangles | Geometries | Programs | Main thread ms/frame (task, script) |
| -------------------- | ----------: | -----: | -----: | -----: | -----: | -----: | ---------: | ---------- | ------: | ---------: | --------: | ---------: | -------: | ----------------------------------- |
| Walled City          |        1811 |    549 |   16.7 |   16.8 |   16.8 |    150 |          2 | 2          |     9.5 |         53 |    68,962 |         40 |       11 | 4.6, 3.0                            |
| Sankranti, noon      |        1857 |    543 |   16.7 |   16.8 |   16.8 |     17 |          0 | 2          |    11.0 |         52 |    60,816 |         43 |       14 | 2.4, 1.7                            |

Every target holds: walkable at 1.9 s, p50 16.7 ms, no frame over 33 ms, tier still 2. The kites, their strings
and the flyers are three draw calls, three geometries and three shader programs (the flyers share the
procession's dress-tint shader); the draw calls and triangles move with where the walk ends up looking, not with
the kites (a kite is four triangles, its diamond and its tail; a flyer about 250). The kites are stepped at
most 30 times a second, so the main thread's time per frame is within the run-to-run spread (this run's
baseline was the slower of the two).
The lowest tier draws 20 kites (2 cut), 2 flyers and no strings; at night there are none. Not measured: a real
phone, and the kite fight itself from the rooftop (the same game as on the street, looking up from higher).

### Phase 3: Clerk mode

Run 2026-11-14, same machine and spec, against two builds of the same commit with test hooks on: one with no
auth (`none` mode, what ships today without a key) and one with a test `VITE_CLERK_PUBLISHABLE_KEY`
(`pk_test_` for the made-up host `gulabi-perf.clerk.accounts.dev`), each served by `vite preview` on port 5173
so Playwright reuses it. The run must not reach Clerk, so `DEVICE_PERF_CLERK` stands in for its CDN:

- **stub** (`DEVICE_PERF_CLERK=<dir>`): the real `clerk.browser.js` (clerk-js 6.43.1, 85 kB gzipped) and
  `ui.browser.js` (@clerk/ui 1.42.6, 46 kB gzipped), unpacked from their npm tarballs, are served for the
  CDN's `/npm/...` URLs, each held back for Fast 4G's latency plus its gzipped size over the throughput
  (Playwright's fulfilled responses skip DevTools' network throttling, so the spec waits instead). Clerk's API
  calls fail, so clerk-js downloads, parses and runs under the 6x CPU throttle and then finds no Clerk: a
  signed-out visitor whose Clerk is slow, not a signed-in one.
- **abort**: every request to Clerk's host fails; the app's own Clerk chunk (`clerk-*.js`, 34 kB gzipped,
  lazily loaded) still loads and mounts.

Every run confirmed the Clerk chunk loaded; every stub run served both CDN scripts. Walkable ms (first
walkable frame from navigation), five runs each:

| Build              | Runs (ms)                    | Median | Change |
| ------------------ | ---------------------------- | -----: | -----: |
| `none` (no key)    | 1654, 1646, 2551, 1686, 1774 |   1686 |      - |
| Clerk, CDN stubbed | 1828, 1691, 2009, 1816, 1754 |   1816 |   +130 |
| Clerk, CDN aborted | 1847, 3648, 1672, 1675, 1869 |   1847 |   +161 |

Frames, tier and heap did not move: p50 16.7 ms, at most 2 frames over 33 ms, tier 2, heap 9 to 12 MB in every
run. The two slow outliers (2551, 3648) had a slow FCP too (1716, 1448 ms), so they were the machine, not
Clerk. Clerk mode costs about 0.13 s to the first walkable frame, under the 0.5 s line that would have
deferred the Clerk mount until idle after that frame, so the mount stays as it is. What this does not cover:
a real Clerk's `/v1/environment` and `/v1/client` round trips (they fail here at once), which happen after
clerk-js has loaded and run, off the path to the first walkable frame.

To repeat: `npm pack @clerk/clerk-js@<version> @clerk/ui@<version>` into a scratch directory, unpack them
into `js/` and `ui/` there, build with the key into another `--outDir`, `vite preview` it on 5173, and run
`DEVICE_PERF_CLERK=<dir> npm run test:device` from the repo root.
