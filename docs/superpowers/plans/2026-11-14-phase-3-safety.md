# Gulabi Gali, Phase 3: Safety (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Make the meeting features safe enough for a public Instagram launch with one moderator:

- a verified tier for reaching strangers, with invite codes
- block and report everywhere, with reports carrying evidence
- a Hindi/Hinglish/English word filter
- rate limits
- automatic hiding on repeated reports
- a phone-friendly admin page for the owner
- a cap on live visitors with a waitlist
- account deletion

**Architecture:** Server-side rules in the Worker and the Durable Objects, plus new D1 tables. The admin
page is a lazily loaded frontend route (`#/admin`), served only to user ids listed in the `ADMIN_USER_IDS`
secret. It calls `/api/admin/*`, which is checked on every request. The filter lives in its own backend
module, and the frontend copy is used for instant feedback only. The server is the authority.

**Tech Stack:** As in phases 1–2, plus Workers Rate Limiting bindings (as in `games/backend/wrangler.jsonc`).

**Spec:** `docs/superpowers/specs/2026-11-14-gulabi-gali-design.md`. See the sections "Who can do what",
"Safety and moderation" and "Handling crowds".

**Builds on:** phase 1 and phase 2 (`docs/superpowers/plans/2026-11-14-phase-2-meeting.md`).

## Global Constraints

Everything in the phase 1 and phase 2 Global Constraints still holds.

**Tiers:**
- **Ghost:** as before.
- **Resident:** visible, can sit and talk at benches, can receive and accept requests.
- **Verified:** can **send** requests, pin posters (the poster walls arrive in phase 4; the gate is
  enforced in this phase), sees others' links and holds 2 invite codes. A person becomes verified by
  either:
  - redeeming an invite code from a verified member
  - being marked verified by an admin

No phone OTP: it is out of budget.

**Report evidence:**
- **Bench report:** attaches the bench's in-memory rolling transcript of the last 10 minutes.
- **1:1 chat report:** attaches that match's last 30 messages.
- **Profile, poster or person report:** attaches a snapshot of the profile or poster.
- Evidence is visible only to admins, only inside the report, and is deleted when the report is closed or
  30 days after it was filed.
- The privacy copy says, word for word: "Agar koi baat-cheet report hoti hai, toh moderator uske haal ke
  messages padh sakta hai." / "If someone reports a conversation, the moderator can read its recent
  messages."

**Auto-hide:** 3 reports from distinct **verified** reporters within 7 days hide a person (they are not
broadcast and their profile 404s) or a poster until an admin acts. Residents' reports still go to the
queue but never trigger auto-hide.

**Blocking:**
- Symmetric and total: the two people never appear to each other in districts, person cards, requests or
  chats.
- Any pending requests between them are deleted, and any match is unmatched.
- The blocked person is never told.

**Rate limits:**

| What | Limit |
|---|---|
| Requests sent by an account younger than 7 days | 5 per day |
| Requests sent by older accounts | 20 per day |
| Chat messages | 30 per minute |
| Bench lines | 1 per second (already) |
| Reports | 20 per day |
| Invite redemptions | 10 per hour per IP |
| Sockets | 120 per minute per IP |
| Sign-ins | 20 per minute per IP |

Per-IP limits use Workers Rate Limiting bindings. Per-account limits use D1 counters.

**Word filter:** applies to names, statuses, about, request reasons, chat, bench lines and posters. It
returns `{ ok: false, reason: 'words' }` with the field name. It normalises before matching:

- lowercase
- NFKC
- leetspeak (`0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s`)
- repeated letters collapsed
- separators between letters stripped

It matches whole tokens and known compounds from a list kept in `backend/src/filter/words.ts`. The list is
built from a published open-source profanity list for English plus a curated Hindi and Hinglish
(Roman-script) list. Cite sources in a file header comment, and do not include slurs in tests: use
placeholder tokens injected through a test-only list.

