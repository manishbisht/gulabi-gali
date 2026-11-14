# Gulabi Gali, Phase 2: Seeing and Meeting (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** People who sign in and finish a profile become visible in the live city. Anyone (even a ghost) sees
them move in real time. Residents can tap each other, sit together at a tapri bench and talk, send a "milna
hai" request with a reason, and chat one-to-one once it's accepted.

**Architecture:**

- **One `DistrictDO` per district.** It is a Durable Object using the WebSocket Hibernation API. It holds
  who is in that district, relays positions about 10 times a second to people within 60 m, and carries
  bench chat. Bench chat lives only in memory and is never written to storage.
- **One `InboxDO` per signed-in user.** It pushes notices (new request, accepted, new message) to that
  user's open tabs.
- **D1 holds the durable records:** users, profiles, requests, matches and messages.
- **Identity:** Clerk session JWTs verified in the Worker. A `DEV_AUTH` path signs local and e2e users in
  without Clerk keys.
- **Frontend:** a session layer opens the district socket and renders remote people as avatars, with
  interpolation. React panels cover the profile, person card, bench chat, connections and chat.

**Tech Stack:** As in phase 1, plus `@clerk/react` and `@clerk/backend`, Cloudflare D1 and Durable
Objects (SQLite-backed, hibernatable WebSockets).

**Spec:** `docs/superpowers/specs/2026-11-14-gulabi-gali-design.md`

**Builds on:** phase 1, `docs/superpowers/plans/2026-11-14-phase-1-walkable-city.md`.

**Reference repo (read-only):** `/Users/manishbisht/Desktop/Personal Projects/games`. Copy patterns from:

- Clerk verification: `backend/src/auth.ts`, its `cleanName` and its tests using `signJwt`.
- Durable Object rooms: `backend/src/room.ts`, `presence.ts` and `limits.ts`.
- Frontend Clerk wiring: `frontend/src/online/clerkAuth.tsx`, `identity.tsx` and `session.ts`.

## Global Constraints

Everything in phase 1's Global Constraints still holds, including:

- workspaces `frontend` + `backend` only, with no `shared/`
- byte-identical `protocol.ts` copies
- the Prettier config
- Node 24 via `export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH";`
- `gg-` storage only via `storage.ts`
- bilingual strings
- phones first
- IST
- wrangler `compatibility_date` `"2026-08-01"`

Origins:

| Use | Origin |
|---|---|
| Site | `https://gulabi-gali.manishbisht.me` |
| API | `https://api.gulabi-gali.manishbisht.me` |
| Dev site | `http://127.0.0.1:5173`, `http://localhost:5173` |
| Dev API | `http://127.0.0.1:8787` |

- **Tiers in this phase:**
  - **Ghost:** no token, or a token without a complete profile. A ghost receives the city but is never
    broadcast.
  - **Resident:** a token plus a complete profile. A profile is complete when name, look, homeArea,
    `adult: true` and `pledge: true` are all set. Residents are broadcast.

  The verified tier comes in phase 3. Until then any resident may send requests.
- **What a ghost may see of a resident:** avatar `look`, first name and status line. Nothing else ever goes
  down an unauthenticated socket or response. The full profile needs a valid token: homeArea, hereFor,
  about, stamps, and a link that is shown to verified viewers only in phase 3, so nobody sees it in this
  phase.
- **Never store:** bench chat goes to no database. Precise real-world location is never collected.
- **Request reason:** 10–140 characters.

| Field | Limit |
|---|---|
| Name | `cleanName`, 2–24 code points |
| Status | ≤ 80 characters |
| About | ≤ 200 characters |
| Chat message | ≤ 500 characters |
| Bench line | ≤ 200 characters |

- **Requests:** a request not answered within 14 days disappears. A decline is never shown to the sender.
  Unmatching deletes the chat for both people.
- **Positions:** clients send at most 10 `move` messages a second. The server rejects any step faster than
  8 m/s, measured from the last accepted point, by resetting that client to the last good point. It
  relays only to sockets within 60 m, batched every 100 ms.
- **Placeholder IDs:** the D1 database and KV ids are placeholders (`REPLACE_WITH_*`). Never create cloud
  resources.
- **DEV_AUTH:** when the backend has `DEV_AUTH=1` (in `.dev.vars` and in the vitest/playwright config only,
  never in `wrangler.jsonc` vars), `POST /api/dev/login {name}` returns a dev token. The frontend shows
  "Dev login" only when `import.meta.env.VITE_DEV_AUTH === '1'`. Production builds never set it, and a
  test asserts that the Worker rejects dev tokens when `DEV_AUTH` is unset.

## Review Focus

1. **A socket drops** (Instagram backgrounded, a train through a tunnel). The client reconnects with
   backoff (1, 2, 4, then 8 s, capped at 15 s). The server times out a dead socket and broadcasts `leave`
   within 30 s, so nobody stays visible frozen in place. Tests: Task 5 (`drops a silent socket and
   broadcasts leave`) and Task 6 (`reconnects after the socket closes`).
