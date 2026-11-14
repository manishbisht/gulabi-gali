# Gulabi Gali — a walkable Jaipur where people meet

Date: 2026-11-14 · Status: awaiting the owner's approval

## Intent

A stylised 3D Jaipur that runs in the browser, where people from Jaipur walk around, see each other live,
and turn shared interests into real meetups: a study partner, an open-mic crowd, eight players for gully
cricket. It is inspired by peopleofdelhi.com (a 3D multiplayer Delhi with the same goal), but it is its
own product, with its own look, copy and Jaipur-specific ideas. Nothing is copied from that site: no text,
art or names.

It has two purposes:

1. **Help Jaipur people meet each other.** This is the main purpose.
2. **Show off the city.** The city mirrors the real Jaipur right now: weather, air quality, time of day
   and festivals. It should be worth visiting even when few people are online.

The launch is **public**, through Instagram, for everyone in Jaipur. The owner moderates alone. The launch
date is **flexible**: it happens when phases 1–3 are solid, ideally timed to a festival hook (Holi, March
2027, is the leading candidate).

## Goals

- Someone taps an Instagram link on a mid-range Android phone and is walking around Jaipur within seconds,
  with no sign-up needed to look around.
- A signed-up resident is visible to everyone, can sit at a tapri bench and talk, and can be met.
- A verified resident can send meeting requests, chat one-to-one, and pin plans on walls.
- The city reflects live Jaipur weather, AQI, time of day and the festival calendar.
- One person can moderate it from a phone in a few minutes a day.
- A viral spike (thousands arriving in an hour) degrades gracefully into a waitlist instead of falling over.

## Non-goals (for now)

- Native iOS/Android apps. The web only, installable as a PWA at most.
- Voice or video chat.
- Sharing real-world locations, and anything that maps to where a user actually is.
- Payments, a shop, ads, or a dating-app framing.
- Cities other than Jaipur.

## Anti-goals (failure even if it technically works)

- **It feels unsafe, especially for women.** Unwanted messages, creeps who can't be shaken off, or
  harassment that sits unreviewed would mean failure.
- **It's sluggish or crashes inside Instagram's in-app browser on an average phone.**
- **It feels empty.** A city with nobody in it and nothing to look at.
- **It reads as a Delhi clone with the names swapped.**

## Constraints

- **Repo layout follows the owner's `games` repo:** npm workspaces with **only** `frontend/` and `backend/`
  at the root. Everything belonging to one side lives inside that folder. There is **no `shared/` package**.
  The wire protocol types are kept as one file on each side (`backend/src/protocol.ts`,
  `frontend/src/net/protocol.ts`), and a root script (`npm run check:protocol`) fails CI if the two differ.
  Same tooling as `games`: TypeScript, Prettier (`singleQuote`, no semicolons, width 110, trailing commas),
  Vitest, Playwright, ESLint, Node ≥ 22.
- **Stack (decided: approach A):**
  - Frontend: React 19 for the overlays and menus, Three.js for the city, and Vite 8.
  - Backend: a Cloudflare Worker with Durable Objects for live state, D1 for durable records, R2 for any
    large assets, and Cron Triggers for pulling weather.
- **Phones first.** The targets are a mid-range Android phone (a roughly ₹12–15k device) inside
  Instagram's in-app browser:
  - first walkable frame in about 5 seconds on 4G
  - initial download of a few MB at most, with each district streamed in when entered
  - a steady 30 fps
  - touch controls first: a joystick, and tap a person to interact
  - desktop gets keyboard (WASD/E) and mouse as an extra
- **Solo moderation.** Every safety feature is designed so that automatic rules handle the bulk and the
  owner handles exceptions.
- **Language:** Hinglish by default with a Rajasthani touch ("Padharo!"), plus an English toggle.
- **18+ only.** Self-declared at sign-up and stated in the rules.
- **Budget: roughly $5–20 a month.** That covers Cloudflare Workers Paid plus free tiers (Clerk, D1, and
  email sending). Nothing paid per user, such as SMS, is in scope. Budget alerts are set in Cloudflare.
- **Domain:** the site is at `gulabi-gali.manishbisht.me` and the API at `api.gulabi-gali.manishbisht.me`, so both
  share a root domain and sign-in sessions work across them.

## Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| A | Three.js + Cloudflare (Worker, Durable Objects, D1) | Absorbs spikes with no servers to run and costs nearly nothing at low traffic; the backend is hand-written | **Chosen by the owner** |
| B | Three.js + Supabase | Login and dashboard come free, but its Realtime is a poor fit for ~10 Hz position sync at scale, so a second realtime server gets added anyway | Rejected |
| C | Unity / game engine WebGL | Better editor, but downloads are too heavy for Instagram's browser on mid-range phones | Ruled out |

The city art is stylised low-poly. Generic buildings (pink facades, jharokhas, bazaar arches, chhatris)
are generated from code from a small kit of parts. Landmarks are simplified, hand-built models.
CC0 asset packs fill the gaps. No 3D artist is required.