**Cap and waitlist:**
- `MAX_LIVE`, a var defaulting to `300`, is the number of resident sockets across districts. It is
  counted by a `GateDO` (one global).
- When the cap is reached, new resident connections get `error: 'full'` with a queue position and stay
  ghosts. Ghosts are uncapped but limited to 120 sockets per minute per IP.
- People can leave an email: `POST /api/waitlist {email}`. It is stored in D1 and exportable as CSV from
  the admin page. No email is sent.
- A redeemed invite code skips the queue.

**Account deletion:** `DELETE /api/me` removes the profile, requests, matches, messages, invites and
blocks the person made, then signs them out. Reports they filed keep the evidence, with the reporter id
replaced by `deleted`. Reports about them are kept until closed.

**Admin:** every `/api/admin/*` route checks `ADMIN_USER_IDS`, a comma-separated secret, and is 404 for
everyone else. It is never 403, so its existence doesn't leak.

## Review Focus

1. **The reported person retaliates by mass-reporting the reporter from fresh accounts.** Auto-hide counts
   only verified, distinct reporters, so fresh accounts can't hide anyone. Test: Task 4.
2. **Blocking during a live bench conversation.** The two people stop seeing each other's lines
   immediately, and one of them is moved out of the shared view. If both sit on the same bench, the
   blocker stays and the blocked person is unseated. Test: Task 3.
3. **The filter both misses and over-blocks.** Spaced-out or leet versions are caught, and innocent words
   containing a bad substring are not blocked: whole-token matching (the "Scunthorpe" problem). Test:
   Task 2.
4. **The admin page on a phone with a slow network.** Actions are idempotent: a double-tapped ban
   doesn't error, and the queue paginates. Test: Task 6.
5. **The cap at the edge.** When someone leaves, the next person in the queue gets in. A reload doesn't
   lose the queue place: the position is keyed by user id. Test: Task 7.

---

### Task 0: Hand-off hardening from the phase-2 final review

These are gaps the phase 2 review found that this plan didn't cover. They are prerequisites for Tasks 1–8.

**Files:**
- Create: `backend/migrations/0002_trust.sql` (the base migration, extended by later tasks), `backend/src/refresh.ts`,
  `backend/src/evidence.ts`, `backend/test/{refresh.test.ts,evidence.test.ts,caps.test.ts}`
- Modify: `backend/src/{district.ts,inbox.ts,chat.ts,index.ts,auth.ts}`, `.github/workflows/deploy.yml`,
  `backend/wrangler.jsonc`

**Interfaces and requirements:**

1. **A single live-refresh path.** Add `refreshUser(env, userId, why: 'block'|'ban'|'mute'|'hide'|'profile')`.
   - It fans out an RPC to all four DistrictDOs (named by `DISTRICT_IDS`) and to the user's InboxDO.
   - Each DO reloads that user's state from D1: banned, hidden, muted-until, blocked set and `PublicPerson`.
   - The DO acts on it: `ban` closes the user's sockets with a new code, `LIVE_CLOSE.banned = 4004`. `hide` makes them
     ghost-like. `mute` refuses `say` and `status` with `error: 'muted'`. `block` refreshes the filters. `profile`
     re-broadcasts the user with a `join` upsert.
   - Tasks 3, 4, 6 and 8 all call this function.
   - Test: each `why` value has its effect on an open socket.
2. **Keep blocked sets out of socket attachments.** Attachments have a size cap. Keep each user's blocked set in DO
   memory, loaded from D1 on connect and by `refreshUser`. Reload it after a wake, lazily on the first frame.
   Attachment write failures are already logged; add a test that a user with 500 blocks still connects.
3. **Evidence survives an unmatch, a block, or account deletion.**
   - The table is `held_evidence(id, owner, other, match_id, messages TEXT, created_at)`.
   - Before an unmatch, a block's auto-unmatch, or a deletion, snapshot the last 30 messages of the match into it.
     Rows are only visible to admins and are purged after 30 days by the cron.
   - Either party can report a match that ended in the last 30 days (`kind: 'chat'`, using `held_evidence`).
   - The chat UI tells the other person "Ye baat-cheet khatam ho gayi" / "This conversation has ended" when an
     `unmatched` notice arrives for an open chat.
   - Tests:
     - unmatch, then report: the report carries the messages
     - block, then report: same
     - the purge after 30 days
