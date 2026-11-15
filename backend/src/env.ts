import type { DistrictDO } from './district'
import type { GateDO } from './gate'
import type { InboxDO } from './inbox'

export interface Env {
  CITY: KVNamespace
  DB: D1Database
  DISTRICT: DurableObjectNamespace<DistrictDO>
  INBOX: DurableObjectNamespace<InboxDO>
  /** The city's one cap on residents (see `GateDO`), named `GATE_NAME`. */
  GATE: DurableObjectNamespace<GateDO>
  /** Per-address Workers Rate Limiting bindings (wrangler.jsonc `ratelimits`); absent ones limit nothing. */
  SOCKETS_LIMITER?: RateLimit
  SIGNIN_LIMITER?: RateLimit
  WRITES_LIMITER?: RateLimit
  /** The API's own origin: the edge-cache key of the posters' signed-out lists (see `wallKey`). */
  API_ORIGIN?: string
  CLERK_SECRET_KEY?: string
  CLERK_JWT_KEY?: string
  /** '1' enables /api/dev/login and dev tokens. Set only in .dev.vars and tests, never in wrangler.jsonc. */
  DEV_AUTH?: string
  DEV_AUTH_SECRET?: string
  /**
   * Who may use `/api/admin/*`: full user ids (`clerk:user_…`, or `dev:owner` locally), comma-separated. A
   * secret in production, a `--var` in e2e, never in wrangler.jsonc. Unset or empty: nobody.
   */
  ADMIN_USER_IDS?: string
  /** The most sockets one district holds at once, ghosts and residents alike. A number; 400 when unset. */
  MAX_DISTRICT_SOCKETS?: string
  /** The most sockets one district holds from one address (an IPv6 /64). A number; 24 when unset. */
  MAX_IP_SOCKETS?: string
  /** The most residents seen at once across the city (see `GateDO`). A number; 300 when unset. */
  MAX_LIVE?: string
}
