# Deployment and one-time setup

The site deploys to GitHub Pages at `https://gulabi-gali.manishbisht.me`; the API deploys to a Cloudflare
Worker at `https://api.gulabi-gali.manishbisht.me`. Pushes to `main` deploy both (`.github/workflows/deploy.yml`).
Nothing here has been done yet: the steps below are the owner's, in order. Phase 2 added accounts (Clerk), a D1
database and two Durable Objects; the Durable Object classes are created by the `migrations` block in
`wrangler.jsonc` on the first `wrangler deploy`, with nothing to do by hand.

> **WARNING: never set `DEV_AUTH`, `DEV_AUTH_SECRET` or `VITE_DEV_AUTH` in production.** They turn on a
> sign-in that needs only a name: `DEV_AUTH=1` on the Worker enables `/api/dev/login` and accepts dev tokens,
> and `VITE_DEV_AUTH=1` bakes a name-only sign-in sheet into the site. They are for `wrangler dev`, tests and
> e2e only. Do not put them in `wrangler.jsonc`, a Worker secret or variable, a GitHub secret or the deploy
> workflow. Two guards back this up: a production build with `VITE_DEV_AUTH=1` fails unless
> `GG_ALLOW_LOCAL_API=1` is also set (`frontend/vite.config.ts`), and the Worker ignores dev tokens and
> answers 404 on `/api/dev/login` unless `DEV_AUTH` is exactly `1`.

## Owner checklist, in order

1. Cloudflare account, token and KV namespace (section 1, steps 1 and 2).
2. **D1** (section 1a): create the database, paste its id, apply the migrations (`0001` to `0004`).
3. **Clerk** (section 1b): create the app, then set the Worker secrets.
4. GitHub `backend` environment and the API domain (section 1, steps 3 to 5); the first push to `main` deploys.
5. GitHub Pages and the `github-pages` secrets, including `VITE_CLERK_PUBLISHABLE_KEY` (section 2).
6. Optional: Cloudflare Web Analytics, the `VITE_CF_BEACON_TOKEN` secret (section 2c).
7. Budget alerts (section 3).

## 1. Cloudflare Worker (`backend/`)

1. Create a Cloudflare account on the Workers Paid plan (the only paid item; everything else stays on free
   tiers), and an API token from the "Edit Cloudflare Workers" template.
2. Create the KV namespace the cron job writes the city snapshot to, and paste the id it prints over
   `REPLACE_WITH_CITY_KV_ID` in `backend/wrangler.jsonc`:

   ```sh
   cd backend && npx wrangler kv namespace create CITY
   ```

3. GitHub repo, Settings, Environments, create `backend`, and add its secrets:
   - `CLOUDFLARE_API_TOKEN`: the token from step 1.
   - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare dashboard, Workers, Account ID.

   The `deploy-api` job runs `wrangler deploy` on a push to `main` and skips quietly while these are unset.

4. **The API domain.** `wrangler.jsonc` declares a custom domain,
   `routes: [{ pattern: "api.gulabi-gali.manishbisht.me", custom_domain: true }]`. Cloudflare creates the DNS
   record and certificate itself, but only if the **`manishbisht.me` zone is on Cloudflare** (the domain's
   nameservers point at Cloudflare). If it is not yet, the first `wrangler deploy` fails on the route. Until
   the zone is moved, comment the `routes` line out, set `"workers_dev": true` in `backend/wrangler.jsonc` (it is `false` on purpose), deploy, and use the `workers.dev` URL the deploy prints
   (`https://gulabi-gali-api.<account>.workers.dev`) as `VITE_API_BASE_URL` below. The site's CSP is built
   from `VITE_API_BASE_URL`, so it follows. Rate limits still apply there (the edge sets the connecting address on workers.dev too). CORS is keyed on the site's origin (not the API's), so it needs no
   change.