4. **The bench transcript survives a quiet bench.** While any bench transcript is non-empty, keep the DistrictDO awake
   with a self-renewing timer, for at most 10 minutes after the last line. Keep an in-memory `satAt` log of who sat on
   which bench and when, covering the last 10 minutes, so a silent sitter can still report. Document that a deploy
   still evicts it. Tests use the injectable clock.
5. **Cap ghosts too.**
   - Each DistrictDO accepts at most `MAX_DISTRICT_SOCKETS`, default `400`, counting ghosts and residents.
     Over the cap, return `error: 'full'` and close the socket.
   - The Worker allows at most 6 concurrent live sockets per IP per district, tracked in the DO by the
     `CF-Connecting-IP` passed in `X-GG-Who`.
   - Ghost clients already send at 2 Hz (from the phase 2 fix wave).
   - Tests for both caps.
6. **CI applies D1 migrations before deploying.** In `deploy.yml`'s `deploy-api` job, run
   `npx wrangler d1 migrations apply gulabi-gali --remote` before `wrangler deploy`. Keep every migration additive.
7. **Read rate limits.** Rate-limit `GET /api/profiles/:id` and `GET /api/requests` per user, at 120 per minute,
   with D1 counters as in Task 5. Add these request indexes to 0002:
   - `requests(to_id, state, created_at)`
   - `requests(from_id, to_id, state)`
   - `matches(b)`
8. **Auth tests.** Add tests that the JWKS path (`ClerkKeys`) fetches keys, caches them and throttles refreshes, and
   that a token with the wrong `azp` is rejected.
9. **Clerk-mode performance.** Add a device-perf run with a test Clerk key set: a build that loads the Clerk chunk
   and stubs network calls to Clerk's CDN. Record it in `docs/device-performance.md`. If load time goes up more than
   0.5 s, defer the Clerk mount until idle after the first walkable frame.

- [ ] Steps: write the failing tests, implement, run `npm run lint && npm test` and Playwright, then commit as
  `feat: phase-3 groundwork — live refresh, held evidence, caps, migrations in CI`.

---

### Task 1: Verified tier and invite codes

**Files:**
- Create: `backend/migrations/0002_trust.sql`, `backend/src/trust.ts`, `backend/test/trust.test.ts`,
  `frontend/src/ui/InviteSheet.tsx`
- Modify: `backend/src/{requests.ts,profiles.ts,index.ts,protocol.ts}`, the frontend protocol copy,
  `frontend/src/ui/{PersonCard.tsx,Hud.tsx}`

**Interfaces:**
- Migration:
  - `users` gets `verified INTEGER NOT NULL DEFAULT 0`, `verified_by TEXT`, `hidden INTEGER NOT NULL DEFAULT 0`
  - new table `invites(code TEXT PRIMARY KEY, owner TEXT NOT NULL, used_by TEXT, used_at INTEGER, created_at INTEGER NOT NULL)`
  - `CREATE INDEX matches_b ON matches(b)`, carried over from the phase 2 review
- Codes are 8 characters of Crockford base32, generated with crypto randomness. Each verified member has
  up to 2 unused codes, issued on verification.
- Endpoints:
  - `GET /api/invites` returns the caller's codes.
  - `POST /api/invites/redeem {code}` → 200 `Me` (now verified), or one of: 404 `bad-code`, 410 `used`,
    409 `already-verified`, or 403 if the redeemer is the code's owner.
