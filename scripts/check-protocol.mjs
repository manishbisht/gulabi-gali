import { readFileSync } from 'node:fs'

/** Files the backend owns and the frontend carries a byte-for-byte copy of. */
const COPIES = [
  ['backend/src/protocol.ts', 'frontend/src/net/protocol.ts'],
  ['backend/src/benches.json', 'frontend/src/world/benches.json'],
  ['backend/src/stamps.json', 'frontend/src/world/stamps.json'],
  ['backend/src/filter/normalise.ts', 'frontend/src/filter/normalise.ts'],
  ['backend/src/filter/index.ts', 'frontend/src/filter/index.ts'],
]

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

let failed = false
for (const [backend, frontend] of COPIES) {
  if (read(backend) === read(frontend)) continue
  console.error(`${backend} and ${frontend} differ: edit ${backend} and copy it to ${frontend}`)
  failed = true
}
if (failed) process.exit(1)
