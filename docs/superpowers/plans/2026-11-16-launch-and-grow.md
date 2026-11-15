# Launch and Grow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Make the first Instagram visitors stay (launch polish), bring them back (notifications, meet-ups,
reactions), and give them more city (Amer district, ambient sound).

**Architecture:** Builds on the live app: React 19 + Three.js frontend (`frontend/src`), Cloudflare Worker with
Durable Objects (DistrictDO, InboxDO, GateDO) and D1 (`backend/src`, migrations up to 0005). Protocol, filter,
benches, stamps and taxi data are mirrored byte-identically (`scripts/check-protocol.mjs`). Any server change is
deployed with `wrangler deploy` BEFORE the site (CI's deploy-api has no token).

**Spec:** `docs/superpowers/specs/2026-11-14-gulabi-gali-design.md` + owner choices in chat on 2026-11-16.

## Global Constraints

- Privacy: ghosts, hidden and blocked people are never shown, counted per person, notified about, or
  reachable. Nothing here may reveal who is where unless that person is already visible on the street.
- Phones first (360×740, Instagram in-app browser); HUD bound `frontend/tests/hud.spec.ts` holds in every district.
- Bilingual copy (Hinglish default + English) in `frontend/src/i18n/strings.ts`, original wording.
- New user text goes through the word filter (`backend/src/filter`) with the right field scope; new write
  endpoints are rate-limited with the existing `allow()` / limiter pattern; verified-only where the spec gates posting.
- New schema in new migrations (0006+); never edit 0001–0005 (deployed).
- No per-frame allocations; dispose on district change; respect `prefers-reduced-motion`; test hooks only behind `VITE_TEST_HOOKS`.
- Secrets: agents never print or handle secret values; anything needing a new secret ships a script the owner runs.
- Gate: `npm run lint && npm test && VITE_API_URL=https://api.gulabi-gali.manishbisht.me npm run build -w frontend && npm run check:test-hooks && (cd frontend && npx playwright test)`; e2e must not depend on live weather or timing (measure game time, fixture `/api/city`).

## Review Focus

1. A count, link, notification or reaction that reveals a ghost, a hidden or a blocked person.
2. Push notifications whose lock-screen text leaks a message or a name.
3. A low-end phone that still stalls (quality never steps down) or a first load that grows past the 250 kB budget.
4. Meet-up/reaction spam: unfiltered text, no rate limit, or harassment via repeated reactions.
5. A new district that breaks travel, stamps (9 → 10), the Darshan list, map, signposts, taxi data or the HUD.

---

### Task 1: Slow phones step quality down
- `frontend/src/engine/stage.ts` ignores frames slower than 250 ms when deciding to step the quality tier down,
  so a phone that is really struggling never drops shadows/resolution. Count slow frames (clamp, don't drop),
  keep the existing hysteresis, never step down on a single hitch (tab switch, GC, district load), and step
  back up only as today. Tests: sustained 300–600 ms frames step down within a few seconds; one 2 s hitch does not.

### Task 2: Welcome "who's here" + invite links to a place
- Welcome screen shows a live, rounded count of VISIBLE residents in the city ("12 log abhi gali mein"; "Abhi
  shaant hai — pehle aao" when 0–1) from a public, cached (≤30 s), rate-limited endpoint built on GateDO/DistrictDO
  counts of visible people only. No names, no per-district split below 3 people.
- Invite link to a PLACE: a "Bulao" share action on landmark cards, benches and the map opens the native share
  sheet (fallback: copy) with `https://gulabi-gali.manishbisht.me/?at=<district>:<placeId>` and a short bilingual
  line. Opening such a link enters that district and stands you at that place (after Padharo). The link carries
  no identity of the sharer. Unknown ids fall back to the normal spawn.
- Tests: count endpoint excludes ghosts/hidden; small numbers collapse; link round-trip per place kind.

### Task 3: HUD fits with long names
- With "Malviya Nagar–WTP" / "MI Road–Raja Park" + festival lines + city line + sign-in nudge the top block ends
  ~287 px > 259. Make it fit (e.g. shorten the place chip to the district's short name with the full name as the
  accessible name, merge or truncate the festival line, wrap rules). Extend hud.spec to the busiest HUD in EVERY
  district, guest and signed in.

### Task 4: Deploys start on push
- Pushes to main never trigger the `pages` workflow (manual dispatch works). Find out why (events API, workflow
  syntax, repo settings) and fix what is fixable in the repo; document anything only the owner can change.

### Task 5: Push notifications for requests and messages
- Opt-in from the profile sheet ("Naye messages pe batao"). Web Push (VAPID) via a service worker; subscriptions in
  D1 (new migration), removed on sign-out, account deletion and 404/410 from the push service. InboxDO sends a push
  when the user has no open inbox socket. Payload never contains names or message text ("Gulabi Gali: ek nayi
  request" / "ek naya message"); tapping opens the inbox. Rate-limit pushes per user. Not offered where unsupported
  (Instagram in-app browser; iOS outside an installed home-screen app) — say so in copy.
- VAPID keys: ship `scripts/vapid-setup.mjs` that generates the pair and pipes the private key into
  `wrangler secret put` and the public key into the GitHub `github-pages` secret, printing neither; the owner runs it.

### Task 6: Meet-ups ("Milte hain")
- Posters already carry a plan with `when`. Add RSVP: verified residents tap "Main aaunga"; the poster shows the
  count; the poster's owner sees attendees' first names; others see only the count. RSVPs go with the poster
  (expiry, take-down, hide, ban, deletion, blocks both ways), rate-limited, migration 0006+. Optional reminder via
  Task 5's push 1 h before `when` to attendees who opted in.

### Task 7: Reactions (wave / namaste)
- Tap a visible person within 8 m → "Namaste" / "Haath hilao" without opening chat. A small emote shows above both
  avatars to everyone who can see both; the target gets a gentle toast. Residents only (ghosts can't send or get
  them); blocks both ways; per-pair cooldown and per-user rate limit; muted users can't send; never stored.

### Task 8: Amer district
- New district `amer` (Amer Fort on its hill, Maota lake, a ramp/elephant path, stalls) with the Amer Fort landmark
  + stamp (TOTAL_STAMPS 9 → 10: stamps.json mirrors, Darshan riddle, profile/badge logic), NPCs, benches/tapris,
  parked autos with taxi stands/drops, signposts, a rooftop/rampart viewpoint, poster wall. Reached from the travel
  sheet by a "bus" ride (no metro in Amer) reusing the travel/gate path. Keep the new chunk small (lazy-loaded like
  other districts). Update docs and every per-district test.

### Task 9: City sounds
- Optional ambient audio per district (bazaar murmur, birds by day, crickets at night, temple bells at dawn/dusk,
  festival drums on festival days), synthesised or small original/CC0 loops (credit in docs), off by default,
  controlled by the existing sound switch, paused when the tab is hidden, low volume, no autoplay before a gesture.
