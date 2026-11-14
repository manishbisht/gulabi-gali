import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // The workerd bundled with the pool is older than wrangler.jsonc's compatibility date and
      // refuses to start under it; tests run on the newest date it supports. Drop this once the
      // pool ships a workerd that knows 2026-11-01.
      miniflare: { compatibilityDate: '2026-08-01' },
    }),
  ],
})
