# The City Answers Back — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Make Gulabi Gali fun when nobody else is online: things to play, touch, taste and watch in every
district, and ways to express yourself that others see when they are there. Owner's brief (2026-11-25): "make the
app more interactive", the controller picks.

**Architecture:** Builds on the live app (main 006d5b5: seven districts, 14 stamps, migrations 0001–0008, 0010, 0011).
Tasks 1–4 are client-only extras (docs/architecture.md, "The client-only extras: nothing is broadcast"): drawn and
decided on the page, kept in `localStorage` through `storage.ts`, nothing sent. Task 5 is the one protocol change
(mirrored `protocol.ts`), modelled on reactions (`DistrictDO.react`). Deploy order: Worker, then the `pages` workflow.

## Global Constraints

- Workers Free plan: Tasks 1–4 add no server calls. Task 5 adds one small message, rate-limited, nothing stored.
- Phones first (360×740). `frontend/tests/hud.spec.ts` bounds hold; ≥ 10 px slack for CI's wider fonts; every new
  button ≥ 44 px. E's priority order (`createInteraction`) stays coherent: say where each new thing sits.
- Bilingual copy (Hinglish default + English) in `strings.ts`: original, warm, gender-inclusive, respectful of
  faiths (a temple bell is rung gently, never a joke), vendors and performers (real crafts, no caricature).
- No per-frame allocations; instanced meshes; dispose on district change; `prefers-reduced-motion`; tier 0 thinner;
  sounds follow `gg-sound` and pause in hidden tabs; test hooks only behind `VITE_TEST_HOOKS`; main bundle under
  250 kB gzip (it is 212): each game or show is a lazy chunk.
- Privacy: ghosts, hidden and blocked people are never shown an emote from, or have theirs shown to, anyone they
  could not otherwise see; nothing new names or locates a person.
- Works in every district, Galta Ji included (lists read from `DISTRICTS`, never six or seven hard-coded ids).
- Gate: `npm run lint && npm test && VITE_API_URL=https://api.gulabi-gali.manishbisht.me npm run build -w frontend && npm run check:test-hooks`, plus the touched e2e specs; the controller runs the full suite in the CI image.

## Review Focus

1. Anything that costs frame rate on a cheap phone, or leaks objects across district changes.
2. A new prompt or button that fights an existing one (landmark card, Baitho, autos, animals, roof, taxi), or
   breaks HUD fit at 360 px.
3. Copy or depiction that is disrespectful (temple, cow, vendors, performers) or inaccurate about Jaipur.
4. Task 5: an emote reaching someone it should not (ghost, hidden, blocked, out of range), or a spam path.

---

### Task 1: Gali cricket (an everyday game)

- A chalked pitch in a lane of at least three districts (walled-city, mi-road, malviya-nagar): walk up, "Cricket
  khelo". One-thumb timing game, about 60 s: a kid NPC bowls, tap to swing, runs by timing (1/2/4/6), out on a miss
  at the stumps or a catch; a broken-window "Arre!" gag at most once. Score, best score kept locally
  (`gg-cricket-best`), a share line. Lazy chunk like `Patang`; its own camera like `patangView`; Escape/× leaves.
- Reduced motion playable; tier 0 thinner; sound through the existing switch.

### Task 2: Things you can touch

- A small "touchables" system fed from each district's def: temple bells (a gentle ring, at temples and Galta Ji),
  hand pumps (water runs for a moment), pigeon flocks on open squares that lift and wheel when you walk into them
  and settle again (instanced), a diya shelf you can light after sunset. Each answers a tap/E with a short
  animation and sound; no score.
- Animals: "Roti khilao" for the cow (she chews, a contented line), "Pyaar karo" for a dog or cat (tail wag /
  purr emote) alongside the existing "Saath chalo".
- At least two kinds in every district.

### Task 3: Jaipur ka Swaad (stalls serve you)

- Stalls and tapris serve: chai in a kulhad, pyaaz kachori, lassi, kulfi, ghewar (in season copy), mirchi vada,
  dal baati at one place, golgappe. Walk up, "Chakho": the vendor says a line, your character holds and has it
  (a prop in hand, a short emote), a one-line note about the dish and where in Jaipur it is loved.
- A tasting list "Jaipur ka Swaad n/8" beside Darshan (same sheet pattern, local only, `gg-tasted`), each dish
  findable in at least one district, spread so the list sends you across the city. No money, no real shop names.

### Task 4: Street shows

- A kathputli (puppet) show and a ravanhatta player, each in at least two districts, plus a kalbelia-style
  dancer NPC troupe at one square in the evening: idle until you come near, then a 20–30 s performance (instanced
  figures, procedural music through `ambience.ts`' graph), "Taali bajao" claps. A line of respectful copy about
  the craft on a small card.
- Shows are client-only and seeded per district/day so they are where the map says; a 🎭 mark on the map list.

### Task 5: Emotes others can see

- An emote button in the HUD (one chip, a small wheel): Naacho (a ghoomar-like spin), Taali, Baith jao (sit on
  the ground), Selfie pose, Haath hilao. Plays on your avatar at once; residents others can see send
  `{t:'emote', kind}` on the district socket, and everyone who can already see them in range sees it. Ghosts
  play theirs locally only. Server rules like reactions: visible, unmuted, rate-limited (per minute), nothing
  stored, unknown kinds ignored by old pages (additive protocol), old pages never crash on the new message.
- Movement cancels an emote; sitting persists until you move.

### Task 6 (controller, after merge): tie-ins

- New "Aaj ka Darshan" goal kinds (cricket, touch, swaad, show, emote) with deeds emitted by Tasks 1–5 through
  a plain DOM-free hook each task exposes (`emitFun('cricket')`-style, defined by the controller at integration);
  first-visit hint mentions one thing to do; docs (architecture, deployment, device-performance).