5. Check it: `curl https://api.gulabi-gali.manishbisht.me/health` returns `{"ok":true}`, and
   `/api/city` returns the snapshot. The 15-minute cron fills KV; until its first run `/api/city` fetches live.

### 1a. The D1 database

Run these from `backend/`, in order:

```sh
npx wrangler d1 create gulabi-gali
```

Paste the `database_id` it prints over `REPLACE_WITH_D1_ID` in `backend/wrangler.jsonc`, commit it, then create
the tables in the real database (`migrations/0001_people.sql`: users, profiles, requests, matches, messages;
`0002_trust.sql`: trust and reports; `0003_posters.sql`: posters; `0004_client_errors.sql`: the error beacon's
reports):

```sh
npx wrangler d1 migrations apply gulabi-gali --remote
```

Do this before the first deploy that serves traffic: the API reads these tables. Later migrations are new
numbered files in `backend/migrations/`, applied with the same command.

### 1b. Clerk (sign-in)

1. Create an application at <https://dashboard.clerk.com>.
2. User & Authentication: turn **Email** on with **email verification code** as the method, and turn
   **Google** on.
3. Set the allowed origin to `https://gulabi-gali.manishbisht.me` (Clerk, Configure, Domains / allowed
   origins), so Clerk accepts sign-ins from the site. The Worker also checks that a token was minted for one
   of our origins.
4. From Clerk's API keys page, set two secrets on the Worker (from `backend/`):

   ```sh
   npx wrangler secret put CLERK_SECRET_KEY
   npx wrangler secret put CLERK_JWT_KEY < key.pem
   ```

   `CLERK_SECRET_KEY` is the `sk_...` key; the command asks for it. `CLERK_JWT_KEY` is the instance's PEM
   public key (API keys, "Show JWT public key", PEM): save it as `key.pem` and pipe it in as above, since the
   interactive prompt takes a single line and would cut the PEM off after its first. Delete `key.pem`
   afterwards. With the JWT key the Worker verifies tokens without calling Clerk; with only the secret key it
   fetches Clerk's key set and caches it. Set both. Without either, every token is refused and everyone is a
   ghost.

   Before the Worker has ever been deployed, `wrangler secret put` finds no Worker to attach the secret to:
   when it offers to create one, say yes (or deploy once first, then set the secrets). Secrets survive later
   deploys.

5. The publishable key (`pk_...`) goes to GitHub as `VITE_CLERK_PUBLISHABLE_KEY`, in section 2.
   The moderator: once you have signed in on the site, copy your Clerk user id (Clerk, Users, `user_...`) and
   set it as a Worker secret, `npx wrangler secret put ADMIN_USER_IDS`, as `clerk:user_...` (comma-separate
   more than one). Then `#/admin` on the site is the moderation page for that account, and a 404 for
   everyone else.

   > **Never put a `dev:` id (such as `dev:owner`) in the production `ADMIN_USER_IDS`.** Those belong to the
   > local name-only sign-in. The Worker ignores `dev:` ids unless `DEV_AUTH=1` as a second guard, but the
   > secret must only ever hold `clerk:` ids.

   **The cap and the waitlist.** `MAX_LIVE` in `backend/wrangler.jsonc` (default `"300"`) is how many residents
   the whole city shows at once; anyone more waits in line as a ghost and can leave an email. No email is ever
   sent by the site: when there is room, download the list from the admin page (Download waitlist CSV) and
   write to people yourself. Raise the cap by editing the var and deploying.

6. **A production instance needs DNS.** Clerk's development instance works anywhere, but a production
   instance only starts once its DNS records are in place: Clerk, Configure, Domains lists them. They are the
   **Frontend API** `CNAME` (`clerk.gulabi-gali.manishbisht.me` pointing at Clerk), the **email DKIM**
   `CNAME`s (so sign-in codes are not sent as spam), and any others it lists. Add each at the DNS host
   (DNS only, grey cloud, on Cloudflare) and wait for Clerk to show them verified before switching the site
   to the production `pk_live_...` key.
