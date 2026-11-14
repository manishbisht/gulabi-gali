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
          // Dev auth exists only in tests and .dev.vars, never in wrangler.jsonc.
          bindings: { DEV_AUTH: '1', DEV_AUTH_SECRET: 'test-secret', TEST_MIGRATIONS: migrations },
        },
      }),
    ],
  }
})
