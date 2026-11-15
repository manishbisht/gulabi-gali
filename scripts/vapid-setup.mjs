#!/usr/bin/env node
// Push notifications' VAPID keys, made and stored in one go. The owner runs this once (and again only to
// replace the keys), from the repo root, signed in to both wrangler and gh:
//
//   node scripts/vapid-setup.mjs
//
// It makes a new P-256 key pair in memory and pipes each half straight into the one place it belongs, printing
// neither:
//   - the private key, as a JWK, into the Worker secret VAPID_PRIVATE_JWK (`wrangler secret put`, from backend/);
//   - the public key into the GitHub secret VITE_VAPID_PUBLIC_KEY of the `github-pages` environment
//     (`gh secret set`), which the next site build bakes in.
// Nothing is written to disk. If the Worker step fails, GitHub is not touched; if the GitHub step fails after
// the Worker took its key, run it again (a fresh pair replaces both). Replacing the keys drops every existing
// subscription: each device subscribes again by itself the next time the new site opens there.
import { spawnSync } from 'node:child_process'
import { webcrypto } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Runs `cmd` with `secret` on its stdin; its own output shows, the secret never does. */
function pipeInto(cmd, args, secret, cwd) {
  const run = spawnSync(cmd, args, { cwd, input: secret, stdio: ['pipe', 'inherit', 'inherit'] })
  if (run.error) throw new Error(`${cmd} could not start: ${run.error.message}`)
  if (run.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${run.status})`)
}

async function main() {
  const { subtle } = webcrypto
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const { kty, crv, d, x, y } = await subtle.exportKey('jwk', pair.privateKey)
  const privateJwk = JSON.stringify({ kty, crv, d, x, y })
  const publicKey = Buffer.from(await subtle.exportKey('raw', pair.publicKey)).toString('base64url')

  console.log('VAPID: a new key pair is made (neither half is shown).')
  console.log('1/2 Worker secret VAPID_PRIVATE_JWK (wrangler secret put, from backend/)')
  pipeInto('npx', ['wrangler', 'secret', 'put', 'VAPID_PRIVATE_JWK'], privateJwk, path.join(ROOT, 'backend'))
  console.log('2/2 GitHub secret VITE_VAPID_PUBLIC_KEY (environment github-pages)')
  pipeInto('gh', ['secret', 'set', 'VITE_VAPID_PUBLIC_KEY', '--env', 'github-pages'], publicKey, ROOT)
  console.log(
    'Done. Push turns on once the Worker is deployed and the site is built again (see docs/deployment.md).',
  )
}

main().catch((err) => {
  console.error(`vapid-setup: ${err.message}`)
  process.exit(1)
})