7. **Smoke check** once the site and the API are both up: sign in on the real site once, then confirm the
   API accepts the session. In the browser's developer tools, the Network tab shows a request to
   `https://api.gulabi-gali.manishbisht.me/api/me`; it must answer **200** with your id. A 401 means the
   Worker refused the token: check both secrets above, and that the site's origin is one Clerk allows.

## 2. GitHub Pages (`frontend/`)

1. Settings, Pages, Source: GitHub Actions.
2. Settings, Environments, `github-pages`, add the secret `VITE_API_BASE_URL`: the API origin, e.g.
   `https://api.gulabi-gali.manishbisht.me` (no trailing slash). The build job bakes it in as `VITE_API_URL`
   and into the page's Content-Security-Policy.
   A production build **fails** without it ("VITE_API_URL is not set"), so a site that points at a local
   Worker cannot ship by accident. To build against a local Worker on purpose (the e2e job, a local preview)
   set `GG_ALLOW_LOCAL_API=1`; `playwright.config.ts` already does.
3. In the same `github-pages` environment add the secret `VITE_CLERK_PUBLISHABLE_KEY`: Clerk's `pk_...`
   publishable key. The build bakes it in, which switches the site to Clerk sign-in. While it is empty the
   site builds in "none" mode: the city works, but everyone is a ghost and nobody can sign in.
4. Custom domain: Settings, Pages, Custom domain, `gulabi-gali.manishbisht.me` (`frontend/public/CNAME`
   already carries it). At the DNS host add `CNAME gulabi-gali -> <github-user>.github.io`. If the zone is
   on Cloudflare, set that record to DNS only (grey cloud) while GitHub issues the certificate. Then tick
   "Enforce HTTPS".

## 2a. Safety (phase 3): what to set and fill in

**Secrets and vars**

- `ADMIN_USER_IDS` (Worker secret): your own id as `clerk:user_...`, comma-separated for more than one. To find
  it, sign in on the live site once, then Clerk dashboard, Users, your user, copy the `user_...` id and prefix
  it with `clerk:`. Never a `dev:` id.
- `MAX_LIVE` (var, default `"300"`): residents shown at once; the rest wait in line. `MAX_IP_SOCKETS` (var,
  default `"24"`): live sockets from one address. Both are in `backend/wrangler.jsonc`; change and deploy.
- Rate limits: `SOCKETS_LIMITER`, `SIGNIN_LIMITER`, `WRITES_LIMITER`, `ERRORS_LIMITER` and `COUNT_LIMITER` use
  namespace ids `51001`, `51002`, `51003`, `51004` and `51005`. They only have to be unique within the Cloudflare
  account; change them if something else uses them.

**The first verified member.** Nobody can send requests until someone is verified, and an invite needs a
verified member to give it. After the first deploy, sign in, open `#/admin`, look yourself up and press
Verify. That gives you 2 invite codes, and everything after flows from invites.

**Migrations.** `0002_trust.sql` is frozen once it is deployed: never edit it. New schema goes in `0003` and
later, and stays additive.

**Local dev after pulling phase 3.** Run `rm -rf backend/.wrangler/state` once (the local D1 and Durable Object
state from phase 2 does not match the phase 3 tables), then apply the migrations again as under Local
development.

**The waitlist.** People who find the city full can leave an email. Nothing is sent from the site: download the
CSV from the admin page and write to them by hand when there is room. The cron deletes each email 90 days after
it was left (the form and the privacy note say so).

**Account deletion and Clerk.** `DELETE /api/me` erases everything in Gulabi Gali, but the Clerk sign-in account
itself is not deleted: that takes the Clerk Backend API and `CLERK_SECRET_KEY`, which the Worker holds but does
not use this way. The privacy note and the delete step tell people their sign-in email stays with Clerk and to
write to `{OWNER_CONTACT}` to have it removed: delete that user in the Clerk dashboard (Users) when they do. A
possible later step is to call Clerk's delete-user endpoint from `deleteAccount` (`backend/src/account.ts`).