- `Me` gains `verified: boolean`. `FullProfile` gains `link` only when the viewer is verified.
- **The profile link input arrives here** (it was deferred from phase 2). ProfileSheet gains an optional link
  field: https only, at most 200 characters. The backend stores `new URL(x).href` instead of the raw string,
  and rejects control characters.

  ProfileSheet currently sends `link: null` on every save. Fix it so that saving without touching the link
  keeps the existing one. Test: `saving the profile without the link field keeps the stored link`.
- **Also carried from phase 2 review:**
  - `status` is single-line: strip `\n`.
  - `readJson` caps the body at 16 KB.
  - The try/catch in `/api/profiles/:id` wraps only the URI decode.
- `POST /api/requests` now answers 403 `not-verified` for non-verified senders.
- **UI:**
  - A resident's PersonCard shows "Milna hai" as disabled, with "Invite code se verified bano" / "Get
    verified with an invite code", which opens InviteSheet.
  - InviteSheet has a code entry field and, for verified members, their codes with a share button using
    `navigator.share` and a copy fallback.

- [ ] **Step 1:** Write the tests:
  - `redeeming makes you verified and gives you 2 codes`
  - `a code works once`
  - `cannot redeem your own`
  - `non-verified cannot send requests`
  - `link only visible to verified viewers`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit: `feat: verified tier and invite codes`

---

### Task 2: Word filter

**Files:**
- Create: `backend/src/filter/{index.ts,normalise.ts,words.ts}`, `backend/test/filter.test.ts`,
  `frontend/src/filter/` (a byte-copied `normalise.ts` and `index.ts` for instant UI hints; the words
  list is fetched from `GET /api/filter/words.json`, which returns a hashed list)
- Modify: every write path: profiles, requests, chat, bench `say` and `status`, and
  `scripts/check-protocol.mjs` (compare the filter copies)

**Interfaces:**
- `normalise(s: string): string[]` returns the tokens.
- `check(s: string, list?: WordList): { ok: true } | { ok: false }`
- The frontend checks hashed tokens (SHA-1 of the normalised token) against the fetched hashed list, so
  the raw list never ships to clients.
- Server write paths return 400 `{ error: 'words', field }`. The UI shows "Kuch shabd theek nahi lag rahe —
  izzat se likho" / "Some words aren't okay here. Please keep it respectful", in the app's own fresh
  phrasing.

- [ ] **Step 1:** Write the tests, using a test-only list with placeholder tokens such as `badword` and
  `ganda`:
  - `catches leet and spaced variants` (`b4dw0rd`, `b a d w o r d`, `baaadword`)
  - `does not flag substrings in innocent words`
  - `Devanagari and Roman Hinglish both checked`
  - `every write path rejects with field`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement, and assemble the real list with sources.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit: `feat: word filter on everything people write`

---

### Task 3: Block

**Files:**
- Create: `backend/src/blocks.ts`, `backend/test/blocks.test.ts`
- Modify: `backend/migrations/0002_trust.sql`, which gains `blocks(a TEXT, b TEXT, created_at INTEGER,
  PRIMARY KEY (a, b))`; `district.ts`, so each socket attachment carries its blocked set and filters join,
  moves, bench and status messages both ways; `requests.ts`, `chat.ts`, `profiles.ts`, and the frontend
  `PersonCard`, `ChatView` and `BenchChat` (Block button with an in-sheet confirm)

**Interfaces:**
- `POST /api/blocks {id}` answers 204 and is idempotent. `DELETE /api/blocks/:id` answers 204.
  `GET /api/blocks` returns the people the caller has blocked.
- Blocking:
  - deletes pending requests both ways
  - unmatches, notifying only the blocker's own tabs
  - tells the user's live DistrictDO to refresh both sockets' blocked sets right away, through an internal
    `refreshBlocks(userId)` RPC
  - unseats the blocked person if both share a bench
- `GET /api/profiles/:id` answers 404 when either person has blocked the other.

- [ ] **Step 1:** Write the tests:
  - `blocked people vanish from each other's district view immediately`
  - `shared bench: the blocked one is unseated`
  - `requests and match removed`
  - `profile 404 both ways`
  - `idempotent`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit: `feat: block anyone, everywhere, instantly`

