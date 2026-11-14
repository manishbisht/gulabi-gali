import type { DistrictDO } from './district'
import type { InboxDO } from './inbox'

export interface Env {
  CITY: KVNamespace
  DB: D1Database
  DISTRICT: DurableObjectNamespace<DistrictDO>
  INBOX: DurableObjectNamespace<InboxDO>
  CLERK_SECRET_KEY?: string
  CLERK_JWT_KEY?: string
  /** '1' enables /api/dev/login and dev tokens. Set only in .dev.vars and tests, never in wrangler.jsonc. */
  DEV_AUTH?: string
  DEV_AUTH_SECRET?: string
  /** The most sockets one district holds at once, ghosts and residents alike. A number; 400 when unset. */
  MAX_DISTRICT_SOCKETS?: string
  /** The most sockets one district holds from one address (an IPv6 /64). A number; 24 when unset. */
  MAX_IP_SOCKETS?: string
}
