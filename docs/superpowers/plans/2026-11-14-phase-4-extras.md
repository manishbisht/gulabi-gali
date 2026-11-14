# Gulabi Gali, Phase 4: Deewar and the Extras (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Add the poster walls where people pin plans, and the extras that make wandering fun:

- drivable autos
- metro rides between districts
- street animals that follow you
- Gangaur/Teej processions
- a Sankranti kite-fight minigame
- one playful Jaipur event: the Galta bandar

**Architecture:**

- **Posters:** stored in D1 and served per district. The DistrictDO pushes `poster` add/remove events.
- **Autos:** a vehicle mode on the player, with the auto flag carried on the existing `move` message so
  remote people show up in an auto.
- **Everything else is client-side and deterministic:** animals, processions, the minigame and the bandar.
  These are not synced, so they need no server cost.

**Spec:** `docs/superpowers/specs/2026-11-14-gulabi-gali-design.md`. See "Poster walls" and "Game extras".

**Builds on:** phases 1–3.

## Global Constraints

Everything in the phase 1–3 Global Constraints still holds, plus:

- **Poster rules:**
  - Only **verified** members may pin a poster, with at most 2 live per person.
  - Text is 10–140 characters, plus an optional `when`, a date-time within the next 30 days.
  - Posters pass the word filter and go live immediately.
  - A poster expires at `when + 6 h`, or 7 days after pinning when there is no `when`.
  - Posters can be reported (kind `poster`).
  - Admins can delete posters.
- **Poster safety, carried over from the phase 3 final review:**
  - **Blocks apply to posters in both directions.** People never see a poster from someone they blocked, or from someone who blocked them.
  - **Auto-hide.** A poster is auto-hidden on 3 reports, but only from verified reporters whose accounts are at least 7 days old and whom the owner hasn't blocked. Reports from anyone else still go into the admin queue but don't count toward the hide.
  - **Poster text.** It passes the word filter and the per-account `allow()` limit: 5 posts a day.
  - **Muted and hidden users can't post. Banning someone removes their posters.**
  - **Admin page.** The admin queue groups poster reports with the other reports about the same person.
- **Autos:**
  - 3× walking speed, which is 12 m/s.
  - Arcade handling with the same collision as walking, using a 1.2 m radius.
  - A horn (Space, or a ⤒ button) that plays a short synthesised sound, never auto-played before a user
    gesture.
  - E exits.
  - Remote people in an auto render as an auto.
- **All extras respect the quality tiers.** Animals, procession members and minigame kites are instanced
  and their counts are halved at tier 0. Nothing allocates per frame.
- **The metro ride lasts 5 s or less, and tapping skips it.**
- **The bandar is gentle and opt-out:** a "Bandar band karo" toggle in the menu, and a minimum of 10
  minutes between snatches. It never takes stamps or anything that persists.
- **All new copy** is fresh Hinglish plus English. Nothing is copied from peopleofdelhi.com.

## Review Focus

1. **Getting out of an auto inside a collider or wall.** The exit point is searched on a ring until it's
   clear. Test: Task 2.
2. **A poster pinned with a `when` in the past, or exactly 30 days out.** The past is rejected and the
   boundary is inclusive. Test: Task 1.
3. **Travelling by metro while seated on a bench, or while driving.** The player is unseated and dismounted
   first. Test: Task 3.
4. **The minigame on a slow phone.** Steering inputs are frame-rate independent and the kite count drops at
   tier 0. Test: Task 6.
5. **An animal following you into a metro ride.** It waits at the station and rejoins on return. Test:
   Task 4.

---

### Task 1: Deewar poster walls

**Files:**
- Create: `backend/migrations/0003_posters.sql`, `backend/src/posters.ts`, `backend/test/posters.test.ts`,
  `frontend/src/world/posters.ts` (canvas-texture posters on `poster-wall` props), `frontend/src/ui/PosterComposer.tsx`,
  `frontend/src/ui/PosterCard.tsx`
- Modify: `district.ts` (DO `poster` events), `admin.ts` (implement `DELETE /api/admin/posters/:id`),
  `reports.ts` (kind `poster`), the protocol copies

**Interfaces:**
- Schema: `posters(id, owner, district, wall INTEGER, slot INTEGER, text, at_when INTEGER, created_at, expires_at, hidden INTEGER DEFAULT 0)`.
  Each wall has 6 slots. When a wall is full, the oldest poster on it is replaced.