2. **The same user in two tabs or two districts.** Only one avatar shows per user per district, the newest
   socket wins, and switching districts removes the old presence. Test: Task 5 (`a second socket for the
   same user replaces the first`).
3. **A ghost tries to act:** sit, say, send a request or fetch a full profile. The server refuses with a
   typed error, and the UI explains "pehle dikhna padega" with a sign-in CTA. Tests: Tasks 5, 8 and 9.
4. **Hostile input:** oversize or garbage socket frames, bidi or zero-width names, an HTML or JS link, NaN
   coordinates. All are rejected or cleaned, never echoed. Tests: Tasks 2 and 5.
5. **Requests at the edges:** a request to yourself, a duplicate, a request to a paused user, accepting an
   expired request, or both people requesting each other at once. Each gives one clear outcome, and two
   crossed requests become one match. Test: Task 9.

---

## File Structure (new or changed)

```
backend/
  migrations/0001_people.sql        users, profiles, requests, matches, messages
  src/auth.ts                       resolveUser(): Clerk JWT or DEV_AUTH token → { id } | null
  src/names.ts                      cleanName (ported from games)
  src/profiles.ts                   GET/PUT /api/me, GET /api/profiles/:id
  src/district.ts                   DistrictDO: presence, moves, benches
  src/requests.ts                   request endpoints + expiry
  src/inbox.ts                      InboxDO + notify()
  src/chat.ts                       matches + messages endpoints
  src/protocol.ts                   + live and REST types (copied to the frontend)
frontend/
  src/world/session.ts              city session: district, player, npcs, fx, travel (extracted from App)
  src/auth/                         AuthProvider (Clerk | dev | none), useAuth, InAppHint
  src/profile/                      ProfileSheet, AvatarBuilder, homeAreas.ts, useMe
  src/net/live.ts                   district socket client (reconnect, send throttle)
  src/net/inbox.ts                  inbox socket client
  src/world/people.ts               remote avatars + interpolation + labels
  src/ui/PersonCard.tsx  BenchChat.tsx  Connections.tsx  ChatView.tsx  VisibilityChip.tsx
  tests/people.spec.ts  tests/meeting.spec.ts  tests/support/people.ts
```

---

### Task 0: Foundations from the phase-1 review

**Files:**
- Modify: `frontend/src/player/avatar.ts`, `frontend/src/player/avatar.test.ts`, `frontend/src/testHooks.ts`,
  `frontend/playwright.config.ts`, `frontend/vite.config.ts`, `frontend/src/engine/stage.ts`,
  `frontend/src/world/npcs.ts`, `frontend/tests/city.spec.ts`

**Interfaces and requirements:**
- **Avatars:** `buildAvatar(look)` returns ONE merged, vertex-coloured mesh. Reuse the kit's `bake`/`merge`
  helpers and keep the < 600 triangle budget. Geometry is cached per look key, so identical looks share
  geometry, and one shared material is used. `buildAvatar(look, { castShadow })` defaults to `true` for
  the local player and `false` elsewhere. Test: `an avatar is a single draw call` and `two identical looks
  share geometry`.
- **Test hooks:** gated at BUILD time. `installTestHooks` is a no-op unless
  `import.meta.env.VITE_TEST_HOOKS === '1'`, checked statically so production tree-shakes the hook bodies.
  `playwright.config.ts`'s build command sets `VITE_TEST_HOOKS=1`. Test: a production build (no flag)
  doesn't contain the string `__gg`. Check this by grepping `dist/assets/*.js` in a small node test or a
  CI step.
- **NPC freezing:** add `freezeNpcs(on: boolean)` to `GgTestApi`, so walkers pause, and use it in the NPC
  e2e tests to remove the timing race.
- **Stage:** `stage.dispose()` calls `renderer.forceContextLoss()` after removing listeners.
- **Live city:** `useLiveCity` keeps the last live snapshot over a stale refresh only while that snapshot's
  `fetchedAt` is less than 3 h old. Older than that, it takes the stale reply. Test: `a live snapshot
  older than 3 h yields to a stale refresh`.
- [ ] Steps: write the failing tests, implement, run lint, the unit tests and Playwright, then commit with
  `perf(web): one draw call per avatar; test hooks out of production`.

---

### Task 1: Extract the city session from App

**Files:**
- Create: `frontend/src/world/session.ts`, `frontend/src/world/session.test.ts`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces:
  - `createCitySession(opts: { stage: Stage; controls: Controls; canvas: HTMLCanvasElement; bubbleHost: HTMLElement; hooks: SessionHooks }): CitySession`
  - `interface CitySession { district(): District | null; player(): Player | null; travelTo(id: DistrictId): Promise<void>; onEnter(cb: (d: District) => void): () => void; onLeave(cb: (d: District) => void): () => void; onFrame(cb: (dt: number, pos: Vec2) => void): () => void; dispose(): void }`
- `SessionHooks` carries the callbacks that App's effect currently wires inline: stamps `track`, NPC card
  `step`/`tap`, sky repaint, place label and test hooks.
