import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'))
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // Dev auth and the admin list exist only in tests and .dev.vars (a secret in production), never in
          // wrangler.jsonc. `dev:owner` is whoever dev-logs in as "Owner".
          bindings: {
            DEV_AUTH: '1',
            DEV_AUTH_SECRET: 'test-secret',
            ADMIN_USER_IDS: 'dev:owner',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
  }
})
