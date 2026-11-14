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
2. **D1** (section 1a): create the database, paste its id, apply the migration.
3. **Clerk** (section 1b): create the app, then set the Worker secrets.
4. GitHub `backend` environment and the API domain (section 1, steps 3 to 5); the first push to `main` deploys.
5. GitHub Pages and the `github-pages` secrets, including `VITE_CLERK_PUBLISHABLE_KEY` (section 2).
6. Budget alerts (section 3).

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
the tables (`migrations/0001_people.sql`: users, profiles, requests, matches, messages) in the real database:

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
- Rate limits: `SOCKETS_LIMITER`, `SIGNIN_LIMITER` and `WRITES_LIMITER` use namespace ids `51001`, `51002` and
  `51003`. They only have to be unique within the Cloudflare account; change them if something else uses them.

**The first verified member.** Nobody can send requests until someone is verified, and an invite needs a
verified member to give it. After the first deploy, sign in, open `#/admin`, look yourself up and press
Verify. That gives you 2 invite codes, and everything after flows from invites.

**Migrations.** `0002_trust.sql` is frozen once it is deployed: never edit it. New schema goes in `0003` and
later, and stays additive.

**Local dev after pulling phase 3.** Run `rm -rf backend/.wrangler/state` once (the local D1 and Durable Object
state from phase 2 does not match the phase 3 tables), then apply the migrations again as under Local
development.

**The waitlist.** People who find the city full can leave an email. Nothing is sent from the site: download the
CSV from the admin page and write to them by hand when there is room.

**Account deletion and Clerk.** `DELETE /api/me` erases everything in Gulabi Gali, but the Clerk sign-in account
itself is not deleted: that takes the Clerk Backend API and `CLERK_SECRET_KEY`, which the Worker holds but does
not use this way. The privacy note tells people their Clerk login is separate and is deleted from Clerk. A
possible later step is to call Clerk's delete-user endpoint from `deleteAccount` (`backend/src/account.ts`).

**Fill in before launch**

- `{OWNER_CONTACT}`: the contact line in the privacy note (`privacyContact` in
  `frontend/src/i18n/strings.ts`, both languages). Replace it with a real email or handle; `grep -rn
OWNER_CONTACT frontend/src` must find nothing afterwards.
- The word list (`backend/src/filter/words.ts`) needs a review by a native Hindi and Hinglish speaker.

**Pre-launch safety checklist**

- [ ] `ADMIN_USER_IDS` holds only `clerk:` ids, and `#/admin` is a 404 for a second account.
- [ ] `DEV_AUTH`, `DEV_AUTH_SECRET` and `VITE_DEV_AUTH` are set nowhere in production.
- [ ] You verified yourself on the admin page and an invite code redeems for a second account.
- [ ] `{OWNER_CONTACT}` is filled in and the privacy note reads correctly in both languages.
- [ ] A native speaker has reviewed the word list.
- [ ] File a report from a test account, see the evidence on the admin page, close it, and check the evidence is gone.
- [ ] Block a test account both ways: neither sees the other, and a delete of one leaves the other's block intact.
- [ ] Delete a test account, and check the sign-in then gives a blank profile.
- [ ] `MAX_LIVE` is set to what you want, and the full-city card and waitlist work (admin CSV downloads).
- [ ] Rate limits answer 429 with `Retry-After` on the real domain (the edge sets the connecting address).
- [ ] **On the first real deploy, check the bench keep-awake:** two accounts sit at one bench and talk, wait
      more than a minute, report one: the report must carry the recent lines. If the transcript is empty, the
      district slept and the keep-awake timer is not holding it (see section 3).
- [ ] Budget alerts are on (section 3).

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
Worker. Keep every migration additive (new tables, new columns with defaults, new indexes), so the Worker still
running between the two steps works against the migrated database.

## Local development

- Node 22 or later (wrangler's floor); `.nvmrc` pins the version CI uses.
- `npm ci` at the repo root.
- `npx wrangler d1 migrations apply gulabi-gali --local --cwd backend`: creates the local tables (once, and after
  each new migration).
- After pulling phase 3, run `rm -rf backend/.wrangler/state` once, then the migrations command above.
- `npm run dev -w backend -- --var DEV_AUTH:1`: the Worker on `http://127.0.0.1:8787`, with name-only dev
  sign-in. Without the var the API answers 401 to everything but `/api/city`, `/health` and the live sockets,
  which then treat you as a ghost.
- `VITE_DEV_AUTH=1 npm run dev -w frontend` shows the dev sign-in sheet. Never for a production build.
- `npm run dev -w frontend`: Vite on `http://localhost:5173`, which talks to `127.0.0.1:8787` by default.
- `npm test`: protocol-copy check plus both workspaces' unit tests.
- `cd frontend && npx playwright test`: every e2e spec, starting the Worker and a production build of the site.
- `node scripts/fake-residents.mjs 60 walled-city`: 60 dev-signed-in residents wandering one district, for
  stress checks; local Worker with `DEV_AUTH=1` only.
- `npm run test:device`: the phone-performance measurement, see [device-performance.md](./device-performance.md).