- After this task, `App.tsx` keeps only React state and JSX, plus one effect that creates and disposes the
  session. Later phases attach multiplayer through `onEnter`/`onLeave`/`onFrame` instead of editing App.
- Per-district wiring is a list of systems: `type DistrictSystem = { update?(dt, pos): void; dispose(): void }`.
  Systems are created on enter and disposed in reverse order on leave. Nothing per-frame is inlined in the
  session.
- Identity and profile state reach the session through getters (`opts.me(): Me | null`), never through
  React deps, so a sign-in never re-runs the stage effect.
- Test hooks are installed from the session.
- Keep the phase-1 rule for failed loads: load the new district first, keep the old one running if loading
  fails, and keep the round-trip leak test green.

- [ ] **Step 1:** Write `session.test.ts` with stubbed stage, district and loader modules (`vi.mock`):
  - `enter then travel disposes the first district before the second's onEnter`
  - `dispose during a pending load disposes the late district`
  - `onFrame listeners get the player position`
- [ ] **Step 2:** Run `npm run test -w frontend -- session` and expect FAIL.
- [ ] **Step 3:** Move the district, player, NPC, fx, travel and tap wiring out of `App.tsx` into
  `session.ts` with no behaviour change.
- [ ] **Step 4:** Run the full unit suite and `cd frontend && npx playwright test`. Expected: every phase-1
  spec still passes, unchanged.
- [ ] **Step 5:** Commit: `refactor(web): city session owns the world lifecycle`

---

### Task 2: D1 schema, identity and profiles API

**Files:**
- Create: `backend/migrations/0001_people.sql`, `backend/src/{auth.ts,names.ts,profiles.ts}`,
  `backend/test/{auth.test.ts,profiles.test.ts,names.test.ts}`, `backend/.dev.vars.example`
- Modify: `backend/wrangler.jsonc`, `backend/src/{env.ts,index.ts,protocol.ts}`, `backend/vitest.config.ts`,
  `backend/package.json` (add `@clerk/backend`), and the frontend protocol copy

**Interfaces:**
- `wrangler.jsonc`:
  - `d1_databases: [{ binding: "DB", database_name: "gulabi-gali", database_id: "REPLACE_WITH_D1_ID", migrations_dir: "migrations" }]`
  - `vars` gains nothing auth-related
- `Env`: add `DB: D1Database`, `CLERK_SECRET_KEY?`, `CLERK_JWT_KEY?`, `DEV_AUTH?: string` and
  `DEV_AUTH_SECRET?: string`.
- Schema:

```sql
CREATE TABLE users (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, banned INTEGER NOT NULL DEFAULT 0);
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, look TEXT NOT NULL, home_area TEXT NOT NULL, status TEXT NOT NULL DEFAULT '',
  here_for TEXT, about TEXT NOT NULL DEFAULT '', link TEXT, adult INTEGER NOT NULL, pledge INTEGER NOT NULL,
  pause_requests INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE TABLE requests (
  id TEXT PRIMARY KEY, from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, reason TEXT NOT NULL,
  created_at INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending','accepted','ignored')));
CREATE UNIQUE INDEX requests_pair ON requests(from_id, to_id) WHERE state = 'pending';
CREATE TABLE matches (id TEXT PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE (a, b)); -- a < b
CREATE TABLE messages (id TEXT PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX messages_match ON messages(match_id, created_at);
```

- Protocol additions:
  - `HomeArea`: the list in Task 4. The backend validates against the same list, which lives in
    `protocol.ts` as `HOME_AREAS`.
  - `HereFor = 'friends' | 'study' | 'work' | 'art'`
  - `PublicPerson = { id: string; name: string; look: AvatarLookWire; status: string }`
  - `FullProfile = PublicPerson & { homeArea: HomeArea; hereFor: HereFor | null; about: string; pauseRequests: boolean }`
  - `Me = { id: string; profile: FullProfile | null; complete: boolean }`
  - `AvatarLookWire` mirrors `AvatarLook` with string unions.
- Functions:
  - `resolveUser(request: Request, env: Env, verify?: Verifier): Promise<{ id: string } | null>`. It takes
    `Authorization: Bearer <token>` or a `?token=` query param (for WebSocket upgrades). Clerk tokens give
    `{ id: 'clerk:' + sub }`. Dev tokens give `{ id: 'dev:' + slug }`, and are accepted only when
    `env.DEV_AUTH === '1'`.
  - `POST /api/dev/login {name}` (DEV_AUTH only) returns `{ token }`. The token is
    `dev.<slug>.<hmac(DEV_AUTH_SECRET ?? 'dev-only', slug)>`.
  - `cleanName(x: unknown): string | null`, ported from games, plus a 2-code-point minimum.
  - `GET /api/me` returns `Me`, upserting the `users` row.
  - `PUT /api/me/profile` takes a `FullProfile`-shaped body plus `adult` and `pledge`, plus an optional
    `link`. It answers 200 with `Me`, or 400 with `{ error: 'invalid', fields: string[] }`.
  - `GET /api/profiles/:id` returns `FullProfile` for a signed-in caller, 401 otherwise, and 404 when the
    profile is incomplete or the user is banned.
