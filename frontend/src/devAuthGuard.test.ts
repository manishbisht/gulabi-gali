/// <reference types="node" />
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

function build(env: Record<string, string>) {
  return spawnSync('npx', ['vite', 'build', '--outDir', '/dev/null'], {
    env: { ...process.env, VITE_API_URL: '', GG_ALLOW_LOCAL_API: '', VITE_DEV_AUTH: '', ...env },
    encoding: 'utf8',
  })
}

it('a build with VITE_DEV_AUTH=1 fails unless it is a local-API build', () => {
  const shipped = build({ VITE_DEV_AUTH: '1', VITE_API_URL: 'https://api.example.com' })
  expect(shipped.status).not.toBe(0)
  expect(shipped.stderr).toContain('VITE_DEV_AUTH=1 would ship a sign-in that needs only a name')
}, 30000)
