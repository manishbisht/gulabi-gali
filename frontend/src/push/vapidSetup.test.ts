/// <reference types="node" />
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const SCRIPT = join(import.meta.dirname, '..', '..', '..', 'scripts', 'vapid-setup.mjs')
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/**
 * Runs scripts/vapid-setup.mjs with stand-ins for `npx` (wrangler) and `gh` first on the PATH: each records its
 * arguments, its directory and what it was piped, and exits with the code given. Nothing real is called.
 */
function run(codes: { npx?: number; gh?: number } = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'gg-vapid-'))
  dirs.push(bin)
  for (const name of ['npx', 'gh'] as const) {
    const file = join(bin, name)
    writeFileSync(
      file,
      `#!/bin/sh\necho "$@" > "${bin}/${name}.args"\npwd > "${bin}/${name}.cwd"\ncat > "${bin}/${name}.stdin"\nexit ${codes[name] ?? 0}\n`,
    )
    chmodSync(file, 0o755)
  }
  const out = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: 'utf8',
  })
  const read = (f: string) => (existsSync(join(bin, f)) ? readFileSync(join(bin, f), 'utf8').trim() : null)
  return { out, read }
}

it('pipes the private JWK into wrangler and the public key into gh, and prints neither', async () => {
  const { out, read } = run()
  expect(out.status, out.stderr).toBe(0)
  expect(read('npx.args')).toBe('wrangler secret put VAPID_PRIVATE_JWK')
  expect(read('npx.cwd')).toMatch(/[\\/]backend$/)
  expect(read('gh.args')).toBe('secret set VITE_VAPID_PUBLIC_KEY --env github-pages')
  const jwk = JSON.parse(read('npx.stdin')!) as { kty: string; crv: string; d: string; x: string; y: string }
  const pub = read('gh.stdin')!
  expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256' })
  // The public key the site gets is the private key's own: the uncompressed point 04 || x || y.
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ])
  expect(pub).toBe(point.toString('base64url'))
  // The pair really is one: a signature by the private half verifies with the public half.
  const { subtle } = globalThis.crypto
  const priv = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const verify = await subtle.importKey('raw', point, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'verify',
  ])
  const data = new TextEncoder().encode('gulabi')
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, data)
  expect(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verify, sig, data)).toBe(true)
  // Neither half, nor the private scalar, is ever printed.
  for (const secret of [jwk.d, pub, jwk.x]) {
    expect(out.stdout).not.toContain(secret)
    expect(out.stderr).not.toContain(secret)
  }
})

it('when wrangler fails, GitHub is not touched and it exits non-zero', () => {
  const { out, read } = run({ npx: 1 })
  expect(out.status).toBe(1)
  expect(read('gh.args')).toBeNull()
  expect(out.stderr).toContain('vapid-setup:')
})

it('a fresh pair every run', () => {
  const first = run().read('gh.stdin')
  const second = run().read('gh.stdin')
  expect(first).not.toBe(second)
})