- **Link rule:** `https://` URLs only, at most 200 characters, with no credentials in the URL. The link is
  stored but not returned in phase 2.

- [ ] **Step 1: Write the failing tests.**
  - `auth.test.ts`:
    - `accepts a Clerk token signed with CLERK_JWT_KEY`, minting one with `signJwt` and a test key pair, as
      in `games/backend/test/auth.test.ts`
    - `rejects an expired token`
    - `dev tokens work only with DEV_AUTH=1`
    - `a tampered dev token is rejected`
  - `names.test.ts`: port the games `cleanName` cases, plus `rejects one-character names`.
  - `profiles.test.ts`:
    - `PUT then GET /api/me round-trips and marks complete`
    - `incomplete without adult or pledge`
    - `rejects a javascript: link and a 300-char about with field names`
    - `GET /api/profiles/:id is 401 without a token`
    - `a ghost-safe PublicPerson never includes homeArea/about/link`, which checks the
      `toPublic(profile)` helper
- [ ] **Step 2:** Run `npm run test -w backend` and expect FAIL.
- [ ] **Step 3:** Implement. Apply migrations in tests with `applyD1Migrations` from `cloudflare:test`
  (`readD1Migrations` in `vitest.config.ts`). Set `DEV_AUTH: '1'` and `DEV_AUTH_SECRET` only in the vitest
  miniflare bindings and `.dev.vars.example`.
- [ ] **Step 4:** Run `npm run check:protocol && npm run test -w backend && npm run typecheck -w backend`
  and expect PASS.
- [ ] **Step 5:** Commit: `feat(api): identity, D1 schema and profiles`

---

### Task 3: Frontend sign-in (Clerk, dev, or none)

**Files:**
- Create: `frontend/src/auth/{AuthProvider.tsx,useAuth.ts,clerk.tsx,dev.tsx,InAppHint.tsx,inApp.ts,auth.test.tsx}`
- Modify: `frontend/src/main.tsx`, `frontend/package.json` (add `@clerk/react`),
  `frontend/vite.config.ts` (restore the Clerk CSP parts from games when `VITE_CLERK_PUBLISHABLE_KEY` is
  set), `frontend/playwright.config.ts`, `src/i18n/strings.ts`

**Interfaces:**
- `useAuth(): { mode: 'clerk' | 'dev' | 'none'; signedIn: boolean; token(): Promise<string | null>; openSignIn(): void; signOut(): Promise<void> }`
- **Mode precedence:** `clerk` when `VITE_CLERK_PUBLISHABLE_KEY` is set, else `dev` when
  `VITE_DEV_AUTH === '1'`, else `none`. In `none` mode the sign-in button is hidden and everyone is a ghost.
- **Clerk mode:** email code is the primary method, and Google is shown only when `!isInAppBrowser()`.
- `isInAppBrowser(ua = navigator.userAgent): boolean` detects Instagram, FBAN/FBAV, Line and wv.
- `<InAppHint/>`: inside an in-app browser, a dismissible line, "Google se login ke liye Chrome mein
  kholo" / "To sign in with Google, open this in Chrome". It is shown only on the sign-in sheet.
- **Dev mode:** a name field. It calls `POST /api/dev/login` and keeps the token in sessionStorage under
  `gg-dev-token`, via try/catch.
- `playwright.config.ts`:
  - the backend webServer runs with `DEV_AUTH=1` (wrangler `--var DEV_AUTH:1`)
  - the frontend build gets `VITE_DEV_AUTH=1`
  - the env names are kept in one place

- [ ] **Step 1:** Write the tests:
  - `isInAppBrowser detects Instagram Android and iOS UAs and not Chrome`
  - `mode precedence clerk > dev > none` (stub `import.meta.env`)
  - `dev sign-in stores the token and token() returns it`
  - `signOut clears it`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement. The HUD gets a sign-in button, "Dikhna hai? Login karo" / "Want to be seen?
  Sign in", which shows only when signed out and the mode isn't `none`.
- [ ] **Step 4:** Run the unit tests, lint and build. Expected: PASS. Then build once with
  `VITE_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS5jb20k` and check that the CSP in `dist/index.html`
  names `clerk.example.com`.
- [ ] **Step 5:** Commit: `feat(web): sign-in with Clerk, a dev path for local and tests`

---

### Task 4: Profile sheet, avatar builder, visibility chip

**Files:**
- Create: `frontend/src/profile/{ProfileSheet.tsx,AvatarBuilder.tsx,homeAreas.ts,useMe.ts,profile.test.tsx}`,
  `frontend/src/ui/VisibilityChip.tsx`, `frontend/tests/profile.spec.ts`
- Modify: `frontend/src/net/api.ts` (`getMe`, `putProfile`, `getProfile`), `src/player/avatar.ts`
  (look ↔ wire), `src/i18n/strings.ts`, `src/ui/Hud.tsx`