**Chats and deletion.** When a chat ends (an unmatch, a block, or either person deleting their account), its last
30 messages are held for 30 days so the other person can still report it, then the cron erases them. The privacy
note and the delete screen say so. Deleting an account also keeps a small tombstone row where something must be
remembered (a ban, a hide, a mute, a 14-day request cooldown), so none of those can be escaped by deleting.

**Fill in before launch**

- `{OWNER_CONTACT}`: the contact in the privacy note and the delete step (`privacyContact`, `privacyDelete` and
  `deleteWhat` in `frontend/src/i18n/strings.ts`, both languages). Replace it with a real email or handle; `grep -n
OWNER_CONTACT frontend/src/i18n/strings.ts` must find nothing afterwards (the tests do not name it). The deploy
  workflow's `check` job fails on `main` while the placeholder is still there, which holds back the whole
  release (the API and the site).
- The word list (`backend/src/filter/words.ts`) needs a review by a native Hindi and Hinglish speaker.

**Pre-launch safety checklist**

- [ ] `ADMIN_USER_IDS` holds only `clerk:` ids, and `#/admin` is a 404 for a second account.
- [ ] Clerk restrictions, if your plan has them (Clerk, Configure, Restrictions): block email subaddresses
      (`name+1@…`) and disposable email domains, so one person cannot make a pile of accounts.
- [ ] `DEV_AUTH`, `DEV_AUTH_SECRET` and `VITE_DEV_AUTH` are set nowhere in production.
- [ ] You verified yourself on the admin page and an invite code redeems for a second account.
- [ ] A ban stops existing invite codes: verify a test account, note one of its unused codes, ban it on the admin
      page, and check the code no longer redeems for a third account (and the ban closed its open reports).
- [ ] `{OWNER_CONTACT}` is filled in and the privacy note reads correctly in both languages.
- [ ] A native speaker has reviewed the word list.
- [ ] File a report from a test account, see the evidence on the admin page, close it, and check the evidence is gone.
- [ ] Block a test account both ways: neither sees the other, and a delete of one leaves the other's block intact.
- [ ] Delete a test account, and check the sign-in then gives a blank profile.
- [ ] `MAX_LIVE` is set to what you want, and the full-city card and waitlist work (admin CSV downloads).
- [ ] Rate limits answer 429 with `Retry-After` on the real domain (the edge sets the connecting address).
- [ ] **On the first real deploy, check the bench keep-awake:** two accounts sit at one bench and talk, then
      leave both clients idle (no typing, no moving) for at least 3 minutes before one reports the other: the
      report must carry the recent lines. If the transcript is empty, the district slept and the keep-awake
      timer is not holding it (see section 3). The fallback then (not built; only if this check fails) is to
      persist each bench's transcript in the district object's SQLite storage with a 10-minute TTL, swept by
      its alarm, instead of keeping it only in memory.
- [ ] Budget alerts are on (section 3).

## 2b. Phase 4 (posters and the extras): what changes at deploy

**Nothing new to set.** Phase 4 adds no secret, var, binding or Durable Object class: `wrangler.jsonc` is
unchanged. The poster pin limit (5 a day per account) is a D1 counter, like the phase 3 per-account limits, and
pins also pass through the existing `WRITES_LIMITER`. Posters are text only: no images, so no storage bucket.

