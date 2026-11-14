import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  // Vitest's five seconds is short for a WebGL scene plus a round trip to the Worker.
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  // One retry on CI, where a shared runner can starve a WebGL frame; a test
  // that only passes on its retry is still reported as flaky, not hidden.
  retries: process.env.CI ? 1 : 0,
  webServer: [
    {
      command: 'npm run dev -w backend',
      cwd: '..',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      // The built bundle, not the dev server. Vite transforms modules on
      // request, and across a whole run — specs that pull in the 3D
      // scene — a dynamic import eventually stops arriving and the page lands
      // on the chunk-error screen. Static hashed chunks do not do that, and
      // they are also what actually ships.
      // GG_ALLOW_LOCAL_API: this bundle talks to the local Worker on purpose.
      command:
        'GG_ALLOW_LOCAL_API=1 npm run build && npm run preview -- --port 5173 --host 127.0.0.1 --strictPort',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    // Installed Chrome locally (its GPU path is the one players have); CI has
    // no Chrome, so it runs Playwright's own Chromium (`npx playwright install
    // chromium`).
    channel: process.env.CI ? undefined : 'chrome',
    headless: true,
    viewport: { width: 1440, height: 960 },
    screenshot: 'only-on-failure',
    // On CI a failure has to explain itself from an artifact alone.
    trace: process.env.CI ? 'retain-on-failure' : 'off',
  },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
})