**Interfaces:**
- `HOME_AREAS` comes from `protocol.ts`. It is a list of neighbourhood names, never precise locations:
  - Walled City, C-Scheme, Raja Park, Bani Park, Civil Lines, Vaishali Nagar, Mansarovar, Malviya Nagar,
    Jagatpura, Tonk Road, Sanganer, Sodala, Shyam Nagar, Jhotwara, Vidhyadhar Nagar, Adarsh Nagar,
    Pratap Nagar, Sitapura, Amer, JLN Marg, Durgapura
  - "Jaipur ke bahar" / "Outside Jaipur"
- `useMe(): { me: Me | null; refresh(): Promise<void>; save(p: ProfileInput): Promise<{ ok: true } | { ok: false; fields: string[] }> }`
- **ProfileSheet:** it opens automatically after the first sign-in when `!me.complete`. Fields:
  - name
  - avatar builder: skin, outfit and head, with a live 3D preview reusing `buildAvatar` on a small canvas,
    or a 2D swatch preview at tier 0
  - home area
  - status, with placeholder "Kis baare mein baat karni hai?"
  - "here for" chips: optional
  - about
  - "Main 18 saal ya usse bada/badi hoon"
  - the pledge: "Sab ki izzat karunga/karungi. Koi harassment, hate ya spam nahi." /
    "I'll treat everyone with respect. No harassment, hate or spam."

  Save stays disabled until name, area, adult and pledge are set. The pledge copy is original; don't
  reword it into anything from peopleofdelhi.com.
- **VisibilityChip** shows one of:
  - **ghost:** "Abhi koi tumhe dekh nahi sakta" / "Nobody can see you yet", with a CTA
  - **resident:** "Jaipur tumhe dekh sakta hai" / "Jaipur can see you"
- The player's own avatar switches to the saved look on save.

- [ ] **Step 1:** Write the tests:
  - `save is disabled until required fields and both checkboxes`
  - `server field errors highlight those fields`
  - `look round-trips wire format`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Write the e2e `profile.spec.ts`. Dev-login as "Asha", fill the sheet, save, and expect the
  chip to read "Jaipur tumhe dekh sakta hai". Reload, and expect the sheet not to reopen.
- [ ] **Step 5:** Run the unit tests, then `npx playwright test`. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(web): profile sheet, avatar builder and visibility`

---

### Task 5: DistrictDO: live presence and movement

**Files:**
- Create: `backend/src/district.ts`, `backend/test/district.test.ts`, `backend/test/helpers.ts`
  (a socket helper, modelled on the games test helpers)
- Modify: `backend/wrangler.jsonc`, `backend/src/{index.ts,env.ts,protocol.ts}`, and the frontend
  protocol copy

**Interfaces:**
- `wrangler.jsonc`:
  - `durable_objects.bindings: [{ name: "DISTRICT", class_name: "DistrictDO" }]`
  - `migrations: [{ tag: "v1", new_sqlite_classes: ["DistrictDO"] }]`
- Route: `GET /api/districts/:id/live` (Upgrade) with an optional `?token=`.
  1. The Worker resolves the user.
  2. If the user is a resident, it loads their `PublicPerson`.
  3. It forwards to `env.DISTRICT.idFromName(id)` via `stub.fetch` with the header
     `X-GG-Who: JSON.stringify({ userId | null, person | null })`. The DO trusts this header because DOs
     aren't publicly addressable. The Worker always strips any client-sent `X-GG-Who` before resolving
     the user, and a test covers that.

  Unknown district ids get a 404.
- Wire types:

```ts
export type ClientMsg =
  | { t: 'move'; x: number; z: number; ry: number }
  | { t: 'sit'; bench: string | null }
  | { t: 'say'; text: string }
  | { t: 'status'; text: string }
  | { t: 'ping' }
export type ServerMsg =
  | { t: 'welcome'; you: { id: string | null; visible: boolean }; people: LivePerson[] }
  | { t: 'join'; p: LivePerson }
  | { t: 'leave'; id: string }
  | { t: 'moves'; m: [id: string, x: number, z: number, ry: number][] }
  | { t: 'status'; id: string; text: string }
  | { t: 'bench'; bench: string; from: string; name: string; text: string; at: number }
  | { t: 'seated'; bench: string | null; with: string[] }
  | { t: 'error'; code: 'ghost' | 'invalid' | 'full' | 'too-fast' | 'rate' }
  | { t: 'pong' }