**Migration `0003_posters.sql`.** It adds the `posters` table and `reports.poster_id`; `poster_owners` (a 7-day
memory of who pinned a poster that came down, filled by a trigger on every delete from `posters`, so a block from
a poster that went meanwhile still works); and a random `handle` on each `blocks` row (the block list shows that,
never the blocked person's id). Additive like `0002`. The
deploy job applies it before the Worker that needs it ships (see section 3); by hand it is the same
`npx wrangler d1 migrations apply gulabi-gali --remote` from `backend/`. Once deployed it is frozen: new schema
goes in `0004` and later.

**Moderating posters.** Poster reports come into the admin page's queue with the other reports about the
poster's owner, showing the poster's text, district, wall and time. **Take the poster down** removes it from
every wall at once and closes every open report on it; banning the owner takes all their posters down too.
Three reports on one poster from verified members whose accounts are at least a week old hide it on their own
until you act; reports from anyone else are queued but do not hide it. Each poster report says whether its
poster is up, hidden or gone. A hidden poster still counts toward its owner's two; they see it greyed on their
own walls and can take it down, and nobody else sees it. **Dismissing** its last open report puts it back up on
every wall (unless you actioned one of its reports: then it stays hidden until it expires or comes down).
Expired posters, and the 7-day memory of who pinned posters that came down, are deleted by the same 15-minute
cron as everything else.

**The public poster list is edge-cached.** Signed out, `GET /api/districts/:id/posters` is served through the
Cache API for 30 s per district (keyed by district on the API's own origin, the `API_ORIGIN` var in `backend/wrangler.jsonc`, whatever the query string), so it cannot
be used to hammer D1. A change drops the entry at once in the location that made it; elsewhere a hidden or removed
poster drops out within the 30 s. On a `workers.dev` route the Cache API does nothing (every call reads D1); on the
custom domain it works. If you move the API to another domain, change `API_ORIGIN` with it (unset, the key
falls back to the request's own origin).

**The extras need nothing at deploy.** Autos, the metro ride, street animals, processions, the kite fight and
the bandar run in the page only and are not sent to the Worker (an auto driver's moves carry a flag, so the
district allows auto speed). They cost no Worker requests, D1 or Durable Object time beyond the moves people
already send.

**Pre-launch checks for phase 4**

- [ ] From a verified test account, pin a poster with a time on a Walled City wall; a second browser in the
      same district sees it appear without a reload.
- [ ] Report it from another account, see it on the admin page with its text and wall, take it down, and check
      it leaves the wall in the second browser and the report is closed.
- [ ] Hide a test poster with three week-old verified reporters (or set `hidden = 1` on its row): its owner sees
      it greyed and can take it down; dismissing its reports on the admin page puts it back up.
- [ ] Block from a poster card, then take that poster down from its owner's account before confirming: the
      block still goes through, and the blocker's block list shows only the first name.
- [ ] Look at the Galta bandar on a phone, near Jantar Mantar with a safa or cap on (its rooftop run has only
      been checked in tests), and switch it off with the 🐒 chip.
- [ ] Drive an auto with two accounts in the district: the other sees the driver sitting in an auto.

## 2c. Launch readiness: link preview, analytics and errors

**Link preview.** `frontend/index.html` carries the description, Open Graph and Twitter tags that Instagram,
WhatsApp and X read when someone shares the link, with `og:url` and `og:image` as absolute URLs on
`https://gulabi-gali.manishbisht.me/`. The image is `frontend/public/og.png` (1200x630, a real render of the
Walled City). To make it again after the city changes: `npm run og-image -w frontend` (it builds the site with
test hooks, renders the street at 1200x630 at golden hour with the HUD hidden and a small wordmark, cuts it to
a 256-colour palette with `sharp` (installed with the backend's test tools; without it the raw shot is written,
which may be bigger than the 300 kB scrapers like), and writes it with `apple-touch-icon.png`; look at it before
committing). If the domain changes, change the URLs in `index.html` with it. After deploying, paste the link into
a WhatsApp chat to yourself, or Facebook's Sharing Debugger (Instagram uses the same scraper), to see the card;
both cache a card for a while, so a changed image can take a day to show.

**Cloudflare Web Analytics (optional, cookieless).** Page views and visitors, with no cookie and nothing stored
on the phone. In the Cloudflare dashboard: Analytics & Logs, Web Analytics, Add a site, enter
`gulabi-gali.manishbisht.me`, and choose the JavaScript snippet (not automatic setup: the site is on GitHub
Pages, not proxied by Cloudflare). Copy the `token` value out of the snippet (a 32-character hex string) and add
it to the `github-pages` environment as the secret `VITE_CF_BEACON_TOKEN`. The next build puts the beacon
(`https://static.cloudflareinsights.com/beacon.min.js`) in the page and adds exactly two hosts to the CSP:
`static.cloudflareinsights.com` to `script-src` and `cloudflareinsights.com` to `connect-src`. Without the
secret (and always in dev and e2e) there is no beacon and the CSP is unchanged. The privacy sheet follows the
same switch (`__GG_ANALYTICS__`, `src/buildFlags.ts`): only a build with the token has the line saying that
Cloudflare, an outside company, counts the visits, without cookies. Numbers show in the same Web
Analytics page, usually within minutes.

**Where errors show.** The page reports what breaks on people's phones to the Worker's own
`POST /api/errors` (window errors, unhandled promise rejections, a lost WebGL context, and the React
crash screen): never a third-party service. A report holds the error message and the first 1 kB of its stack,
where it was caught, mobile or desktop and whether it was inside Instagram or Facebook, the build's git short
sha and the district: no account id, name, email or typed text, and URLs lose their query strings (the
Worker scrubs them again). A page sends at most 5, each distinct error once. The Worker takes 20 a minute per
address and bodies of at most 4 kB, keeps them in D1 (`client_errors`, migration `0004`) and the 15-minute cron
deletes them after 14 days. The per-address limit is asked of the `ERRORS_LIMITER` rate-limiting binding first
(namespace `51004` in `backend/wrangler.jsonc`, 20 a minute; nothing to create, it ships with the Worker), so a
flood is refused before anything is written to D1; then a D1 count per address, then a city-wide ceiling of 300
stored reports an hour from all addresses together (`ERROR_GLOBAL_LIMIT`). With the 14-day purge that keeps the
table to about 100,000 rows at the very most; past the ceiling reports are refused (429) until the hour turns, so
in a real outage the admin page still has the hour's worth to group. Read them on the admin page (`#/admin`), section **Errors**: the 20 most frequent
errors, each with its count, when it was last seen, the browser kinds it came from, the build, the district
and a sample stack (Refresh asks again). Nothing new to set: no secret, var or binding.

**Pre-launch checks for launch readiness**

- [ ] Share the live link in a WhatsApp chat and an Instagram DM to yourself: the card shows the street image,
      the title and the description.
- [ ] With `VITE_CF_BEACON_TOKEN` set, open the site and see a visit in Web Analytics; the browser console shows
      no CSP error.
- [ ] Open the admin page and see the Errors section (empty is fine). To see one arrive, run
      `Promise.reject(new Error('launch check'))` in the browser console on the city page.
- [ ] Open the site fresh (a private window) on a phone: the three-step hint shows once after Padharo! and
      not again after a reload.

## 2d. Who's here and links to a place

**The welcome screen's count.** `GET /api/count` (public, no sign-in) answers `{ "people": n }`: how many
residents others can see in the city now. Only the gate's live slots count, so never a ghost, someone hidden or
banned, someone waiting in line, or someone whose last socket just closed. Below 3 it says 0 (the page says
"Abhi shaant hai — pehle aao"), 3 to 9 as they are, and from 10 a multiple of 5 rounded down (the page shows
"10+"). One number for the city: no names, ids or districts. Each Cloudflare location keeps the answer in its
edge cache for 30 s (one GateDO read per location per 30 s, shared by misses that land together); browsers keep
no copy. Per address it goes through
the `COUNT_LIMITER` rate-limiting binding (namespace `51005` in `backend/wrangler.jsonc`, 120 a minute; nothing
to create, it ships with the Worker). The page asks on the welcome screen and every 30 s while it shows; a
failure just leaves the line empty. Deploy the Worker before the site, as always: until then the line stays
empty.

**Links to a place ("Bulao").** Landmark cards, the bench panel (both as a share icon) and every row of the map's
place list have a "Bulao" button: the phone's share sheet (or, without one, the clipboard) with a short line and
`https://gulabi-gali.manishbisht.me/?at=<district>:<place>`. The link names a place and nothing else, never who
sent it. Opening it shows the welcome screen as usual; after Padharo! the city opens in that district with the
visitor standing at the place, and the `at` part leaves the address bar. A place a district does not have opens
at the usual spawn. Nothing to set.

**Pre-launch checks**

- [ ] Open the site with nobody on: the welcome screen says "Abhi shaant hai — pehle aao". With three phones in
      the city (visible, not ghosts), it says "3 log abhi gali mein" within 30 s.
- [ ] On a phone, open a landmark card, press Bulao and send the link to yourself on WhatsApp; open it, press
      Padharo! and land by that landmark with its card up.

## 3. Budget alerts

Cloudflare dashboard, Notifications, Add:

- **Billing: usage-based billing** alert on Workers Paid, set a little over the plan's base so a runaway
  loop emails you before it costs anything real.
- **Workers: usage** (requests and CPU) notification for `gulabi-gali-api`.

The city snapshot is one cron every 15 minutes plus cached reads (`cache-control: public, max-age=300`). Phase 2
adds Durable Object requests and duration (live sockets; hibernation means an idle district costs almost
nothing), D1 reads and writes, and Worker requests for the API, so watch those on the same dashboard.

Bench chat is kept only in the district object's memory, by design. While a bench has a line from the last ten
minutes, a timer keeps its object from hibernating, so a report can still carry them; but every deploy restarts
every object, and the runtime may evict one anyway. Nothing about it needs backing up, and a deploy in the middle
of an evening empties every bench's last ten minutes (and the memory of who sat where).

The deploy job applies D1 migrations (`wrangler d1 migrations apply gulabi-gali --remote`) before it deploys the
Worker, and on `main` the Pages build waits for that job, so the frontend never ships ahead of the API it talks
to. Keep every migration additive (new tables, new columns with defaults, new indexes), so the Worker still
running between the two steps works against the migrated database.

## Local development

- Node 22 or later (wrangler's floor); `.nvmrc` pins the version CI uses.
- `npm ci` at the repo root.
- `npx wrangler d1 migrations apply gulabi-gali --local --cwd backend`: creates the local tables (once, and after
  each new migration).
- After pulling phase 3, run `rm -rf backend/.wrangler/state` once, then the migrations command above. After
  pulling phase 4 only the migrations command is needed (`0003` is additive). `0003` was edited in place before
  it was ever deployed (the poster tombstones and block handles): a local database that applied an earlier
  `0003` will not apply it again, so reset it once (`rm -rf backend/.wrangler/state`, then the migrations
  command).
- After pulling the launch-readiness work, run the migrations command once more: `0004` (the error beacon's
  table) is additive.
- `npm run dev -w backend -- --var DEV_AUTH:1`: the Worker on `http://127.0.0.1:8787`, with name-only dev
  sign-in. Without the var the API answers 401 to everything but `/api/city`, `/health`, the word list, the
  waitlist, each district's poster list (`/api/districts/:id/posters`, public by design) and the live sockets,
  which then treat you as a ghost.
- `VITE_DEV_AUTH=1 npm run dev -w frontend` shows the dev sign-in sheet. Never for a production build.
- `npm run dev -w frontend`: Vite on `http://localhost:5173`, which talks to `127.0.0.1:8787` by default.
- `npm test`: protocol-copy check plus both workspaces' unit tests.
- `cd frontend && npx playwright test`: every e2e spec, starting the Worker and a production build of the site.
- `node scripts/fake-residents.mjs 60 walled-city`: 60 dev-signed-in residents wandering one district, for
  stress checks; local Worker with `DEV_AUTH=1` only.
- `npm run test:device`: the phone-performance measurement, see [device-performance.md](./device-performance.md).
