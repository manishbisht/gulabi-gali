import { readFileSync } from 'node:fs'

const backend = readFileSync(new URL('../backend/src/protocol.ts', import.meta.url), 'utf8')
const frontend = readFileSync(new URL('../frontend/src/net/protocol.ts', import.meta.url), 'utf8')

if (backend !== frontend) {
  console.error(
    'protocol.ts copies differ: edit backend/src/protocol.ts and copy it to frontend/src/net/protocol.ts',
  )
  process.exit(1)
}