export type LivePerson = PublicPerson & { x: number; z: number; ry: number }
```

- **DistrictDO behaviour:**
  - It uses `ctx.acceptWebSocket` (hibernation), with per-socket attachments.
  - **Ghost sockets** receive `welcome`, `join`, `leave`, `moves` and `status`. They never appear in
    anyone's list. Their `sit`, `say` and `status` get `error: 'ghost'`.
  - **Resident sockets** are broadcast on their first `move`.
  - **Same user:** a second socket for the same user closes the first with code 4001 ("replaced").
  - **Moves:** the latest move per user is coalesced. Every 100 ms (an alarm, or a timer while awake), each
    socket gets one `moves` frame with the people within 60 m of it.
  - **Speed check:** a move over 8 m/s since the last accepted point is answered with `error: 'too-fast'`
    and the client's last good point.
  - **Bad frames:** non-JSON, over 2 KB, unknown types or non-finite numbers get `error: 'invalid'`, and the
    socket closes after 5 of them.
  - **Dead sockets:** with no `move` or `ping` for 30 s, the socket is closed and `leave` is sent.
  - **Status:** `status` updates broadcast and are written through to `profiles.status` with
    `waitUntil`.
- Bench messages are only stubbed in this task (`error: 'invalid'`). Task 8 fills them in.

- [ ] **Step 1:** Write the failing tests in `district.test.ts`, using `SELF.fetch` with
  `Upgrade: websocket` and `resp.webSocket.accept()`:
  - `a ghost gets welcome but is never listed`
  - `a resident appears to others after the first move and leaves on close`
  - `moves are only relayed within 60 m`
  - `a too-fast move is refused with the last good point`
  - `a ghost cannot status/sit/say`
  - `invalid frames are refused and the socket closes after five`
  - `a second socket for the same user replaces the first`
  - `drops a silent socket and broadcasts leave`, using a test-only `DistrictDO.prototype.sweep(now)` call
    with an injected clock instead of real waiting
  - `unknown district id is 404`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run check:protocol && npm run test -w backend && npm run typecheck -w backend` and
  expect PASS.
- [ ] **Step 5:** Commit: `feat(api): live district presence over hibernating sockets`

---

### Task 6: Live client and remote people

**Files:**
- Create: `frontend/src/net/live.ts`, `frontend/src/net/live.test.ts`, `frontend/src/world/people.ts`,
  `frontend/src/world/people.test.ts`, `frontend/tests/people.spec.ts`, `frontend/tests/support/people.ts`
- Modify: `frontend/src/world/session.ts` (attach on enter, detach on leave), `src/testHooks.ts`

**Interfaces:**
- `connectLive(opts: { district: DistrictId; token: () => Promise<string | null>; onMsg: (m: ServerMsg) => void; WebSocketImpl?: typeof WebSocket }): LiveConn`
  - `interface LiveConn { send(m: ClientMsg): void; close(): void; state(): 'connecting' | 'open' | 'closed' }`
  - It reconnects with a 1/2/4/8 s backoff, capped at 15 s, and resets after 30 s connected.
  - `move` sends are throttled to 10 Hz, and only sent when the position changed by more than 5 cm or the
    rotation by more than 2°.
  - It pings every 10 s while idle.
- `createPeople(scene: THREE.Object3D): People`, where
  `interface People { apply(m: ServerMsg): void; update(dt: number): void; pick(ray: THREE.Raycaster): LivePerson | null; list(): LivePerson[]; dispose(): void }`.
  - Avatars are built with `buildAvatar(look)`.
  - Positions are interpolated toward the latest target with a time constant of 120 ms, never
    overshooting.
  - Name and status labels are reused through `npcBubbles`-style pooled DOM, without the ✦ badge.
  - Remote people are drawn without shadows at tier ≤ 1.
- Test hooks: `people(): { id: string; x: number; z: number; sx: number; sy: number }[]` and
  `liveState()`.
- Playwright helper `twoPeople(browser)` opens two contexts, dev-logs both in, completes both profiles,
  and returns the two pages.

- [ ] **Step 1:** Write the unit tests with a fake WebSocket:
  - `reconnects after the socket closes with growing delays`
  - `throttles moves to 10 Hz and skips tiny ones`
  - `people interpolate without overshoot and remove on leave`

  Write the e2e tests:
  - `two residents see each other move`: page A teleports, and page B's `__gg.people()` soon shows A near
    that spot.
  - `a ghost sees residents but residents never see the ghost`.
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement. The session opens the live connection on district enter and closes it on
  leave.
- [ ] **Step 4:** Run the unit tests and `npx playwright test`, and expect PASS. Then run the stress check:
  `scripts/fake-residents.mjs <n> <district>`. It dev-logs in n users, completes their profiles and opens
  n sockets that wander randomly. Use it with `n=60`, running against `wrangler dev` with `DEV_AUTH=1`. Record fps on a Pixel 7 emulation in the report, with a target of at least
  30 fps p50.
- [ ] **Step 5:** Commit: `feat(web): see other people live`

---

### Task 7: Person card

**Files:**
- Create: `frontend/src/ui/PersonCard.tsx`, `frontend/src/world/usePersonCard.ts`,
  `frontend/src/world/usePersonCard.test.tsx`
- Modify: `frontend/src/world/session.ts`, `App.tsx`, `src/net/api.ts`

**Interfaces:**
- Tapping a remote person opens `PersonCard`. On desktop, E opens it for the nearest within 3 m. The card
  priority is landmark > NPC > person, with one card at a time.
