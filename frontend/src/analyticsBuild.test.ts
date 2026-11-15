/// <reference types="node" />
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

/** The built page and every script, from a production build with or without a Web Analytics token. */
function build(token: string) {
  const out = mkdtempSync(join(tmpdir(), 'gg-analytics-'))
  try {
    const run = spawnSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], {
      env: { ...process.env, VITE_API_URL: 'https://api.example.com', VITE_CF_BEACON_TOKEN: token },
      encoding: 'utf8',
    })
    expect(run.status, run.stderr).toBe(0)
    const html = readFileSync(join(out, 'index.html'), 'utf8')
    const js = readdirSync(join(out, 'assets'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(join(out, 'assets', f), 'utf8'))
      .join('\n')
    return { html, js }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

it('only a build with VITE_CF_BEACON_TOKEN has the beacon, its CSP hosts, and the privacy line about it', () => {
  const on = build('0123456789abcdef0123456789abcdef')
  expect(on.html).toContain('https://static.cloudflareinsights.com/beacon.min.js')
  expect(on.html).toMatch(/script-src [^;]*https:\/\/static\.cloudflareinsights\.com/)
  expect(on.html).toMatch(/connect-src [^;]*https:\/\/cloudflareinsights\.com/)
  // the privacy sheet's section list names the line (the strings table always holds it, unquoted)
  expect(on.js).toMatch(/["'`]privacyAnalytics["'`]/)

  const off = build('')
  expect(off.html).not.toContain('cloudflareinsights')
  expect(off.js).not.toMatch(/["'`]privacyAnalytics["'`]/)
}, 60000)
