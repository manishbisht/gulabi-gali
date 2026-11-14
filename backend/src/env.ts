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
}
