import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'

/**
 * A VAPID key made fresh in memory for this test run only (push tests sign with it), so no key is ever written
 * down or shared with production. The Worker's real one is a secret (scripts/vapid-setup.mjs).
 */
async function testVapidKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const { kty, crv, d, x, y } = await crypto.subtle.exportKey('jwk', pair.privateKey)
  return JSON.stringify({ kty, crv, d, x, y })
}

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
            VAPID_PRIVATE_JWK: await testVapidKey(),
          },
        },
      }),
    ],
  }
})
