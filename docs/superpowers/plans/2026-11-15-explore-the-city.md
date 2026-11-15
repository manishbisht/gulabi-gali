# Explore the City Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Make the live city easy to find your way around, quicker to get around, and worth sharing.

**Architecture:** Client-only features on top of the existing session (`frontend/src/world/session.ts`), HUD
(`frontend/src/ui/Hud.tsx`), district definitions (`frontend/src/world/districts/*`, `world/landmarks/*`) and
stamps (`frontend/src/world/stamps.ts`). Nothing new is broadcast or stored server-side except where a task says
so. Bilingual copy (Hinglish default + English) via `frontend/src/i18n/strings.ts`, original wording.

**Tech stack:** React 19, Three.js, Vitest + happy-dom, Playwright.

**Spec:** owner request in chat, 2026-11-15 ("explore the city better"); the product spec
`docs/superpowers/specs/2026-11-14-gulabi-gali-design.md` (privacy: ghosts are never shown to anyone).

## Global Constraints

- Phones first: every control works with touch at 360×740 and must not crowd the HUD (see `frontend/tests/hud.spec.ts`).
- Privacy: only people already VISIBLE on the street may appear on any map; ghosts, hidden and blocked people never.
- No per-frame allocations; everything disposed on district change; respects `prefers-reduced-motion`.
- Test-only code only behind `VITE_TEST_HOOKS` (`npm run check:test-hooks`).
- Gate: `npm run lint && npm test && VITE_API_URL=https://api.gulabi-gali.manishbisht.me npm run build -w frontend && npm run check:test-hooks && (cd frontend && npx playwright test)`.

## Review Focus

1. A map or compass that shows a ghost, a hidden or a blocked person (privacy leak).
2. New HUD buttons that overlap at 360 px or hide the joystick.
3. Photo share on iOS Safari / Instagram in-app browser where `navigator.share` with files is missing — must fall back to download.
4. Jog or auto-taxi letting the player outrun the server speed check (`too-fast` snaps).
5. Rooftop viewpoint leaving the player stuck in the air or inside a wall.

---

### Task 1: City map + compass
- A "Naksha / Map" HUD button opens a sheet with a top-down map of the current district drawn from its
  definition (streets, blocks, landmarks with stamped/unstamped state, benches, metro station, poster walls,
  you with heading, VISIBLE residents as dots — never ghosts/hidden/blocked).
- Tapping a landmark (or bench/metro) sets a target: a marker pillar in the world at the target and a small
  compass arrow under the HUD with name + distance ("Hawa Mahal · 120 m"); arriving (≤ 6 m) or tapping the
  compass clears it. Default target when none: nothing (no nagging).
- Accessible: the map is a dialog (useDialog), every map item is a button with a name; keyboard M opens it.
- Tests: map renders from a district def; privacy test (ghost/hidden/blocked people absent); compass
  bearing/distance math; e2e: open map, pick Hawa Mahal, compass shows, walk there, it clears.

### Task 2: Photo mode + share
- A camera button enters photo mode: HUD, joystick, bubbles and toasts hide; a frame overlay with a small
  "Gulabi Gali · Jaipur" wordmark; capture renders one frame at device ratio (preserveDrawingBuffer only for
  the capture) to a PNG; share via `navigator.share({files})` when `canShare` allows, else download the file.
  Exit returns everything. Never includes names of other people (hide name labels in photo mode).
- Tests: photo mode hides/restores HUD; capture produces a PNG blob; fallback path when canShare is missing.

### Task 3: Jaipur Darshan list + badge
- The stamps chip opens a list of all 9 landmarks: collected ones with name + district; missing ones with an
  original one-line bilingual riddle-hint and district. All 9 → a "Jaipur Darshan poora" badge on the own
  profile and the PersonCard (server already stores stamps; derive the badge from the count, no new storage).
- Tests: list states, badge at 9/9 only, PersonCard shows badge.

### Task 4 (after look-around lands): Jog + zoom
- Jog: hold Shift, or push the joystick past 90 % of its radius, to move at 1.8× WALK_SPEED; the server speed
  check must allow it (adjust the server's walking pace bound accordingly, with a test); not while driving.
- Zoom: mouse wheel / pinch on the canvas between ~0.6× and ~1.6× of today's camera distance; wall pull-in
  still works; reset on district change.
- Tests: jog speed on both inputs; server accepts jog pace, still rejects teleports; zoom clamp.

### Task 5: Signposts + rooftop viewpoints
- Bilingual direction boards at the main crossings of each district pointing to its landmarks (and the metro),
  built from district data so they stay right; low-poly, shared geometry/material.
- One rooftop viewpoint per district: a marked stair at a building; E/tap climbs (short fade), the player
  stands on the roof edge area (bounded, cannot walk off), look-around works; E/tap again comes down to the
  same stair. Gated like other interactions (not while driving/seated/cards).
- Tests: signposts point at the right landmark (bearing test per district); rooftop up/down returns to the
  stair; cannot leave the roof area.

### Task 6: Auto-taxi
- At a parked auto, besides "Auto chalao", a "Le chalo" option lists the district's landmarks; choosing one
  plays a short ride (camera follows, ~4 s, skippable) and sets the player beside the landmark, on foot.
  Server speed check: the ride is announced so the move is accepted (reuse the metro/teleport path).
- Tests: ride ends at the landmark; speed check accepts it; not available while seated/driving/cards.