- **For a ghost viewer:** the card shows name, status and a CTA, "Milne ke liye pehle dikhna padega" /
  "To meet people, you need to be visible first", which opens sign-in.
- **For a resident viewer:** the card fetches `GET /api/profiles/:id` and shows home area, here-for,
  about and stamps count, plus a **"Milna hai"** button that opens the request composer (Task 9). The
  composer's hint is "Log zyada haan bolte hain jab pata ho kyun" / "People say yes more often when they
  know why", but write it fresh in your own words.

- [ ] **Step 1:** Write the tests:
  - `ghost viewer sees only name/status and a sign-in CTA`
  - `resident viewer loads full profile`
  - `landmark card outranks a person card`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit: `feat(web): tap someone to see who they are`

---

### Task 8: Tapri benches and bench chat

**Files:**
- Modify: `backend/src/district.ts`, `backend/test/district.test.ts`, the protocol copies,
  `frontend/src/world/session.ts`
- Create: `frontend/src/ui/BenchChat.tsx`, `frontend/src/world/benches.ts`, `frontend/src/world/benches.test.ts`,
  `backend/src/benches.json`, `frontend/src/world/benches.json`, `scripts/fake-residents.mjs` (if not created in Task 6)

**Interfaces:**
- **Bench ids** are `${districtId}:${propIndex}` for every `tapri` and `bench` prop. The DO gets the
  valid ids from a small `BENCHES` map in the backend: district id → bench count. Each frontend
  `DistrictDef` must agree with it, and the counts live in `backend/src/benches.json`, which is byte-copied to
  `frontend/src/world/benches.json`. `scripts/check-protocol.mjs` is extended to compare both copies. A
  test in `frontend/src/world/district.test.ts` asserts each district's tapri+bench prop count equals its
  entry in the frontend copy.
- **Server:**
  - `sit` joins a bench of at most 4 seats, else `error: 'full'`, and leaves any previous bench. The DO
    answers `seated { bench, with: names }` to the sitter and updates the others.
  - `say` from a seated resident is broadcast as `bench` to that bench's sitters only. Lines are capped at
    200 characters, and the sender is limited to 1 line a second, else `error: 'rate'`.
  - Each bench keeps an in-memory rolling buffer of `{from, name, text, at}` for the last 10 minutes,
    exposed as `benchTranscript(bench): BenchLine[]` for phase 3 reports. It is never written to storage.
  - Leaving or closing the socket unseats the person.
- **Client:**
  - Within 2.5 m of a bench, a "Baitho" button appears (E on desktop).
  - Sitting snaps the avatar to the seat and opens `BenchChat`, a panel showing the sitters and lines.
    The empty-state copy is fresh and original.
  - "Utho" stands the player up, and walking away does too.
  - A footer line reads "Jo is bench pe baithe hain wahi padh sakte hain. Kuch save nahi hota." / "Only
    people on this bench can read this. Nothing is saved." Phase 3 amends this line for reports.

- [ ] **Step 1:** Write the backend tests:
  - `only sitters receive bench lines`
  - `fifth sitter gets full`
  - `a ghost cannot sit`
  - `transcript keeps only the last 10 minutes` (injected clock)
  - `closing the socket unseats`

  Write the frontend tests: `Baitho appears near a bench and not elsewhere`, and the bench-count parity
  test.
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS. Add the e2e to `meeting.spec.ts`: two residents sit at the
  same tapri, and A's line appears for B.
- [ ] **Step 5:** Commit: `feat: sit at a tapri and talk to whoever's there`

---

### Task 9: Meeting requests

**Files:**
- Create: `backend/src/requests.ts`, `backend/test/requests.test.ts`, `frontend/src/ui/RequestComposer.tsx`
- Modify: `backend/src/index.ts`, the protocol copies, `frontend/src/net/api.ts`

**Interfaces:**
- `POST /api/requests {to, reason}` answers `201 { id }`, or one of these errors:

  | Status | Error |
  |---|---|
  | 400 | `invalid` |
  | 403 | `ghost` |
  | 404 | `no-such-person` |
  | 409 | `already` (a pending request either way, or already matched) |
  | 409 | `paused` |

  If the other person already has a pending request to the sender, the call accepts that request instead
  and answers `200 { matched: matchId }`.
- `GET /api/requests` returns `{ incoming: RequestView[]; sent: RequestView[] }`, where
  `RequestView = { id; person: PublicPerson; reason; createdAt; state }`. Requests older than 14 days are
  excluded, and the sender always sees their own as `pending` until accepted: a decline is never revealed.
- `POST /api/requests/:id/accept` → `{ matchId }`. It works only for the recipient, and only within 14
  days; otherwise it answers 410 `expired`.
- `POST /api/requests/:id/ignore` answers 204. The sender is never told.
- The cron job (the existing 15-minute trigger) also deletes requests older than 14 days.
- The composer validates 10–140 characters with a live counter.