- Endpoints:
  - `GET /api/districts/:id/posters` is public and returns text, when and owner first name only.
  - `POST /api/posters {district, wall, text, when?}` → 201.
  - `DELETE /api/posters/:id` deletes your own poster.
- **Client:**
  - Within 3 m of a poster wall, "Deewar pe chipkao" opens the composer. Verified members only; others
    see the invite CTA.
  - Tapping a poster opens PosterCard, which shows the text and when, plus Report.
  - The empty-wall copy is fresh: "Is deewar pe abhi koi plan nahi. Pehla tum chipkao?" / "No plans on
    this wall yet. Want to pin the first one?"

- [ ] **Step 1:** Write the tests:
  - `verified can pin, residents cannot`
  - `max 2 live per person`
  - `past when rejected; 30 days inclusive`
  - `expiry hides`
  - `filter applies`
  - `full wall replaces oldest`
  - `public list exposes first name only`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS. Add the e2e: a verified dev user pins a poster, and another
  page sees it on the wall.
- [ ] **Step 5:** Commit: `feat: deewar — pin a plan on the wall`

---

### Task 2: Drivable autos

**Files:**
- Create: `frontend/src/player/vehicle.ts`, `frontend/src/player/vehicle.test.ts`, `frontend/src/audio/horn.ts`
- Modify: `player.ts` (walk ↔ drive modes), `props.ts` (each parked auto is enterable), `net/live.ts` +
  the protocol (`move` gains `v?: 'auto'`), `world/people.ts` (render an auto for remote drivers), the
  HUD (drive controls)

**Interfaces:**
- `createVehicle(kind: 'auto'): Vehicle` with `{ update(input: Vec2, dt): Vec2; exitPoint(colliders: AABB[]): Vec2 }`.
  - The vehicle accelerates to 12 m/s.
  - Steering and turning are frame-rate independent.
  - Reverse works when pulling back.
- Within 2.5 m of a parked auto, "Auto chalao" (E) mounts it. The parked auto instance hides while driven
  and reappears where it was left.
- The horn is a WebAudio synth beep of 0.25 s, created lazily on the first gesture.

- [ ] **Step 1:** Write the tests:
  - `speed caps at 12 m/s`
  - `turning is frame-rate independent` (one step of 0.1 s equals ten of 0.01 s, within tolerance)
  - `exit point avoids colliders`
  - `remote auto flag renders an auto`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS. Add the e2e: mount, drive, exit.
- [ ] **Step 5:** Commit: `feat: drive any parked auto`

---

### Task 3: Metro ride

**Files:**
- Create: `frontend/src/world/metroRide.ts`, `frontend/src/ui/MetroRide.tsx`, `frontend/src/world/metroRide.test.ts`
- Modify: `session.ts` (`travelTo` plays the ride), `TravelSheet`

**Interfaces:**
- `playRide(from: DistrictId, to: DistrictId): { done: Promise<void>; skip(): void }`.
  - It shows a stylised Pink Line coach interior as a lightweight 2D/CSS scene, with no new 3D district
    load.
  - The new district preloads in parallel.
  - It shows the station name in Hinglish and English plus an announcement line in original wording,
    for example "Agla station: Badi Chaupar" / "Next station: Badi Chaupar".
  - It lasts 5 s or less, and tapping skips.
- `travelTo` first unseats the player from a bench and dismounts any auto.

- [ ] **Step 1:** Write the tests:
  - `ride resolves within 5 s and on skip`
  - `travel while seated unseats first`
  - `travel while driving dismounts first`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit: `feat: ride the Pink Line between districts`

---

### Task 4: Street animals

**Files:**
- Create: `frontend/src/world/animals.ts`, `frontend/src/world/animals.test.ts`
- Modify: the district defs (spawn points: dogs, cats and one cow per district), `session.ts`, the HUD
  (a "Saath chalo" prompt)

**Interfaces:**
- `createAnimals(def: DistrictDef, scene): Animals` with `{ update(dt, playerPos); call(nearest within 3 m); sendHome(); following(): AnimalId | null; dispose() }`.
  - Wandering is seeded from the district id.
  - The cow never follows; it just stands in the road and the traffic goes around it.
  - A followed animal trails 1.5 m behind, waits at a station during a metro ride and rejoins on return.
- Animals use low-poly instanced meshes, under 300 triangles each.

