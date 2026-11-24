# Character, More City, Coming Back — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Let people dress their character (shareable self-expression), add more of Jaipur to explore, and give
reasons to come back (friends with consent, invites to your bench, a daily goal).

**Architecture:** Builds on the live app (React + Three.js frontend; Cloudflare Worker + DistrictDO/InboxDO/GateDO
+ D1, migrations 0001–0008 deployed). Mirrored files (protocol, filter, benches/stamps/taxi json) stay
byte-identical (`scripts/check-protocol.mjs`). Server changes deploy with `wrangler` (migrations by hand) BEFORE the
site; the site deploys by manually dispatching the `pages` workflow.

**Spec:** `docs/superpowers/specs/2026-11-14-gulabi-gali-design.md` + owner choices on 2026-11-24.

## Global Constraints

- Privacy: ghosts, hidden and blocked people are never shown, counted per person, notified about, or reachable;
  friendship never reveals anything a block or hide has taken away.
- Phones first (360×740, Instagram in-app browser); `frontend/tests/hud.spec.ts` bounds hold in every district.
- Bilingual copy (Hinglish default + English) in `frontend/src/i18n/strings.ts`, original, respectful of real places
  and communities; gender-inclusive forms where Hindi verbs are gendered.
- New user text through the word filter; new writes rate-limited with the existing patterns; new schema only in new
  migrations (0009+), never edit 0001–0008.
- No per-frame allocations; dispose on district change; `prefers-reduced-motion`; test hooks only behind `VITE_TEST_HOOKS`.
- Free Workers plan is live: new cron/DO work must fit its per-invocation limits and add little DO awake time.
- Gate: `npm run lint && npm test && VITE_API_URL=https://api.gulabi-gali.manishbisht.me npm run build -w frontend && npm run check:test-hooks && (cd frontend && npx playwright test)`; e2e independent of live weather and wall-clock speed.

## Review Focus

1. A friend list, presence or invite that reveals a ghost, a hidden or a blocked person, or someone who never agreed.
2. Avatar options that are disrespectful, caricatured, or that tie clothing to gender/religion; avatar data that
   bloats presence frames or breaks old clients.
3. A new district/landmark that breaks travel, stamps (count change), Darshan, map, signposts, taxi data, HUD or reachability.
4. Notification spam: invites or daily-goal nudges that can be abused or that nag.
5. Winter/New Year effects that hurt frame rate on low-end phones.

---

### Task 1: Dress your character
- An editor reachable from the profile sheet (and for ghosts, a local-only version): head (safa/turban colour and
  style from a few respectful options, cap, none), dupatta/stole (on/off, colour), upper (kurta/shirt colour),
  skin tone (a broad range), hair (a few styles). Live 3D preview; Save/Cancel.
- Stored on the profile for residents (new migration if needed), validated server-side against the allowed option
  set (no free text), included in the existing presence look so others see it; ghosts keep it in localStorage.
  Old clients that don't know the new fields fall back to today's look.
- The bandar still snatches headgear locally; photo mode shows the look.
- Tests: validation (unknown options rejected), presence carries it compactly, fallback for old payloads, editor
  a11y (labelled radios/swatches, keyboard), 360 screenshot.

### Task 2: Nahargarh district
- A sixth district `nahargarh` on the ridge: the fort walls and a sunset point over the city (a bounded viewpoint
  with a wide view), a winding road, a couple of stalls/benches, NPCs, animals, signposts, a poster wall, taxi
  stands/drops, its own ambience bed, its landmark + stamp (stamps grow; update TOTAL_STAMPS, mirrors, Darshan
  riddle, badge logic, HUD "✓ N" width checks). Reached by bus like Amer (reuse `rideBy`). Every district list
  accepts it; reach.test flood-fill covers it; chunk small.

### Task 3: Jal Mahal and City Palace (after Task 2)
- Jal Mahal: a landmark + stamp on Man Sagar lake, placed in Amer's district (the lake road) or the Walled City
  edge — pick the one that fits the existing layout; water is a collider; a viewpoint from the ghat.
- City Palace: a landmark + stamp inside the Walled City (courtyard gate and Chandra Mahal silhouette), placed
  without breaking existing streets, routes, processions or reachability.
- Stamps grow again; same update list as Task 2.

### Task 4: Winter in the city
- Fog mornings: on winter days (Dec–Feb, IST) before ~10:00 add a light ground fog whose density also follows the
  live AQI/visibility; cheap (scene fog + a few sprites), thinned on quality tier 0, off under reduced motion
  where it animates.
- New Year on MI Road: 31 Dec evening to 1 Jan morning (IST) string lights and a bilingual banner line; uses the
  festival system (add it to the festival calendar data) and its test override.
- Frame-rate check on the device-perf scenario.

### Task 5: Friends and "Chai pe bulao"
- Friends = matched people who both agreed: a "Dost banao" request from an existing match; either side can remove;
  blocking ends it. Migration for the friendship table (0009+).
- A friends list in the profile sheet: shows each friend's first name and "gali mein hai · <district>" ONLY while
  that friend is visible on the street and has a per-person "dosto ko dikhao" setting on (default on, can be off);
  never for ghosts, hidden or blocked; no exact position.
- "Chai pe bulao": while seated, invite a friend to your bench — an inbox notice + push (name-free lock screen:
  "Gulabi Gali: ek dost ne chai pe bulaya") and in-app it shows who and which bench, with a one-tap "Chalo" that
  travels there (reuses travel/place links). Rate-limited (per pair and per user), refused if the friend has
  muted invites, is hidden, blocked or a ghost.
- Tests: consent both ways, removal, block ends it, presence privacy, invite limits, push wording.

### Task 6: Today's Darshan (after Task 3)
- One small daily goal chosen deterministically per IST day from a set (visit a landmark, sit at a tapri, ride the
  bus/metro, greet someone, find the bandar, take a photo…), shown as a compact chip; completing it gives a small
  local reward (a "streak" count and a badge style on the stamps chip). Stored locally for ghosts and on the
  profile for residents (migration if needed). No push nags — at most the welcome screen mentions it.
- Tests: deterministic pick per day/timezone, completion detection per goal type, streak rules, HUD fit.