---

### Task 4: Reports with evidence and auto-hide

**Files:**
- Create: `backend/src/reports.ts`, `backend/test/reports.test.ts`, `frontend/src/ui/ReportSheet.tsx`
- Modify: the migration, which gains
  `reports(id, reporter, target_kind CHECK IN ('person','bench','chat','poster'), target_id, reason CHECK IN ('harassment','hate','spam','underage','other'), note, evidence TEXT, created_at, state CHECK IN ('open','actioned','dismissed'), closed_at)`.
  Also modify `district.ts` (add `benchTranscript` RPC access) and the BenchChat, ChatView and PersonCard
  footers.

**Interfaces:**
- `POST /api/reports {kind, targetId, reason, note?}` answers 201.
  - The server assembles the evidence itself and never trusts client-sent evidence:
    - **bench:** the DistrictDO's `benchTranscript`, only if the reporter is or was seated there within 10
      minutes
    - **chat:** the last 30 messages of a match the reporter belongs to
    - **person:** a profile snapshot
  - Reasons map to copy: "Pareshan kar raha/rahi hai", "Nafrat / gaaliyan", "Spam", "18 se kam lagta/lagti
    hai", "Kuch aur", with English alongside.
- **Auto-hide:** after insert, count distinct verified reporters on the same person in the last 7 days. At
  3 or more, set `users.hidden = 1`, refresh the live districts and return `{ autoHidden: true }`.
- **Cron:** evidence on closed reports, and on reports older than 30 days, is set to NULL.
- **Copy:**
  - The BenchChat footer becomes: "Jo is bench pe baithe hain wahi padh sakte hain. Report hone par
    moderator haal ki baatein dekh sakta hai." / "Only people on this bench can read this. If it's
    reported, the moderator can see recent messages."
  - Sign-up gains the privacy line from the Global Constraints.

- [ ] **Step 1:** Write the tests:
  - `bench report carries the last 10 minutes and only if you were there`
  - `chat report carries the last 30 messages and only for members`
  - `client-sent evidence is ignored`
  - `3 distinct verified reporters auto-hide; 3 residents do not`
  - `evidence purged after close or 30 days`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit: `feat: reports that carry what happened`

---

### Task 5: Rate limits

**Files:**
- Create: `backend/src/limits.ts` (port `overLimit` from games, loopback-exempt), `backend/test/limits.test.ts`
- Modify: `wrangler.jsonc` (rate-limit bindings as in Global Constraints, with namespace ids `51001`–`51006`),
  `env.ts`, every write route, and the frontend error copy for `rate`

**Interfaces:**
- Per-account daily counters live in D1 table `counters(user_id, bucket, day, n, PRIMARY KEY (user_id, bucket, day))`.
- `allow(env, userId, bucket: 'requests'|'messages'|'reports', limit): Promise<boolean>`
- A 429 response sets `Retry-After`.

- [ ] **Step 1:** Write the tests:
  - `new accounts get 5 requests a day, older get 20`
  - `30 messages a minute`
  - `per-IP sign-in limit`
  - `loopback exempt in dev`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit: `feat: rate limits that stop spam before it reaches anyone`

---

### Task 6: Admin page

**Files:**
- Create: `backend/src/admin.ts`, `backend/test/admin.test.ts`,
  `frontend/src/admin/{AdminPage.tsx,ReportQueue.tsx,UserLookup.tsx,admin.css,admin.test.tsx}`
- Modify: `frontend/src/main.tsx`, which adds hash routing `#/admin` with a lazy import, so the admin code
  is never in the city bundle