- [ ] **Step 1:** Write the tests:
  - `follows at 1.5 m`
  - `cow ignores call`
  - `waits at station during travel and rejoins`
  - `routes clear of colliders`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit: `feat: street dogs, cats and the odd cow`

---

### Task 5: Gangaur and Teej processions

**Files:**
- Create: `frontend/src/live/procession.ts`, `frontend/src/live/procession.test.ts`
- Modify: `festivalFx.ts` (gangaur and teej now get processions as well as banners)

**Interfaces:**
- `createProcession(district: District, kind: 'gangaur' | 'teej', quality): { update(dt); dispose() }`.
  - In the Walled City: a palanquin, drummers and women in lehariya colours, as a loop along Tripolia
    Bazaar to Badi Chaupar.
  - In other districts: a smaller version along the main street.
  - Members are instanced: 40 at tier 2, 20 at tier 1 and 8 at tier 0.
  - Members never block the player and pass through like NPC walkers.

- [ ] **Step 1:** Write the tests: `counts by tier`, `route clear of colliders`, and `gangaur/teej now return
  procession counts > 0` (update the phase-1 test expectations).
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit: `feat: Gangaur and Teej processions`

---

### Task 6: Patang-baazi at Sankranti

**Files:**
- Create: `frontend/src/games/patang.ts`, `frontend/src/games/patang.test.ts`, `frontend/src/ui/Patang.tsx`
- Modify: the HUD (a "Patang udao" button on Sankranti, available on any rooftop-free spot), `festivalFx.ts`
  (it reuses the kite meshes)

**Interfaces:**
- `createPatang(seed: number, quality): { update(input: { pull: boolean; steer: number }, dt): PatangState; dispose() }`.
  - Each round lasts 60 s.
  - The player's kite fights rival kites, 6 at tier 2 and 3 at tier 0.
  - When strings cross for more than 0.6 s while one side is pulling, the other's string is cut, shown
    as "Wo kaata!" in the HUD.
  - The score is the number of cuts. The best score is stored under `gg-patang-best`.
- Touch input: hold to pull, drag to steer. Desktop: Space to pull, A/D to steer.

- [ ] **Step 1:** Write the tests:
  - `crossing for 0.6 s while pulling cuts`
  - `steering frame-rate independent`
  - `rival count by tier`
  - `best score persists via storage`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS. Add the e2e: with `gg-festival=sankranti`, play a round and
  see the score.
- [ ] **Step 5:** Commit: `feat: patang-baazi — wo kaata!`

---

### Task 7: The Galta bandar

**Files:**
- Create: `frontend/src/world/bandar.ts`, `frontend/src/world/bandar.test.ts`
- Modify: `session.ts`, the HUD menu (a "Bandar band karo" toggle, stored under `gg-no-bandar`)

**Interfaces:**
- `createBandar(district, scene, rand): { update(dt, player): BandarEvent | null; dispose() }`.
  - Only in the Walled City, near Jantar Mantar and the bazaar rooftops.
  - At most once per 10 minutes, a monkey drops down and snatches the player's headgear (safa, cap or
    dupatta), changing the look locally only. It then runs along the rooftop edges.
  - Catching up within 2 m gets the headgear back, shown as "Mil gaya! Bandar bhi muskura raha hai." /
    "Got it back! Even the monkey is smiling." After 60 s it gives up and drops the headgear at the
    nearest landmark instead.
  - Nothing persistent is ever taken.
- When `gg-no-bandar` is set, it never triggers.

- [ ] **Step 1:** Write the tests:
  - `never more than once per 10 minutes`
  - `toggle disables`
  - `catching within 2 m returns headgear`
  - `after 60 s headgear drops at the nearest landmark`
  - `only in walled-city`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit: `feat: the Galta bandar wants your safa`

---

### Task 8: Final performance pass and docs

**Files:**
- Modify: `docs/{architecture.md,device-performance.md,deployment.md}`, plus whatever the numbers point at

- [ ] **Step 1:** Run the device-perf spec with every extra active at once in the Walled City: Sankranti
  kites, a procession, 60 fake residents, animals and an auto. The targets from phase 1 still hold. Fix
  regressions and record the numbers.
- [ ] **Step 2:** Update the docs.
- [ ] **Step 3:** Run `npm run lint && npm test && (cd frontend && npx playwright test)` and expect green.
- [ ] **Step 4:** Commit: `docs: phase 4 performance and architecture`