## Who can do what (the "mixed" model, decided)

| Tier | How you get it | Can do |
|---|---|---|
| **Ghost** | Just open the link | Walk anywhere, see everyone, ride autos/metro, read posters, collect stamps. **Nobody sees you.** |
| **Resident** | Sign in (email code or Google), finish a profile, confirm 18+ and the respect pledge | Visible to everyone, set a status, sit at tapri benches and use bench chat, receive and accept meeting requests |
| **Verified** | An invite code from a verified member, **or** marked verified by the moderator (no phone OTP: out of budget) | Everything a resident can do, plus **send** meeting requests (which start 1:1 chats), pin posters (max 2 live), and get 2 invite codes |

Ghosts are free, so people browse first. Becoming visible is instant, with no review queue, because the
owner cannot review everyone. The actions someone can use to reach strangers (starting chats, posting
publicly) need one more step that a throwaway account won't bother with.

## The product

### The city (launch districts)

A first-pass list, connected by the real **Jaipur Metro Pink Line** where it fits and by autos otherwise:

1. **Walled City / Pink City:** Hawa Mahal, Johari Bazaar, Badi Chaupar, Jantar Mantar, the City Palace
   gate. This is the signature district and the spawn point.
2. **MI Road and Raja Park:** Albert Hall, Ram Niwas Bagh, cafés, the shopping street.
3. **University side (JLN Marg):** the Rajasthan University campus, Jawahar Kala Kendra (art and open mics).
4. **Malviya Nagar / WTP:** malls, coaching centres, working professionals.

**Later:** Amer Fort, Nahargarh (sunset views), Mansarovar, Vaishali Nagar.

Each district has landmarks (with a stamp and a one-to-two-line story), tapri benches, poster walls,
parked autos, and street animals (dogs, cats and the occasional cow) that can follow you.

### Live Jaipur

- **Weather and AQI.** A Worker cron pulls Open-Meteo (weather + air quality, free, no key) every ~15
  minutes and caches it. The client changes sky, fog/haze density, rain and dust to match, and shows a
  short Hinglish line ("Aaj hawa saaf hai — Nahargarh tak dikh raha hai").
- **Time of day.** It follows real Jaipur time (IST): sunrise, golden hour on the pink facades, the walled
  city lit at night.
- **Festival calendar.** This is data-driven, a list of dated events and the scene changes each triggers:
  - Makar Sankranti: a kite-filled sky
  - Diwali: lamps along the bazaars
  - Teej and Gangaur: processions
  - Holi: colour powder
  - Jaipur Literature Festival week: activity at JKK

### Meeting people

- **Profile:**
  - name
  - an avatar from a small builder ("a vibe, not a job")
  - home area in Jaipur (a neighbourhood name, never a precise location)
  - status line shown above the head ("Looking for a badminton partner")
  - an optional "here for" badge: friends, study, work/collab, art
  - an optional link that only verified members see
  - a short "tell us about you" line
- **Meeting requests:** walk up to someone, open their profile, and send a request with a short reason
  ("people say yes more when they know why"). They can accept or ignore, and the sender is never told about
  a decline. Unanswered requests disappear after 14 days. Accepting opens a 1:1 chat. Unmatching deletes the
  chat for both people.
- **Tapri benches:** sit down and talk with whoever else is on the same bench. The chat is live only and
  is never saved to a database. The server keeps the last ~10 minutes **in memory** only so that a report
  can carry it (see Safety).
