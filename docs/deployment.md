# Deployment and one-time setup

The site deploys to GitHub Pages at `https://gulabi-gali.manishbisht.me`; the API deploys to a Cloudflare
Worker at `https://api.gulabi-gali.manishbisht.me`. Pushes to `main` deploy both (`.github/workflows/deploy.yml`).
Nothing here has been done yet: the steps below are the owner's, in order.

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
   the zone is moved, comment the `routes` line out, deploy, and use the `workers.dev` URL the deploy prints
   (`https://gulabi-gali-api.<account>.workers.dev`) as `VITE_API_BASE_URL` below. The site's CSP is built
   from `VITE_API_BASE_URL`, so it follows. CORS is keyed on the site's origin (not the API's), so it needs no
   change.
5. Check it: `curl https://api.gulabi-gali.manishbisht.me/health` returns `{"ok":true}`, and
   `/api/city` returns the snapshot. The 15-minute cron fills KV; until its first run `/api/city` fetches live.

## 2. GitHub Pages (`frontend/`)

1. Settings, Pages, Source: GitHub Actions.
2. Settings, Environments, `github-pages`, add the secret `VITE_API_BASE_URL`: the API origin, e.g.
   `https://api.gulabi-gali.manishbisht.me` (no trailing slash). The build job bakes it in as `VITE_API_URL`
   and into the page's Content-Security-Policy.
   A production build **fails** without it ("VITE_API_URL is not set"), so a site that points at a local
   Worker cannot ship by accident. To build against a local Worker on purpose (the e2e job, a local preview)
   set `GG_ALLOW_LOCAL_API=1`; `playwright.config.ts` already does.
3. Custom domain: Settings, Pages, Custom domain, `gulabi-gali.manishbisht.me` (`frontend/public/CNAME`
   already carries it). At the DNS host add `CNAME gulabi-gali -> <github-user>.github.io`. If the zone is
   on Cloudflare, set that record to DNS only (grey cloud) while GitHub issues the certificate. Then tick
   "Enforce HTTPS".

## 3. Budget alerts

Cloudflare dashboard, Notifications, Add:

- **Billing: usage-based billing** alert on Workers Paid, set a little over the plan's base so a runaway
  loop emails you before it costs anything real.
- **Workers: usage** (requests and CPU) notification for `gulabi-gali-api`.

Phase 1 is one cron every 15 minutes plus cached reads (`cache-control: public, max-age=300`), so usage should
sit far inside the Workers Paid allowance.

## Local development

- Node 22 or later (wrangler's floor); `.nvmrc` pins the version CI uses.
- `npm ci` at the repo root.
- `npm run dev -w backend`: the Worker on `http://127.0.0.1:8787`.
- `npm run dev -w frontend`: Vite on `http://localhost:5173`, which talks to `127.0.0.1:8787` by default.
- `npm test`: protocol-copy check plus both workspaces' unit tests.
- `cd frontend && npx playwright test`: every e2e spec, starting the Worker and a production build of the site.
- `npm run test:device`: the phone-performance measurement, see [device-performance.md](./device-performance.md).
