# Gulabi Gali, Phase 1: The Walkable Live City (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** A single-player, stylised 3D Jaipur that runs in a phone browser. It has four districts,
touch and keyboard walking, landmarks with stories and stamps, seed characters, and a sky driven by live
Jaipur weather, AQI, IST time of day and the festival calendar.

**Architecture:** This is an npm-workspaces repo with two self-contained packages:

- **`frontend/`:** a React 19 + Vite 8 shell for the overlays, and a hand-rolled Three.js stage for the
  city. Each district is its own lazily-loaded chunk.
- **`backend/`:** a Cloudflare Worker. A 15-minute cron pulls Open-Meteo into KV, and `GET /api/city`
  serves the cached snapshot.

The two packages share one protocol file, duplicated on both sides, and a root script fails CI if the two
copies differ. There is no multiplayer, no accounts and no Durable Objects in this phase. Those are
phases 2–3, each with its own plan.

**Tech Stack:** TypeScript ~6.0, React 19, Vite 8, Three.js 0.185, Vitest 4, Playwright 1.63, Cloudflare
Workers (wrangler 4, `@cloudflare/vitest-pool-workers`), Workers KV, Open-Meteo.

**Spec:** `docs/superpowers/specs/2026-11-14-gulabi-gali-design.md`

**Reference repo for conventions:** `/Users/manishbisht/Desktop/Personal Projects/games`. Copy its config
files where a task says so. Read it; never modify it.

## Global Constraints

- Root workspaces are exactly `frontend` and `backend`. There is **no `shared/` package**. Everything a
  side needs lives inside its own folder.
- Protocol types: `backend/src/protocol.ts` and `frontend/src/net/protocol.ts` are byte-identical.
  `npm run check:protocol` enforces this in CI.
- Prettier: `{ "singleQuote": true, "semi": false, "printWidth": 110, "trailingComma": "all" }`.
- Node ≥ 22 locally, Node 24 in CI. TypeScript `~6.0.2`.
- **Phones first:** the target is a mid-range Android (₹12–15k) inside Instagram's in-app browser.
  - first walkable frame in about 5 seconds on Fast 4G
  - a steady 30 fps
  - each district streamed in on entry
  - touch controls first, keyboard (WASD/arrows, E) second
- **Copy:** Hinglish by default with a Rajasthani touch ("Padharo!", "Hukum"), and an English toggle.
  Every string has both languages.
- **Nothing copied from peopleofdelhi.com:** no text, art, names or layout.
- City time is **IST (Asia/Kolkata)**, whatever the device's timezone.
- **Production origins:**
  - site: `https://gulabi-gali.manishbisht.me`
  - API: `https://api.gulabi-gali.manishbisht.me`
  - dev: `http://127.0.0.1:5173` and `http://localhost:5173`, with the API on `http://127.0.0.1:8787`
- `localStorage` keys are prefixed `gg-`. Every read and write goes through `frontend/src/storage.ts`,
  which never throws.
- **Budget:** free tiers plus Workers Paid only. Nothing in this phase costs per user.

## Test helpers

The helpers named in the test snippets are test-local and written by the task that uses them:

- `enterCity` (`tests/support/city.ts`)
- `fakeWindow`/`press` (a minimal keydown/keyup target)
- `triangleCount` (sums the index or position counts over meshes)
- `ringHasOpening` (samples 16 points on a landmark's trigger ring)

## Review Focus

1. **The weather API is down, or KV is empty on the first deploy.** The city still loads as a default clear
   day, with the weather chip showing "—", and there is no error screen. Tests: Task 2 (`serves a default
   snapshot when upstream fails`) and Task 3 (`fetchCity falls back on network error`).
2. **WebGL is unavailable or the context is lost** (old in-app browsers, low-memory kills). Instead of a
   blank page the user sees a friendly Hinglish screen, and after a context loss the city re-creates
   itself. Test: Task 4 (`shows the no-3D screen without WebGL`, e2e).
3. **The tab goes to the background, the phone rotates, or the app returns after minutes away.** The
   player must not teleport through walls from one giant frame step, and the canvas must re-fit. Tests:
   Task 4 (`clamps frame delta to 0.1s`) and Task 5 (`never crosses a collider in one step`).
4. **`localStorage` throws** (private mode, or some in-app browsers). Stamps, language and look fall back
   to memory, and nothing crashes. Test: Task 3 (`storage survives a throwing localStorage`).
5. **The device clock is in another timezone.** The sky follows Jaipur time, not the phone's. Test:
   Task 9 (`uses IST regardless of device timezone`).

---

## File Structure

```
package.json                     workspaces + root scripts
.gitignore  .prettierrc.json
scripts/check-protocol.mjs       fails if the two protocol copies differ
.github/workflows/deploy.yml     check → e2e → deploy Pages + deploy Worker
docs/architecture.md  docs/deployment.md  docs/device-performance.md

backend/
  package.json  tsconfig.json  vitest.config.ts  wrangler.jsonc
  src/index.ts        router (fetch) + scheduled handler
  src/env.ts          Env interface
  src/cors.ts         allowed origins + headers
  src/protocol.ts     CitySnapshot, FestivalId, DistrictId (copied to frontend)
  src/weather.ts      Open-Meteo fetch + mapping → CitySnapshot
  src/festivals.ts    festivalOn(date) over the calendar
  src/festivals.data.ts  dated calendar entries
  test/env.d.ts  test/worker.test.ts  test/weather.test.ts  test/festivals.test.ts

frontend/
  package.json  vite.config.ts  tsconfig*.json  eslint.config.js  playwright.config.ts  index.html
  public/CNAME  public/manifest.webmanifest  public/icon.svg
  src/main.tsx  src/App.tsx  src/index.css
  src/storage.ts               safe localStorage
  src/i18n/strings.ts          { key: { hi, en } }
  src/i18n/lang.ts             useLang() hook
  src/net/protocol.ts          copy of backend/src/protocol.ts
  src/net/api.ts               fetchCity()
  src/testHooks.ts             window.__gg when ?gg-test=1
  src/engine/stage.ts          renderer, loop, quality tiers, context loss
  src/engine/webgl.ts          hasWebGL()
  src/world/palette.ts         Jaipur colour palette
  src/world/kit.ts             buildBlock(BuildingSpec[]) → merged mesh + colliders
  src/world/collision.ts       AABB + moveWithCollision
  src/world/types.ts           DistrictDef, LandmarkDef, NpcDef, Vec2
  src/world/district.ts        loadDistrict(id) → District (dynamic import)
  src/world/districts/walledCity.ts  miRoad.ts  university.ts  malviyaNagar.ts
  src/world/landmarks/*.ts     one hand-built model per landmark
  src/world/stamps.ts          stamp collection (storage-backed)
  src/world/npcs.ts            NPC walkers
  src/player/controls.ts       keyboard + joystick → move vector
  src/player/avatar.ts         buildAvatar(look)
  src/player/camera.ts         follow camera
  src/live/sky.ts              skyParams() (pure) + applySky()
  src/live/weatherFx.ts        rain / dust particles, night lights
  src/live/festivalFx.ts       kites / diyas / colour
  src/live/cityLine.ts         one Hinglish line for the HUD
  src/ui/Intro.tsx  Hud.tsx  Joystick.tsx  LandmarkCard.tsx  NpcCard.tsx  TravelSheet.tsx  NoWebGL.tsx
  tests/city.spec.ts  tests/device-perf.spec.ts  tests/support/city.ts
```

---

### Task 1: Repo scaffold, health check, CI

**Files:**
- Create: root `package.json`, `.gitignore`, `.prettierrc.json`, `scripts/check-protocol.mjs`,
  `.github/workflows/deploy.yml`
- Create: `backend/{package.json,tsconfig.json,vitest.config.ts,wrangler.jsonc}`,
  `backend/src/{index.ts,env.ts,cors.ts,protocol.ts}`, `backend/test/{env.d.ts,worker.test.ts}`
- Create: `frontend/{package.json,vite.config.ts,tsconfig.json,tsconfig.app.json,tsconfig.node.json,eslint.config.js,playwright.config.ts,index.html}`,
  `frontend/src/{main.tsx,App.tsx,index.css}`, `frontend/src/net/protocol.ts`, `frontend/public/{CNAME,manifest.webmanifest,icon.svg}`

**Interfaces:**
- Produces: `GET /health` → `200 {"ok":true}`; `corsHeaders(origin: string): Record<string,string>`,
  `allowedOrigin(origin: string | null): string | null` in `backend/src/cors.ts`; root scripts `dev`,
  `build`, `lint`, `test`, `check:protocol`, `test:device`.
- Produces in `protocol.ts`:
  `export type DistrictId = 'walled-city' | 'mi-road' | 'university' | 'malviya-nagar'`. Task 2 adds the
  rest.

- [ ] **Step 1: Root files.** Root `package.json`:
  - `"name": "gulabi-gali"`, `"private": true`, and `"workspaces": ["frontend","backend"]`.
  - Scripts:
    - `dev`: `npm run dev -w frontend`
    - `build`: `npm run build -w frontend`
    - `lint`: `npm run lint -w frontend`
    - `test`: `npm run check:protocol && npm run test --workspaces --if-present`
    - `check:protocol`: `node scripts/check-protocol.mjs`
    - `test:device`: `DEVICE_PERF=1 npm exec -w frontend -- playwright test tests/device-perf.spec.ts`

  `.gitignore` is copied from `games` minus the `.superpowers/sdd` line, plus `dist/`, `test-results/` and
  `playwright-report/`. `.prettierrc.json` is as in Global Constraints.
- [ ] **Step 2: Backend package.** Copy `games/backend/{package.json,tsconfig.json}` and drop
  `@games/shared` and `@clerk/backend`. `wrangler.jsonc`:
  - `name: "gulabi-gali-api"`, `main: "src/index.ts"`, `compatibility_date: "2026-11-01"`
  - `observability.enabled: true`
  - no Durable Objects yet

  `vitest.config.ts` uses `cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })`.
- [ ] **Step 3: Write the failing test** in `backend/test/worker.test.ts`:

```ts
import { SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('answers /health', async () => {
  const res = await SELF.fetch('https://api.test/health')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})

it('allows the production site and local dev origins only', async () => {
  for (const origin of ['https://gulabi-gali.manishbisht.me', 'http://127.0.0.1:5173', 'http://localhost:5173']) {
    const res = await SELF.fetch('https://api.test/health', { headers: { Origin: origin } })
    expect(res.headers.get('access-control-allow-origin')).toBe(origin)
  }
  const evil = await SELF.fetch('https://api.test/health', { headers: { Origin: 'https://evil.example' } })
  expect(evil.headers.get('access-control-allow-origin')).toBeNull()
})

it('404s unknown paths as JSON', async () => {
  const res = await SELF.fetch('https://api.test/nope')
  expect(res.status).toBe(404)
  expect(await res.json()).toEqual({ error: 'not found' })
})
```

- [ ] **Step 4: Run it to make sure it fails.** Run `npm i && npm run test -w backend`. Expected: FAIL,
  because the Worker has no handler.
- [ ] **Step 5: Implement** `backend/src/index.ts` (`export default { fetch }`) with `/health`, JSON 404,
  `OPTIONS` preflight, and CORS via `cors.ts`.
- [ ] **Step 6: Run the tests and make sure they pass.** Run `npm run test -w backend && npm run typecheck -w backend`. Expected: PASS.
- [ ] **Step 7: Frontend package.** Copy from `games/frontend` the files `package.json`, `tsconfig*.json`,
  `eslint.config.js`, `playwright.config.ts` and `vite.config.ts`, with these changes:
  - **Dependencies:** drop `@clerk/react`, `@games/shared`, `chess.js`, `react-router` and
    `lucide-react`. Keep `react`, `react-dom` and `three`.
  - **`vite.config.ts`:** keep the CSP plugin minus the Clerk parts, keep the `three` chunk group, and
    remove `chunkSizeWarningLimit`.
  - **`playwright.config.ts`:** keep both webServers, and remove the SMOKE `testIgnore` and the visual
    `snapshotPathTemplate`.

  `index.html` is new:
  - `lang="hi-Latn"`
  - title `Gulabi Gali — Jaipur ke log`
  - `theme-color` `#2a1d24`
  - `viewport-fit=cover`
  - the manifest link
  - a `<div id="root">`

  `public/CNAME` contains `gulabi-gali.manishbisht.me`. `App.tsx` renders `<main>Padharo!</main>` for now.
- [ ] **Step 8: Protocol copy and check.** Write `backend/src/protocol.ts` with `DistrictId` and copy it
  to `frontend/src/net/protocol.ts`. `scripts/check-protocol.mjs` reads both files and, if they differ,
  prints `protocol.ts copies differ: edit backend/src/protocol.ts and copy it to frontend/src/net/protocol.ts`
  and exits 1.
- [ ] **Step 9: Verify the check bites.** Append a space to the frontend copy and run
  `npm run check:protocol`. Expected: exit 1 with that message. Revert, run again, and expect exit 0.
- [ ] **Step 10: CI.** Adapt `games/.github/workflows/deploy.yml`:
  - The `check` job runs `npm run check:protocol`, the frontend lint and tests, and the backend tests and
    typecheck. There is no shared step.
  - The `e2e`, `build`, `deploy` and `deploy-api` jobs stay as in `games`.
  - The build env has only `VITE_API_URL` and `VITE_RELEASE`.
  - The Pages comment names `gulabi-gali.manishbisht.me`.
- [ ] **Step 11: Verify the whole thing.** Run `npm run lint && npm test && npm run build`. Expected: all
  green, and `frontend/dist/index.html` exists.
- [ ] **Step 12: Commit.** `git add -A && git commit -m "chore: scaffold frontend and backend workspaces with CI"`

---

### Task 2: Live city snapshot API (weather, AQI, sun, festival)

**Files:**
- Create: `backend/src/{weather.ts,festivals.ts,festivals.data.ts}`, `backend/test/{weather.test.ts,festivals.test.ts}`
- Modify: `backend/src/{protocol.ts,index.ts,env.ts}`, `backend/wrangler.jsonc`, `backend/test/worker.test.ts`,
  `frontend/src/net/protocol.ts` (re-copy)

**Interfaces:**
- Produces in `protocol.ts`:

```ts
export type FestivalId = 'sankranti' | 'holi' | 'gangaur' | 'teej' | 'diwali' | 'jlf'
export type Condition = 'clear' | 'cloudy' | 'fog' | 'rain' | 'storm' | 'dust'
export type AqiBand = 'good' | 'moderate' | 'poor' | 'unhealthy' | 'severe'
export interface CitySnapshot {
  fetchedAt: string // ISO instant
  tempC: number | null
  condition: Condition
  aqi: number | null // US AQI
  aqiBand: AqiBand
  sunrise: string // ISO instant, today in IST
  sunset: string
  festival: FestivalId | null
  stale: boolean // true when this is the built-in default, not live data
}
```

- Produces in `weather.ts`:
  - `JAIPUR = { lat: 26.9124, lon: 75.7873 }`
  - `toCondition(weatherCode: number, dustUgM3: number | null, precipitationMm: number): Condition`
  - `toAqiBand(aqi: number | null): AqiBand`
  - `fetchSnapshot(fetcher: typeof fetch, now: Date): Promise<CitySnapshot>`
  - `defaultSnapshot(now: Date): CitySnapshot`
- Produces in `festivals.ts`: `festivalOn(now: Date, calendar?: FestivalEntry[]): FestivalId | null`
  with `interface FestivalEntry { id: FestivalId; start: string; end: string }`. The dates are
  `YYYY-MM-DD` in IST and inclusive.
- Produces: `GET /api/city` → `CitySnapshot` with `Cache-Control: public, max-age=300`. The scheduled
  handler runs every 15 minutes. `refreshCity(env: Env, fetcher: typeof fetch, now: Date): Promise<CitySnapshot>`
  is exported from `index.ts` for tests.

- [ ] **Step 1: Write the failing tests** in `weather.test.ts`:

```ts
it('maps WMO codes and dust to conditions', () => {
  expect(toCondition(0, 20, 0)).toBe('clear')
  expect(toCondition(3, 20, 0)).toBe('cloudy')
  expect(toCondition(45, 20, 0)).toBe('fog')
  expect(toCondition(61, 20, 2)).toBe('rain')
  expect(toCondition(95, 20, 5)).toBe('storm')
  expect(toCondition(1, 180, 0)).toBe('dust') // dust ≥ 150 µg/m³ and dry
  expect(toCondition(61, 180, 2)).toBe('rain') // rain beats dust
})
it('bands US AQI', () => {
  expect([40, 90, 140, 190, 260, null].map(toAqiBand)).toEqual([
    'good', 'moderate', 'poor', 'unhealthy', 'severe', 'moderate',
  ])
})
it('builds a snapshot from both Open-Meteo endpoints', async () => {
  // fake fetcher: forecast → { current: { temperature_2m: 31.4, weather_code: 0, precipitation: 0 },
  //   daily: { sunrise: ['2026-11-14T06:44'], sunset: ['2026-11-14T17:34'] } }
  // air quality → { current: { us_aqi: 162, dust: 40 } }
  const s = await fetchSnapshot(fake, new Date('2026-11-14T06:30:00Z'))
  expect(s).toMatchObject({ tempC: 31.4, condition: 'clear', aqi: 162, aqiBand: 'unhealthy', stale: false })
  expect(s.sunrise).toBe('2026-11-14T01:14:00.000Z') // 06:44 IST
})
```

  `festivals.test.ts`:

```ts
const cal = [{ id: 'diwali', start: '2027-10-28', end: '2027-10-30' }] as const
it('is inclusive and uses IST days', () => {
  expect(festivalOn(new Date('2027-10-27T18:29:00Z'), [...cal])).toBeNull() // 23:59 IST on the 27th
  expect(festivalOn(new Date('2027-10-27T18:31:00Z'), [...cal])).toBe('diwali') // 00:01 IST on the 28th
  expect(festivalOn(new Date('2027-10-30T18:29:00Z'), [...cal])).toBe('diwali')
  expect(festivalOn(new Date('2027-10-30T18:31:00Z'), [...cal])).toBeNull()
})
it('the real calendar covers every festival in 2027', () => {
  const ids = new Set(CALENDAR.filter((e) => e.start.startsWith('2027')).map((e) => e.id))
  expect([...ids].sort()).toEqual(['diwali', 'gangaur', 'holi', 'jlf', 'sankranti', 'teej'])
})
```

  Add to `worker.test.ts`:
  - `serves the stored snapshot`: put a snapshot in `env.CITY` and expect GET `/api/city` to return it
    with the cache header.
  - `serves a default snapshot when upstream fails`: KV is empty and the fetcher rejects. Expect status 200
    and `stale: true`.
  - `refreshCity stores to KV`: expect key `now` to hold the JSON afterwards.

- [ ] **Step 2: Run them to make sure they fail.** Run `npm run test -w backend`. Expected: FAIL, with the
  modules missing.
- [ ] **Step 3: Implement `weather.ts`.**
  - Use the forecast URL `https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&current=temperature_2m,precipitation,weather_code&daily=sunrise,sunset&timezone=Asia%2FKolkata&forecast_days=1`
    and the air URL `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=…&longitude=…&current=us_aqi,dust&timezone=Asia%2FKolkata`.
  - Open-Meteo returns local IST times without an offset. Append `+05:30` before parsing.
  - Map WMO codes this way:
    - 0–1: clear
    - 2–3: cloudy
    - 45 and 48: fog
    - 51–67 and 80–82: rain
    - 95–99: storm
    - anything else: cloudy
  - The AQI bands are ≤50, ≤100, ≤150 and ≤200, then above 200. `null` maps to `moderate`.
  - `defaultSnapshot` uses `condition: 'clear'`, `tempC: null`, `aqi: null`, sunrise 06:30 IST, sunset
    18:00 IST, `festival: festivalOn(now)` and `stale: true`.
- [ ] **Step 4: Implement `festivals.ts`.** Fill `festivals.data.ts` with real dates from Dec 2026 to Dec
  2028, taken from the Government of Rajasthan's published holiday list (or drikpanchang.com) **and checked
  against a second source**. Cite the source in a comment above each year. Windows:
  - **Sankranti:** the day itself plus the day before.
  - **Holi:** Holika Dahan through Dhulandi.
  - **Gangaur:** the 2 procession days.
  - **Teej:** the 2 procession days.
  - **Diwali:** Dhanteras through Bhai Dooj.
  - **JLF:** the festival's announced 5 days, or the last week of January when the dates aren't
    announced yet.
- [ ] **Step 5: Wire up the Worker.**
  - Add `kv_namespaces: [{ binding: "CITY", id: "<create with wrangler kv namespace create CITY>" }]` and
    `triggers: { crons: ["*/15 * * * *"] }` to `wrangler.jsonc`. Add `CITY: KVNamespace` to `Env`.
  - `GET /api/city`: KV `now` → otherwise `refreshCity`, and if that throws → `defaultSnapshot`.
  - `scheduled` calls `refreshCity(env, fetch, new Date())`. Each refresh recomputes the festival.
- [ ] **Step 6: Copy the protocol and run the tests.** Copy `protocol.ts` to the frontend, then run
  `npm run check:protocol && npm run test -w backend && npm run typecheck -w backend`. Expected: PASS.
- [ ] **Step 7: Live check.** Run `cd backend && npx wrangler dev --test-scheduled`, then
  `curl 'http://127.0.0.1:8787/__scheduled?cron=*/15+*+*+*+*' && curl http://127.0.0.1:8787/api/city`.
  Expected: a snapshot with `stale: false` and plausible Jaipur numbers.
- [ ] **Step 8: Commit.** `feat(api): live Jaipur weather, AQI, sun and festival snapshot`

---

### Task 3: Frontend shell: storage, language, API client, intro and HUD frame

**Files:**
- Create: `frontend/src/storage.ts`, `src/storage.test.ts`, `src/i18n/{strings.ts,lang.ts,strings.test.ts}`,
  `src/net/api.ts`, `src/net/api.test.ts`, `src/ui/{Intro.tsx,Hud.tsx}`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces:
  - `storage.get(key: string): string | null`, `storage.set(key: string, value: string): void` and
    `storage.getJSON<T>(key: string, fallback: T): T`. On any exception they fall back to an in-memory map.
  - `type Lang = 'hi' | 'en'`, `t(key: StringKey, lang: Lang, vars?: Record<string, string | number>): string`
    and `useLang(): [Lang, (l: Lang) => void]`, persisted under `gg-lang`.
  - `fetchCity(signal?: AbortSignal): Promise<CitySnapshot>`, which never rejects. On failure it returns a
    local copy of the default snapshot with `stale: true`. `API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8787'`.
  - `<Intro onEnter={() => void} />` with a button labelled `t('enter')` ("Padharo!" / "Come in").
  - `<Hud district snapshot lang onLang />`, with slots that later tasks fill.

- [ ] **Step 1: Write the failing tests.**

```ts
// storage.test.ts
it('storage survives a throwing localStorage', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
  storage.set('gg-x', '1')
  expect(storage.get('gg-x')).toBe('1') // from memory
  expect(storage.getJSON('gg-missing', [])).toEqual([])
})
// strings.test.ts
it('every string has Hinglish and English', () => {
  for (const [key, v] of Object.entries(STRINGS)) {
    expect(v.hi.trim(), key).not.toBe('')
    expect(v.en.trim(), key).not.toBe('')
  }
})
it('interpolates vars', () => expect(t('stampGot', 'en', { place: 'Hawa Mahal' })).toBe('Stamp collected: Hawa Mahal'))
// api.test.ts
it('fetchCity falls back on network error', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  const s = await fetchCity()
  expect(s.stale).toBe(true)
  expect(s.condition).toBe('clear')
})
```

- [ ] **Step 2: Run them to make sure they fail.** Run `npm run test -w frontend`. Expected: FAIL.
- [ ] **Step 3: Implement** `storage.ts`, `strings.ts` (start with `enter`, `stampGot`, `loading`,
  `noWebgl`, `weatherUnknown`, and add more as tasks need them), `lang.ts`, `api.ts`, `Intro.tsx` and
  `Hud.tsx`. `App` shows `Intro` until the user taps, then the HUD over an empty `<canvas>`.
- [ ] **Step 4: Run the tests and make sure they pass.** Run `npm run test -w frontend && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(web): shell with safe storage, Hinglish/English strings and city API client`

---

### Task 4: Stage: renderer, loop, quality tiers, WebGL fallback

**Files:**
- Create: `frontend/src/engine/{stage.ts,webgl.ts,stage.test.ts}`, `src/ui/NoWebGL.tsx`, `src/testHooks.ts`,
  `frontend/tests/{city.spec.ts,support/city.ts}`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces:
  - `hasWebGL(): boolean`
  - `createStage(canvas: HTMLCanvasElement): Stage`, where
    `interface Stage { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; quality: 0 | 1 | 2; onFrame(cb: (dt: number) => void): () => void; onQuality(cb: (q: 0|1|2) => void): () => void; dispose(): void }`
  - `clampDelta(ms: number): number`, which returns seconds clamped to [0, 0.1].
- Quality tiers, as in `games/frontend/src/motion/stage.ts`. Read it and port `measure`/`applyQuality`:
  - **2:** pixel ratio ≤ 2, with shadows
  - **1:** pixel ratio ≤ 1.25, with shadows
  - **0:** pixel ratio 1, no shadows

  It steps down when more than 60% of ~2.5 s of frames take over 22 ms, and never steps back up within the
  tab session. The tier is remembered in sessionStorage as `gg-quality`.
- The loop pauses on `visibilitychange` → hidden. On `webglcontextlost` it calls `preventDefault`, and on
  `webglcontextrestored` it rebuilds. It re-fits on `resize` and `orientationchange`.
- `src/testHooks.ts` exports `installTestHooks(api: Partial<GgTestApi>): void`, which merges into
  `window.__gg` only when `location.search` contains `gg-test=1`. Later tasks add methods. `GgTestApi` is
  declared in that file and grows task by task: `quality()`, `framesSinceRestore()`, then `position()`, `teleport(x,z)`,
  `district()`, `sky()`, `festival()`, `setSnapshot(partial)`, `setNow(iso)`.

- [ ] **Step 1: Write the failing tests.**

```ts
// stage.test.ts
it('clamps frame delta to 0.1s', () => {
  expect(clampDelta(16)).toBeCloseTo(0.016)
  expect(clampDelta(5 * 60_000)).toBe(0.1) // back from background
  expect(clampDelta(-5)).toBe(0)
})
```

```ts
// tests/city.spec.ts
test('shows the no-3D screen without WebGL', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      return type.startsWith('webgl') ? null : orig.call(this, type, ...rest)
    } as typeof orig
  })
  await page.goto('/?gg-test=1')
  await expect(page.getByText('Is phone/browser pe 3D nahi chal raha')).toBeVisible()
})
test('enters the city and renders', async ({ page }) => {
  await enterCity(page) // support/city.ts: goto '/?gg-test=1', click 'Padharo!', wait for window.__gg
  expect(await page.evaluate(() => window.__gg.quality())).toBeGreaterThanOrEqual(0)
})
test('recovers after the WebGL context is lost', async ({ page }) => {
  await enterCity(page)
  await page.evaluate(async () => {
    const ext = document.querySelector('canvas')!.getContext('webgl2')!.getExtension('WEBGL_lose_context')!
    ext.loseContext()
    await new Promise((r) => setTimeout(r, 300))
    ext.restoreContext()
  })
  await expect.poll(() => page.evaluate(() => window.__gg.framesSinceRestore())).toBeGreaterThan(5)
})
```

- [ ] **Step 2: Run them to make sure they fail.** Run `npm run test -w frontend` and
  `cd frontend && npx playwright test tests/city.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `webgl.ts`, `stage.ts`, `NoWebGL.tsx` (`t('noWebgl')`: "Is phone/browser pe 3D
  nahi chal raha. Chrome mein kholo — wahan chalega." / "3D doesn't run on this phone/browser. Open in
  Chrome and it should work.") and `testHooks.ts`. `App` mounts the stage after Intro.
- [ ] **Step 4: Run the tests and make sure they pass.** Run the same two commands. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(web): Three.js stage with quality tiers, context-loss recovery and no-WebGL screen`

---

### Task 5: Building kit, palette, collision

**Files:**
- Create: `frontend/src/world/{palette.ts,kit.ts,collision.ts,types.ts,kit.test.ts,collision.test.ts}`

**Interfaces:**
- Produces in `types.ts`:

```ts
export type Vec2 = { x: number; z: number }
export interface AABB { minX: number; maxX: number; minZ: number; maxZ: number }
export type BuildingStyle = 'haveli' | 'shop' | 'modern' | 'temple' | 'wall'
export interface BuildingSpec { x: number; z: number; w: number; d: number; floors: 1 | 2 | 3 | 4; style: BuildingStyle; tint?: PaletteKey; rot?: 0 | 90 | 180 | 270 }
export interface LandmarkDef { id: string; name: { hi: string; en: string }; story: { hi: string; en: string }; at: Vec2; radius: number; build: () => Promise<THREE.Group>; footprint: AABB }
export interface NpcDef { id: string; name: string; role: { hi: string; en: string }; status: { hi: string; en: string }; look: AvatarLook; route: Vec2[]; speed: number }
export interface DistrictDef { id: DistrictId; name: { hi: string; en: string }; size: number; spawn: Vec2; station: Vec2; ground: PaletteKey; buildings: BuildingSpec[]; landmarks: LandmarkDef[]; npcs: NpcDef[]; props: PropSpec[] }
export type AvatarLook = { skin: 0 | 1 | 2 | 3 | 4; outfit: PaletteKey; head: 'none' | 'safa' | 'cap' | 'dupatta' | 'bun' }
export interface PropSpec { kind: 'tapri' | 'tree' | 'lamp' | 'auto' | 'bench' | 'poster-wall' | 'station'; at: Vec2; rot?: number }
```

- Produces:
  - `PALETTE`, with keys `pink`, `terracotta`, `sandstone`, `ochre`, `white`, `teal`, `marigold`, `road`
    and `grass`. Pink City pink is around `#E4917A`, sandstone around `#D9B382`.
  - `buildBlock(specs: BuildingSpec[]): { mesh: THREE.Mesh; colliders: AABB[] }`. It returns **one** merged
    `BufferGeometry` with vertex colours and one `MeshLambertMaterial`.
  - `moveWithCollision(from: Vec2, step: Vec2, colliders: AABB[], radius: number): Vec2`, which slides along
    walls axis by axis.
- **Styles:**
  - **haveli:** pink facade, a jharokha bay on each upper floor, and a parapet with small chhatri domes.
  - **shop:** a ground-floor arcade of arches with a shutter colour.
  - **modern:** a plain box with balconies.
  - **temple:** a shikhara.
  - **wall:** a crenellated city wall segment.

  Floor height is 3.2 m. The colliders are the footprint after rotation, with no padding. The
  player's radius is added in `moveWithCollision`.

- [ ] **Step 1: Write the failing tests.**

```ts
it('merges a block into one mesh with colliders per building', () => {
  const { mesh, colliders } = buildBlock([
    { x: 0, z: 0, w: 10, d: 8, floors: 3, style: 'haveli' },
    { x: 20, z: 0, w: 6, d: 4, floors: 1, style: 'shop', rot: 90 },
  ])
  expect(mesh.geometry.getAttribute('color')).toBeTruthy()
  expect(Array.isArray(mesh.material)).toBe(false)
  expect(colliders).toEqual([
    { minX: -5, maxX: 5, minZ: -4, maxZ: 4 },
    { minX: 18, maxX: 22, minZ: -3, maxZ: 3 }, // rot 90 swaps w and d
  ])
})
it('haveli gets taller per floor', () => {
  const h = (f: 1 | 4) => { const g = buildBlock([{ x: 0, z: 0, w: 8, d: 8, floors: f, style: 'haveli' }]).mesh.geometry; g.computeBoundingBox(); return g.boundingBox!.max.y }
  expect(h(4)).toBeGreaterThan(h(1) + 9)
})
// collision.test.ts
const wall = [{ minX: 0, maxX: 1, minZ: -10, maxZ: 10 }]
it('stops at a wall and slides along it', () => {
  expect(moveWithCollision({ x: -1, z: 0 }, { x: 2, z: 1 }, wall, 0.4)).toEqual({ x: -0.4, z: 1 })
})
it('never crosses a collider in one step', () => {
  expect(moveWithCollision({ x: -1, z: 0 }, { x: 50, z: 0 }, wall, 0.4).x).toBeLessThanOrEqual(-0.4)
})
```

- [ ] **Step 2: Run them to make sure they fail.**
- [ ] **Step 3: Implement.** Build the geometry with `BufferGeometryUtils.mergeGeometries` from
  `three/examples/jsm/utils/BufferGeometryUtils.js`, with low-poly boxes and cylinders and colour baked
  per vertex. Collision sweeps each axis separately against the AABBs expanded by the radius, and splits
  large steps into sub-steps of ≤ radius.
- [ ] **Step 4: Run the tests and make sure they pass.** Run `npm run test -w frontend`.
- [ ] **Step 5: Commit.** `feat(web): procedural Jaipur building kit and wall-sliding collision`

---

### Task 6: Player: controls, avatar, follow camera

**Files:**
- Create: `frontend/src/player/{controls.ts,avatar.ts,camera.ts,controls.test.ts,avatar.test.ts}`,
  `src/ui/Joystick.tsx`
- Modify: `frontend/src/App.tsx`, `src/testHooks.ts`

**Interfaces:**
- Produces:
  - `AvatarLook`, already defined in `world/types.ts` (Task 5)
  - `randomLook(rand?: () => number): AvatarLook`
  - `loadOrCreateLook(): AvatarLook`, persisted under `gg-look`
  - `buildAvatar(look: AvatarLook): THREE.Group`, low-poly and under 600 triangles
  - `createControls(target: Window): Controls`, where `interface Controls { move(): Vec2; interact(): boolean; setJoystick(v: Vec2): void; dispose(): void }`.
    `move()` has length ≤ 1 and is camera-relative. Keys are WASD, the arrows and E. The joystick vector
    comes in through `setJoystick`.
  - `createFollowCamera(camera: THREE.PerspectiveCamera): { update(target: Vec3Like, dt: number): void }`.
    It sits behind and above the player (about 7 m back and 4.5 m up), lerps, and has no free orbit on
    touch in this phase.
  - `<Joystick onChange={(v: Vec2) => void} />`, in the bottom-left inside the safe area. It shows only
    on `(pointer: coarse)`.
- Walk speed is 4 m/s. The avatar faces its move direction.
- Test hooks: `position()` and `teleport(x, z)`.

- [ ] **Step 1: Write the failing tests.**

```ts
it('normalises diagonal keyboard input', () => {
  const c = createControls(fakeWindow)
  press('KeyW'); press('KeyD')
  const v = c.move()
  expect(Math.hypot(v.x, v.z)).toBeCloseTo(1)
})
it('joystick magnitude is kept (walk slowly with a small push)', () => {
  const c = createControls(fakeWindow); c.setJoystick({ x: 0, z: 0.3 })
  expect(c.move()).toEqual({ x: 0, z: 0.3 })
})
it('avatars stay under the triangle budget for every head', () => {
  for (const head of ['none', 'safa', 'cap', 'dupatta', 'bun'] as const)
    expect(triangleCount(buildAvatar({ skin: 2, outfit: 'teal', head }))).toBeLessThan(600)
})
```

  `tests/city.spec.ts`:
  - `walks with the keyboard`: after `enterCity`, hold `w` for 800 ms and expect the distance from spawn to
    exceed 2 m.
  - `joystick walks on a phone`: `test.use(devices['Pixel 7'] minus defaultBrowserType)`, drag the
    joystick knob up 40 px for 800 ms, and expect the position to have changed.
- [ ] **Step 2: Run them to make sure they fail.**
- [ ] **Step 3: Implement.** Wire the player loop in `App`: read `controls.move()`, then
  `moveWithCollision`, then update the avatar and camera. The world is still empty, so use a flat ground
  plane for now.
- [ ] **Step 4: Run the unit tests and e2e, and make sure they pass.**
- [ ] **Step 5: Commit.** `feat(web): avatar, touch joystick and keyboard walking with follow camera`

---

### Task 7: District loader and the Walled City

**Files:**
- Create: `frontend/src/world/{district.ts,district.test.ts}`, `src/world/districts/walledCity.ts`,
  `src/world/landmarks/{hawaMahal.ts,jantarMantar.ts,tripoliaGate.ts,badiChaupar.ts}`, `src/world/props.ts`
- Modify: `frontend/src/App.tsx`, `src/testHooks.ts`, `src/ui/Hud.tsx`

**Interfaces:**
- Produces:
  - `loadDistrict(id: DistrictId): Promise<District>`, using `import()` on
    `./districts/<file>.ts` so each district is its own chunk.
  - `interface District { def: DistrictDef; root: THREE.Group; colliders: AABB[]; dispose(): void }`.
    The colliders are the buildings, the landmark footprints and an outer boundary.
  - `buildProps(props: PropSpec[]): { group: THREE.Group; colliders: AABB[] }`, which uses
    `InstancedMesh` per kind.
- **Walled City layout:** 240 × 240 m. This is a loose but recognisable take on the grid:
  - **Main street:** a wide east–west bazaar street (Tripolia/Sireh Deori), meeting a north–south
    Johari Bazaar at **Badi Chaupar** (a square with a fountain, at the origin).
  - **Hawa Mahal:** faces the street, north-east of the Chaupar.
  - **Jantar Mantar:** an open courtyard with the large sundial, north-west of the Chaupar.
  - **Tripolia gate:** at the west end.
  - **City wall:** segments along the edges.
  - **Fill:** 80–120 havelis and shops in pink.
  - **Props:** 3+ tapris, 2+ poster walls (empty in this phase), parked autos, trees and lamps.
  - **Metro station:** an entrance near the Chaupar (the Pink Line really ends at Badi Chaupar).
- **Landmark models:**
  - **Hawa Mahal:** a stepped five-storey honeycomb facade of small jharokhas. The signature model, worth
    the most care, still under 8k triangles.
  - **Jantar Mantar:** the Samrat Yantra ramp and 2–3 smaller instruments.
  - **Tripolia gate:** a triple-arch gate.
  - **Badi Chaupar:** a square and fountain.
- Test hook: `district()`. The HUD shows `def.name[lang]`.

- [ ] **Step 1: Write the failing tests** in `district.test.ts`, run against **each** `DistrictDef`. Start
  with walled city, and Task 12 adds the others to the same table.

```ts
it.each(DISTRICTS)('%s: spawn, station and landmarks are walkable', async (id) => {
  const d = await loadDistrict(id)
  const blocked = (p: Vec2) => d.colliders.some((c) => p.x > c.minX - 0.4 && p.x < c.maxX + 0.4 && p.z > c.minZ - 0.4 && p.z < c.maxZ + 0.4)
  expect(blocked(d.def.spawn)).toBe(false)
  expect(blocked(d.def.station)).toBe(false)
  for (const l of d.def.landmarks) expect(ringHasOpening(l, d.colliders), l.id).toBe(true) // some point on the trigger ring is free
})
it.each(DISTRICTS)('%s: landmark ids are unique and texts bilingual', async (id) => { /* ids unique across ALL districts; name/story hi+en non-empty */ })
it.each(DISTRICTS)('%s: buildings do not overlap landmarks', async (id) => { /* no building AABB intersects a landmark footprint */ })
```

  E2E: `opens on the Pink City`. After `enterCity`, the HUD shows `Gulabi Shahar` (or `Pink City` with
  English), and `__gg.district()` is `walled-city`.
- [ ] **Step 2: Run them to make sure they fail.**
- [ ] **Step 3: Implement.** The district is lit by one `HemisphereLight` and one `DirectionalLight` (the
  sun, which casts shadows only at tier 2). Task 9 drives both. Aim for under 150 draw calls in the
  district.
- [ ] **Step 4: Run the tests and make sure they pass.** Also run `npm run build` and check that the
  walled-city chunk in `dist/assets` is under 150 kB gzipped.
- [ ] **Step 5: Commit.** `feat(web): Walled City district with Hawa Mahal, Jantar Mantar, Tripolia and Badi Chaupar`

---

### Task 8: Landmark stories and Jaipur Darshan stamps

**Files:**
- Create: `frontend/src/world/{stamps.ts,stamps.test.ts}`, `src/ui/LandmarkCard.tsx`
- Modify: `frontend/src/App.tsx`, `src/ui/Hud.tsx`, `src/i18n/strings.ts`

**Interfaces:**
- Produces:
  - `collected(): string[]`
  - `collect(id: string): boolean`, which returns true only the first time
  - `nearestLandmark(pos: Vec2, landmarks: LandmarkDef[]): LandmarkDef | null`, which returns a landmark
    only when within `radius`

  Storage key: `gg-stamps`.
- **Behaviour:** walking within a landmark's radius slides up a `LandmarkCard` with the name, the 1–2 line
  story and a "Stamp lo" button. On a phone, tapping the button collects the stamp. On desktop, E does it.
  The card hides when the player leaves. The first collection shows a toast with `t('stampGot', { place })`,
  "Jaipur Darshan · stamp mila: {place}", and the HUD shows a stamp count of `N/9`, where 9 is the total
  number of landmarks across all four districts.
- **Stories:** factual and short. For example, Hawa Mahal: "1799 mein Maharaja Sawai Pratap Singh ne
  banwaya — 953 jharokhe, taaki raaniyan bina dikhe bazaar dekh sakein." Check every fact against a
  second source before committing.

- [ ] **Step 1: Write the failing tests.**

```ts
it('collects once and persists', () => {
  expect(collect('hawa-mahal')).toBe(true)
  expect(collect('hawa-mahal')).toBe(false)
  expect(collected()).toEqual(['hawa-mahal'])
  expect(JSON.parse(localStorage.getItem('gg-stamps')!)).toEqual(['hawa-mahal'])
})
it('finds the landmark only inside its radius', () => {
  const l = { id: 'x', at: { x: 10, z: 0 }, radius: 6 } as LandmarkDef
  expect(nearestLandmark({ x: 5, z: 0 }, [l])?.id).toBe('x')
  expect(nearestLandmark({ x: 3, z: 0 }, [l])).toBeNull()
})
```

  E2E: `collects a stamp at Hawa Mahal`:
  1. Teleport into Hawa Mahal's ring.
  2. Click `Stamp lo`.
  3. Expect the toast `stamp mila: Hawa Mahal` and the HUD `1/9`.
  4. Reload and re-enter, and expect the HUD to still show `1/9`.
- [ ] **Step 2: Run them to make sure they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and make sure they pass.**
- [ ] **Step 5: Commit.** `feat(web): landmark stories and Jaipur Darshan stamps`

---

### Task 9: Live sky: weather, AQI haze, IST sun, night lights, city line

**Files:**
- Create: `frontend/src/live/{sky.ts,sky.test.ts,weatherFx.ts,cityLine.ts,cityLine.test.ts}`
- Modify: `frontend/src/App.tsx`, `src/ui/Hud.tsx`, `src/testHooks.ts`

**Interfaces:**
- Produces:
  - `skyParams(s: CitySnapshot, now: Date): SkyParams`, a pure function, where
    `interface SkyParams { sunElevationDeg: number; sunAzimuthDeg: number; skyTop: string; skyHorizon: string; fogDensity: number; sunIntensity: number; ambientIntensity: number; nightLights: boolean; rain: boolean; dust: boolean }`
  - `applySky(stage: Stage, district: District, p: SkyParams): void`
  - `createWeatherFx(stage: Stage): { set(p: SkyParams): void; update(dt: number): void; dispose(): void }`,
    with instanced rain streaks, a dust tint plus drifting motes, and particles halved at tier 0
  - `cityLine(s: CitySnapshot, lang: Lang): string`
- **Rules:**
  - **Sun position:** `p = (now − sunrise) / (sunset − sunrise)`. Elevation is `sin(π·p) · 70°` for p in
    [0, 1], and otherwise −10°. Azimuth goes from 90° (east) to 270°.
  - **Night lights:** on when `now < sunrise + 20 min` or `now > sunset − 20 min`. Lamps, tapri bulbs and
    the Hawa Mahal facade glow, with emissive values bumped.
  - **`fogDensity` by AQI band:**

    | Band | Fog density |
    |---|---|
    | good | 0.004 |
    | moderate | 0.008 |
    | poor | 0.014 |
    | unhealthy | 0.02 |
    | severe | 0.03 |

    Fog is ×1.6 for `fog`, the horizon is tinted `#d9b98c` for `dust`, and rain darkens the sky by 35%.
- **Updates:** fetch the snapshot on entry, then every 10 minutes. Recompute the sky every 30 s from
  `new Date()`. The HUD weather chip shows `31° · AQI 162`, or `t('weatherUnknown')` ("—") when the snapshot
  is stale.
- **City line:** the precedence is storm/rain > dust > `tempC ≥ 42` > AQI band. Hinglish (English
  alongside):

  | Case | Hinglish | English |
  |---|---|---|
  | rain | "Baarish! Pakode ka time." | "It's raining! Pakora time." |
  | dust | "Aandhi aa rahi hai — aankhein bachao." | "Dust storm coming, shield your eyes." |
  | heat | "Lu chal rahi hai, Hukum. Paani peete raho." | "Heatwave out there. Keep drinking water." |
  | good | "Aaj hawa saaf hai — Nahargarh tak dikh raha hai." | "Clear air today. You can see all the way to Nahargarh." |
  | moderate | "Hawa theek-thaak hai. Chai pe chalo?" | "The air's okay. Chai?" |
  | poor | "Thodi dhundh hai aaj. Mask rakh lo." | "A bit hazy today. Keep a mask handy." |
  | unhealthy/severe | "Hawa kharab hai, Hukum — aaj andar hi raho." | "The air is bad today. Best to stay in." |

- **Test hooks:** `sky()` returns the current `SkyParams`, `setSnapshot(partial)` overrides the snapshot,
  and `setNow(iso)` freezes the clock.

- [ ] **Step 1: Write the failing tests.**

```ts
const base = { sunrise: '2026-11-14T01:14:00.000Z', sunset: '2026-11-14T12:04:00.000Z', aqiBand: 'good', condition: 'clear', stale: false } as CitySnapshot
it('noon sun is high, midnight is below the horizon', () => {
  expect(skyParams(base, new Date('2026-11-14T06:39:00Z')).sunElevationDeg).toBeCloseTo(70, 0)
  expect(skyParams(base, new Date('2026-11-14T18:30:00Z')).sunElevationDeg).toBe(-10)
})
it('uses IST regardless of device timezone', () => {
  // 23:00 IST = 17:30Z; the instant is what matters, not the device's local hour
  process.env.TZ = 'America/New_York'
  expect(skyParams(base, new Date('2026-11-14T17:30:00Z')).nightLights).toBe(true)
})
it('haze follows AQI', () => {
  const d = (aqiBand: AqiBand) => skyParams({ ...base, aqiBand }, new Date('2026-11-14T06:39:00Z')).fogDensity
  expect([d('good'), d('poor'), d('severe')]).toEqual([0.004, 0.014, 0.03])
})
it('rain beats heat beats air in the city line', () => {
  expect(cityLine({ ...base, condition: 'rain', tempC: 44, aqiBand: 'severe' }, 'hi')).toBe('Baarish! Pakode ka time.')
  expect(cityLine({ ...base, tempC: 44, aqiBand: 'severe' }, 'hi')).toBe('Lu chal rahi hai, Hukum. Paani peete raho.')
})
```

  E2E: `falls back when the weather API is down`. Route `**/api/city` to abort, then expect the city to
  render and the weather chip to show `—`.
- [ ] **Step 2: Run them to make sure they fail.**
- [ ] **Step 3: Implement.** Use the scene background as a vertical gradient (a small canvas texture or
  a sky dome with vertex colours), with `scene.fog = new THREE.FogExp2(...)`.
- [ ] **Step 4: Run the tests and make sure they pass.** Then check by eye: run
  `__gg.setSnapshot({ aqiBand: 'severe' })` and `__gg.setNow('2026-11-14T13:00:00Z')` and confirm a hazy
  dusk with the lamps on.
- [ ] **Step 5: Commit.** `feat(web): live Jaipur sky from weather, AQI and IST sun`

---

### Task 10: Festival effects

**Files:**
- Create: `frontend/src/live/{festivalFx.ts,festivalFx.test.ts}`
- Modify: `frontend/src/App.tsx`, `src/ui/Hud.tsx`, `src/i18n/strings.ts`

**Interfaces:**
- Produces: `createFestivalFx(stage: Stage, district: District): { set(id: FestivalId | null, quality: 0|1|2): void; update(dt: number): void; dispose(): void }`
  and `festivalParticleCount(id: FestivalId, quality: 0|1|2): number`.
- **Effects in this phase:**
  - **sankranti:** instanced kites with drifting strings over the rooftops. There are 120 kites at tier
    2, 60 at tier 1 and 25 at tier 0.
  - **diwali:** diyas along the parapets, and the night lights stay on from sunset.
  - **holi:** colour puffs at the Chaupar or a district's centre, with 80/40/15 puffs by tier.
  - **gangaur, teej, jlf:** a HUD banner only. Processions come in phase 4.

  Every festival also shows a HUD banner, for example "Makar Sankranti mubarak! Aasmaan dekho 🪁".
- The snapshot's `festival` field drives this. In test mode, `?gg-festival=<id>` overrides it.

- [ ] **Step 1: Write the failing test.**

```ts
it('scales particles by quality tier', () => {
  expect([2, 1, 0].map((q) => festivalParticleCount('sankranti', q as 0 | 1 | 2))).toEqual([120, 60, 25])
  expect(festivalParticleCount('gangaur', 2)).toBe(0)
})
```

  E2E: `kite sky on Sankranti`. Open with `?gg-test=1&gg-festival=sankranti`, then expect the banner text
  and `__gg.festival()` to be `'sankranti'`.
- [ ] **Step 2: Run them to make sure they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and make sure they pass.**
- [ ] **Step 5: Commit.** `feat(web): Sankranti kites, Diwali diyas, Holi colour and festival banners`

---

### Task 11: Seed characters

**Files:**
- Create: `frontend/src/world/{npcs.ts,npcs.test.ts}`, `src/ui/NpcCard.tsx`
- Modify: `frontend/src/world/districts/walledCity.ts` (it gets its `npcs`), `src/App.tsx`

**Interfaces:**
- Produces:
  - `createNpcs(defs: NpcDef[], scene: THREE.Object3D): { update(dt: number): void; pick(ray: THREE.Raycaster): NpcDef | null; dispose(): void }`
  - `stepAlongRoute(pos: Vec2, route: Vec2[], legIndex: number, speed: number, dt: number): { pos: Vec2; legIndex: number }`,
    which loops the route
- **Behaviour:** each NPC walks its route at its speed and pauses for 2–5 s at each waypoint, with a
  status bubble overhead (shown within 15 m only). Tapping one, or pressing E when it's the nearest within
  3 m, opens `NpcCard` with the name, role, status and the fixed line `t('npcNotReal')`: "Ye ek kirdaar hai,
  asli insaan nahi — asli log jald aa rahe hain." / "This is a character, not a real person. Real people
  are coming soon." There is no message button.
- **Cast:** fictional, with every line original. 2–3 per district. Assign them in Task 12 for the other
  districts.

  | Character | Status line | District |
  |---|---|---|
  | Kavya, RAS aspirant | "RAS mains ki tayyari. Study partner chahiye." | University |
  | Imran, blue-pottery kaarigar | "Neela rang, Jaipur ka dil." | Walled City |
  | Sunita ji, Bapu Bazaar shopkeeper | "Mojri le lo, ekdum fit aayegi." | MI Road |
  | Aarav, first year at RU | "Pehla saal, sab naya." | University |
  | Meera, poet | "Thursday open mic, JKK. Aaoge?" | University |
  | Raju, auto driver | "Kahan chalna hai, Hukum?" | Walled City |
  | Farhan | "Sunday gully cricket — 8 log chahiye." | Malviya Nagar |
  | Neha, developer | "Code likhti hoon, chai peeti hoon." | Malviya Nagar |
  | Ramesh ji, lassiwala | "Ek lassi, aur saari thakaan gayab." | Walled City |

- [ ] **Step 1: Write the failing tests.**

```ts
it('walks toward the next waypoint and loops', () => {
  const route = [{ x: 0, z: 0 }, { x: 10, z: 0 }]
  const a = stepAlongRoute({ x: 0, z: 0 }, route, 0, 2, 1)
  expect(a.pos).toEqual({ x: 2, z: 0 })
  const b = stepAlongRoute({ x: 9.5, z: 0 }, route, 0, 2, 1)
  expect(b.legIndex).toBe(1) // reached (10,0), now heading back to (0,0)
})
it('every NPC route stays out of colliders', async () => { /* for each district: sample each leg every 0.5 m; no point inside a collider */ })
```

- [ ] **Step 2: Run them to make sure they fail.**
- [ ] **Step 3: Implement.** Reuse `buildAvatar` for the bodies and add an `NPC` marker so they are
  visually distinct from future real players: a small ✦ badge on the bubble.
- [ ] **Step 4: Run the tests and make sure they pass.**
- [ ] **Step 5: Commit.** `feat(web): seed characters who walk the city and say they're not real`

---

### Task 12: The other three districts and metro travel

**Files:**
- Create: `frontend/src/world/districts/{miRoad.ts,university.ts,malviyaNagar.ts}`,
  `src/world/landmarks/{albertHall.ts,ramNiwasGate.ts,universityGate.ts,jkk.ts,wtp.ts}`, `src/ui/TravelSheet.tsx`
- Modify: `frontend/src/world/district.ts` (the `DISTRICTS` table), `src/world/district.test.ts`, `src/App.tsx`

**Interfaces:**
- Consumes: `loadDistrict`, `District.dispose()`.
- Produces: `travelTo(id: DistrictId): Promise<void>` in `App`. It fades to black, disposes the old
  district, loads the new one and spawns at its `station`. The last district is persisted under
  `gg-district`, and the city reopens there.
- **Districts:** each is 200 × 200 m.

  | District | Hinglish name | Landmarks and layout | Feel |
  |---|---|---|---|
  | **MI Road** | "MI Road–Raja Park" | Albert Hall (Indo-Saracenic, domes and arches) set in Ram Niwas Bagh with its gate; a long shop-lined MI Road | ochre and sandstone more than pink, with cafés |
  | **University** | "University–JKK" | the Rajasthan University gate on JLN Marg, and Jawahar Kala Kendra (a geometric courtyard with a central kund) | green campus |
  | **Malviya Nagar** | "Malviya Nagar–WTP" | World Trade Park (a modern glass mall with a curved roof) | coaching centres, modern blocks |

  9 landmarks in total, which matches the HUD's `N/9`.
- **Metro:** the `TravelSheet` opens when the player is within 4 m of the `station` prop (on a phone, a
  "Metro" button appears, and on desktop E opens it). It lists the other three districts. There is no ride
  animation in this phase, since that's phase 4.

- [ ] **Step 1: Write the failing tests.** Add the three ids to `DISTRICTS` in `district.test.ts`, so the
  existing `it.each` tests now cover them. Add `landmark count across districts is 9`.

  E2E: `travels by metro`:
  1. Teleport to the station.
  2. Tap `Metro`, then `MI Road–Raja Park`.
  3. Expect `__gg.district()` to be `'mi-road'` and the HUD to show it.
  4. Reload and re-enter, and expect it to still be `mi-road`.
- [ ] **Step 2: Run them to make sure they fail.**
- [ ] **Step 3: Implement** the three district files, the five landmark models and `TravelSheet`.
- [ ] **Step 4: Run the tests and make sure they pass.** Also run `npm run build` and confirm there are 4
  district chunks, each under 150 kB gzipped.
- [ ] **Step 5: Commit.** `feat(web): MI Road, University and Malviya Nagar districts with metro travel`

---

### Task 13: Phone performance pass, docs, go-live wiring

**Files:**
- Create: `frontend/tests/device-perf.spec.ts`, `docs/{architecture.md,deployment.md,device-performance.md}`
- Modify: `backend/wrangler.jsonc` (custom domain), anything the perf numbers point at

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Port the perf spec.** Port `games/frontend/tests/device-perf.spec.ts` (Pixel 7 emulation,
  6× CPU slowdown, Fast 4G). For the walled city it measures:
  - **load:** FCP, LCP, and time to the first walkable frame. The "walkable" moment is when
    `window.__gg.position` exists and one frame has rendered after the district loaded.
  - **frames:** walking 8 s along the bazaar
  - **quality tier**
  - **heap**

  It writes to `test-results/device-perf.json`.
- [ ] **Step 2: Run it and record the numbers.** Run `npm run test:device`. The targets, to record in
  `docs/device-performance.md`:

  | Measure | Target |
  |---|---|
  | first walkable frame | ≤ 5 s |
  | frame interval p50 | ≤ 33 ms |
  | frames over 33 ms | under 10% |
  | quality tier after 8 s | stays ≥ 1 |
  | heap | < 150 MB |
  | initial JS, excluding the `three` chunk | ≤ 250 kB gzipped |

  If a number misses, fix the cause (draw calls, overdraw, particle counts, shadow map size) and re-run.
  Note each fix in the doc.
- [ ] **Step 3: Real-phone check.** Add the real-device checklist to `docs/device-performance.md` (adapted
  from `games`) and include a row for **opening the link from an Instagram DM on Android**: the canvas
  shows, the joystick works and nothing scrolls the page.
- [ ] **Step 4: Go-live wiring.**
  - Add `routes: [{ pattern: "api.gulabi-gali.manishbisht.me", custom_domain: true }]` to `wrangler.jsonc`.
    This needs the `manishbisht.me` zone on Cloudflare. If it isn't there, `deployment.md` says to use the
    `workers.dev` URL as `VITE_API_BASE_URL` until it is moved.
  - `deployment.md` lists:
    - the GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `VITE_API_BASE_URL`
      in the `github-pages` environment
    - `wrangler kv namespace create CITY`
    - the Pages custom domain `gulabi-gali.manishbisht.me` (CNAME to `<user>.github.io`)
    - Cloudflare budget alerts
- [ ] **Step 5: Architecture doc.** Write `docs/architecture.md` in the style of `games`: the packages
  table, a mermaid diagram (browser ↔ `/api/city` ← cron ← Open-Meteo), how districts stream, the test
  hooks, and the protocol-copy rule.
- [ ] **Step 6: Final check.** Run `npm run lint && npm test && (cd frontend && npx playwright test)`.
  Expected: all green.
- [ ] **Step 7: Commit.** `docs: architecture, deployment and phone performance for phase 1`

---

## After this plan

Phases 2 (seeing and meeting: district Durable Objects, presence, benches, profiles, requests, chat) and 3
(accounts and safety: Clerk email-code sign-in, tiers, invite codes, reports with evidence, word filter,
rate limits, admin page, cap and waitlist) each get their own plan, written once phase 1 is merged. The
public launch waits for phase 3.