- **Poster walls ("deewar"):** verified members pin plans ("Gully cricket, Sunday 7am, Central Park — 8
  log chahiye"). Posters pass the word filter, go live immediately, expire after a set time, and can be
  reported.
- **Seed characters:** a cast of fictional Jaipur locals (an RAS aspirant, a blue-pottery artist, a
  Bapu Bazaar shopkeeper, a first-year student…) walk the city with statuses, so the city never feels empty.
  They are clearly marked as not real people and can't be messaged.

### Safety and moderation (all at launch)

- 18+ confirmation and a respect pledge at sign-up.
- Report and block from any profile, chat, bench or poster. Blocking hides the two people from each other
  everywhere.
- **Proof attached to reports (decided by the owner):**
  - A bench report attaches the bench's in-memory rolling buffer (the last ~10 minutes) to the report.
  - A 1:1 chat report attaches the recent messages of that chat.
  - Only the owner sees them, and only in the report. Report evidence is deleted when the report is
    closed, after a fixed retention period.
  - The privacy note and sign-up pledge say this plainly: "If someone reports a conversation, the
    moderator can read its recent messages."
- A word filter covering English, Hindi and Hinglish (including Roman-script slurs) on names, statuses,
  chats, benches and posters.
- Rate limits: new accounts can send only a few meeting requests per day, with limits on messages and
  posters too, and per-IP limits on sign-up and sockets (the same pattern as `games/backend/wrangler.jsonc`).
- Automatic actions: N reports from distinct verified users hide a person or poster until the owner looks
  at it.
- **A phone-friendly admin page** (owner only):
  - a reports queue with context
  - one-tap mute, ban or unban
  - remove a poster
  - mark someone verified
  - look up a user
  - see live counts
- Account deletion that removes the profile, chats and requests.

### Handling crowds

- Every district is a Durable Object holding the people currently there. It relays positions (~10
  updates/s, sent only to people nearby) and bench chat.
- A configurable cap limits the number of live connections. Past the cap, newcomers see a friendly "Jaipur
  full hai" screen with their place in the queue and an option to leave their email to be told when there's
  room. Invite codes skip the queue.

### Game extras (after launch unless noted)

- **Autos:** drive any parked auto around a district, about three times walking speed.
- **Metro:** ride between districts.
- **Jaipur Darshan stamps:** collected at landmarks and shown on the profile. **(At launch)**
- **Pets:** street animals follow you around.
- **Patang-baazi:** a kite-fight minigame at Makar Sankranti ("Wo kaata!").
- A Jaipur-specific playful event in place of Delhi's protest/police chase. The idea is left open.

## Phases

1. **The city:** districts, avatars, movement, touch controls, live weather/AQI/time, landmarks and stamps,
   seed characters. Single-player, but shippable as a preview.
2. **Seeing and meeting:** district Durable Objects, live presence, benches, profiles, meeting requests, 1:1
   chat.
3. **Accounts and safety:** sign-in, tiers, invite codes, moderator verification, reports and blocks, word
   filter, rate limits, admin page, cap and waitlist.
4. **Extras:** autos, metro, pets, festivals, minigames.

**The public launch needs phases 1–3 complete.** Phase 4 pieces ship when ready.

**Launch date: flexible (decided by the owner).** Launch when phases 1–3 are solid, timed to a festival hook
if one is near (Holi 2027 is the leading candidate). There is no public preview before then.

## Decided by the owner

- Jaipur version of peopleofdelhi.com, with the purpose to help Jaipur people meet, and to show off the
  city (weather, AQI and more).
- "Everything": the full social space, not just a walkable map.
- Public launch on Instagram for everyone in Jaipur.
- The mixed visibility model (above), with the owner as the sole moderator.
- Approach A: Three.js + Cloudflare.
- Repo layout like `games`: `frontend/` and `backend/`, each self-contained.
- Launch date is flexible; launch when ready.
- Reports carry proof: a ~10-minute in-memory bench buffer and recent 1:1 messages, visible only to the
  owner.
- Budget of about $5–20 a month, so there is no SMS phone verification.
- Domain: `gulabi-gali.manishbisht.me`, with the API at `api.gulabi-gali.manishbisht.me`.

## My calls (the owner can override)

- Open-Meteo for weather/AQI; real IST time of day; data-driven festival calendar.
- Stylised low-poly art, mostly procedural, with no 3D artist.
- **Auth:** Clerk, which the owner already uses in `games`, with email code and Google sign-in. The free
  tier's monthly active user limit must be checked in planning against the budget.
- Verified tier as defined above (invite code or moderator); 2 invite codes per verified member; 2 live posters per member; 14-day
  request expiry.
- **Hosting:**
  - frontend on GitHub Pages with hash routing, as in `games`
  - backend Worker deployed from GitHub Actions
- Duplicated protocol file plus a CI check, instead of a `shared/` package. (`games` has a `shared/`
  workspace. This repo deliberately does not.)
- **What a Ghost sees of a resident:** only the avatar, first name and status line. The full profile
  (home area, "here for", stamps, about, link) requires being signed in. The district Durable Object sends
  unauthenticated sockets only that minimal data. Residents get a "pause requests" toggle that stops anyone
  from sending them requests.
- **Sign-in inside Instagram:** Google blocks its sign-in inside embedded browsers like Instagram's, so
  the email code is the main sign-in path. Google shows only when the page is open in a real browser, and
  there is a gentle "open in browser" hint.
- **Accounts:** the same Cloudflare account as `games`, a separate Worker (`gulabi-gali-api`) and a
  separate Clerk application.
- Working name **Gulabi Gali**, from the repo name. The final brand is the owner's call.

## Left to the builder

- Exact Durable Object and D1 schema split, message formats and update rates.
- The district list and layouts beyond the first pass above, and which landmarks get hand-built models.
- Avatar builder options, the seed-character cast, and all copy (Hinglish and English).
- Word-filter list source, report thresholds, exact rate limits and cap numbers.
- Performance techniques (instancing, LOD, texture atlases, district streaming) to hit the phone targets.
- Test strategy, following the `games` repo's patterns: Vitest for logic, Durable Objects tested with
  `@cloudflare/vitest-pool-workers`, Playwright for the flows and a mobile-viewport perf check.