- [ ] **Step 1:** Write the tests:
  - `a resident can request another resident`
  - `cannot request self`
  - `duplicate is 409 already`
  - `paused recipient is 409 paused`
  - `crossed requests become one match`
  - `accept after 14 days is 410`
  - `sender never sees ignored`
  - `ghost is 403`
  - `cron deletes old requests`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit: `feat(api): milna hai requests with reasons`

---

### Task 10: Inbox notices and one-to-one chat

**Files:**
- Create: `backend/src/{inbox.ts,chat.ts}`, `backend/test/{inbox.test.ts,chat.test.ts}`
- Modify: `backend/wrangler.jsonc`, `backend/src/{index.ts,env.ts,requests.ts}`, the protocol copies

**Interfaces:**
- `InboxDO`: one per user, named `inbox:<userId>`, with migration tag `v2` adding `InboxDO`. It is reached
  at `GET /api/inbox` (Upgrade, token required) and holds that user's sockets.
  `notify(userId, n: InboxNotice)` is an internal RPC called by the request and chat handlers, where
  `InboxNotice = { t: 'request'; id } | { t: 'accepted'; matchId; person: PublicPerson } | { t: 'message'; matchId; id } | { t: 'unmatched'; matchId }`.
- Endpoints:
  - `GET /api/matches` returns `{ id; person: PublicPerson; last?: { body; at; mine } }[]`.
  - `GET /api/matches/:id/messages?before=` returns 50 messages, newest last.
  - `POST /api/matches/:id/messages {body}` answers 201. The body is 1–500 characters, and the sender is
    limited to 1 message a second.
  - `DELETE /api/matches/:id` (unmatch) cascades the messages for both people and notifies the other.
  - Only the two members may read or write. Everyone else gets 404, never 403, so a match's existence
    doesn't leak.

- [ ] **Step 1:** Write the tests:
  - `only members can read and write`
  - `unmatch deletes messages for both and notifies`
  - `accept notifies the sender`
  - `message notifies the other member's open inbox socket`
  - `501-char message is 400`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit: `feat(api): inbox notices and one-to-one chat`

---

### Task 11: Connections and chat UI

**Files:**
- Create: `frontend/src/net/inbox.ts`, `frontend/src/ui/{Connections.tsx,ChatView.tsx}`,
  `frontend/src/connections/useConnections.ts`, `frontend/src/connections/connections.test.tsx`,
  `frontend/tests/meeting.spec.ts` (extend)
- Modify: `App.tsx`, `Hud.tsx`, `src/i18n/strings.ts`

**Interfaces:**
- A HUD "Connections" button (C on desktop) shows a badge count of unread incoming requests plus unread
  chats. It opens a sheet with three tabs: **Aaye** (incoming), **Bheje** (sent) and **Baatein** (chats).
- **Incoming:** each request shows its reason, with **Haan** (accept) and **Abhi nahi** (ignore).
  Ignoring removes it quietly.
- **Sent:** shows pending requests with "14 din mein jawab nahi aaya toh apne aap hat jayega" / "Requests
  nobody answers disappear after 14 days".
- **ChatView:** messages, a composer, and "Unmatch" behind a confirm in the sheet itself. Don't use
  `window.confirm`, which is a native dialog.
- `connectInbox` reuses the `connectLive` backoff logic. Factor a tiny `reconnecting(open)` helper in
  `net/` that both clients use.
- Unread state lives in memory, plus a `gg-read` map of matchId → last-read message id.

- [ ] **Step 1:** Write the unit tests: `badge counts unread`, `accept moves request into Baatein`, and
  `unmatch removes the chat`.

  Write the e2e in `meeting.spec.ts`, `request → accept → chat → unmatch`, with two pages and dev auth:
  1. A taps B and sends "Chai pe chalein? JKK open mic ke baad".
  2. B sees the badge and accepts.
  3. Both exchange a message.
  4. A unmatches, and B's chat disappears.
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the unit tests and `npx playwright test`, and expect PASS.
- [ ] **Step 5:** Commit: `feat(web): connections, requests and chat`

---

### Task 12: Docs and phase-2 performance

**Files:**
- Modify: `docs/architecture.md`, `docs/deployment.md`, `docs/device-performance.md`

- [ ] **Step 1:** `architecture.md` gains a diagram of the DistrictDO and InboxDO, the D1 tables, the
  identity flow (Clerk, dev and none) and the tier rules.
- [ ] **Step 2:** `deployment.md` gains:
  - `wrangler d1 create gulabi-gali` and `wrangler d1 migrations apply`
  - the Clerk app setup: email code on, Google on, allowed origin `https://gulabi-gali.manishbisht.me`,
    `CLERK_SECRET_KEY` and `CLERK_JWT_KEY` secrets, and `VITE_CLERK_PUBLISHABLE_KEY` in the
    `github-pages` env
  - a note that `DEV_AUTH` must never be set in production
- [ ] **Step 3:** Run the device-perf spec with 60 fake residents in the Walled City and record the numbers.
- [ ] **Step 4:** Run `npm run lint && npm test && (cd frontend && npx playwright test)` and expect green.
- [ ] **Step 5:** Commit: `docs: phase 2 architecture, setup and performance`