**Interfaces:**
- All routes are 404 unless the caller's id is in `ADMIN_USER_IDS`:
  - `GET /api/admin/reports?state=open&cursor=` returns 20 at a time, each with the target's profile
    snapshot and evidence.
  - `POST /api/admin/reports/:id/{dismiss|action}`
  - `POST /api/admin/users/:id/{ban|unban|mute|unmute|verify|unhide}`, all idempotent.
    - A **ban** closes their sockets, hides them and blocks sign-in use.
    - A **mute** blocks write paths for 24 hours.
  - `DELETE /api/admin/posters/:id`, for phase 4 posters. It is stubbed now and answers 404.
  - `GET /api/admin/users?q=` searches by name prefix or id.
  - `GET /api/admin/stats` returns live counts per district, residents and ghosts, the queue length and
    the open report count.
  - `GET /api/admin/waitlist.csv`
- **AdminPage:**
  - Phone-first, with one-tap actions and in-sheet confirms for ban.
  - Shows the evidence transcript.
  - Polls stats every 15 seconds.
  - English UI is fine here (owner-only), but keep the strings in `strings.ts` for consistency.

- [ ] **Step 1:** Write the tests:
  - `non-admins get 404 on every admin route`
  - `ban is idempotent and closes live sockets`
  - `mute blocks writes for 24h`
  - `queue paginates`
  - `waitlist CSV escapes commas and quotes`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS. Then add an e2e: with dev auth and
  `ADMIN_USER_IDS=dev:owner`, the owner opens `#/admin`, sees a report filed by another dev user, and bans
  the target.
- [ ] **Step 5:** Commit: `feat: owner's admin page`

---

### Task 7: Cap and waitlist

**Files:**
- Create: `backend/src/gate.ts` (`GateDO`), `backend/test/gate.test.ts`, `frontend/src/ui/FullScreen.tsx`
- Modify: `wrangler.jsonc` (`GateDO` migration `v3`, var `MAX_LIVE: "300"`), `district.ts` (asks the
  gate before broadcasting a resident and releases on leave), the migration (`waitlist(email TEXT PRIMARY KEY, created_at)`)

**Interfaces:**
- `GateDO.admit(userId) → { ok: true } | { ok: false; position: number }`, `release(userId)`
  and `count()`.
  - The queue is ordered by first-ask time and keyed by user id, so a reload keeps the place.
  - An invite redemption in the last 24 hours skips the queue.
- When the gate refuses, the client stays a ghost and `FullScreen` shows "Jaipur full hai! Tumhara number:
  {n}" / "Jaipur is full right now! You're number {n}". It offers an email field, which posts to
  `/api/waitlist`, and keeps exploring as a ghost.
- When the person gets in, the client becomes visible automatically.

- [ ] **Step 1:** Write the tests:
  - `admits up to MAX_LIVE then queues`
  - `a release lets the first in line through`
  - `reload keeps the position`
  - `recent invite skips`
  - `waitlist email validated and stored once`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit: `feat: gentle cap with a waitlist`

---

### Task 8: Account deletion, privacy note, docs

**Files:**
- Create: `frontend/src/ui/PrivacySheet.tsx`, `backend/test/deletion.test.ts`
- Modify: `backend/src/profiles.ts` (`DELETE /api/me`), the profile sheet (a "Delete my account" button
  with a typed confirm, "DELETE"), and `docs/{architecture.md,deployment.md}`
- **Privacy sheet:** linked from the intro and the profile sheet. In plain Hinglish and English, it says:
  - what is stored
  - that bench chat isn't saved
  - the report-evidence rule, word for word from the Global Constraints
  - that there is no location tracking
  - how to delete your account
- `deployment.md` gains: `ADMIN_USER_IDS` (`clerk:<your user id>`), `MAX_LIVE`, the rate-limit namespace
  ids, and a pre-launch safety checklist.

- [ ] **Step 1:** Write the tests:
  - `delete removes profile, requests, matches, messages, invites, blocks made`
  - `reports filed keep evidence with reporter=deleted`
  - `deleted user's sockets close`
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run root `npm run lint && npm test && (cd frontend && npx playwright test)` and expect green.
- [ ] **Step 5:** Commit: `feat: delete your account, and a plain privacy note`
