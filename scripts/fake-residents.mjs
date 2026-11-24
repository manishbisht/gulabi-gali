#!/usr/bin/env node
/**
 * A crowd for the stress check: dev-logs in <n> residents, finishes their profiles and opens one live socket
 * each in <district>, where they wander about near the spawn point at walking pace until Ctrl-C (or for
 * [seconds], when given).
 *
 *   node scripts/fake-residents.mjs 60 walled-city [seconds]
 *
 * Only against a local Worker running DEV_AUTH=1 (`npm run dev -w backend -- --var DEV_AUTH:1`);
 * GG_API overrides the origin, http://127.0.0.1:8787 by default.
 */
const [nArg = '60', district = 'walled-city', secondsArg] = process.argv.slice(2)
const n = Number(nArg)
const API = (process.env.GG_API ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')
const WS = API.replace(/^http/, 'ws')

/** Where each district's player starts (the `spawn` in frontend/src/world/districts/*.ts). */
const SPAWNS = {
  'walled-city': { x: 1.5, z: 44 },
  'mi-road': { x: 2, z: 54 },
  university: { x: -40, z: 42 },
  'malviya-nagar': { x: 6, z: 46 },
  amer: { x: 34, z: 31 },
  nahargarh: { x: 50, z: 40 },
}
const OUTFITS = ['pink', 'terracotta', 'sandstone', 'ochre', 'white', 'teal', 'marigold', 'road', 'grass', 'glass']
const HEADS = ['none', 'safa', 'cap', 'dupatta', 'bun']
/** Walking pace, how far from the spawn they roam, and how often they report (the client's 10 Hz). */
const SPEED = 1.4
const ROAM_M = 20
const TICK_MS = 100

if (!Number.isInteger(n) || n < 1 || !(district in SPAWNS)) {
  console.error(`usage: fake-residents.mjs <n> <${Object.keys(SPAWNS).join('|')}> [seconds]`)
  process.exit(2)
}
const home = SPAWNS[district]
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)]

async function call(path, init) {
  const res = await fetch(`${API}${path}`, init)
  if (!res.ok) throw new Error(`${init.method} ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

/** A dev token for `name`, with a complete profile behind it. */
async function signUp(i) {
  const name = `Bheed ${i}`
  const { token } = await call('/api/dev/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  await call('/api/me/profile', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      look: { skin: Math.floor(Math.random() * 5), outfit: pick(OUTFITS), head: pick(HEADS) },
      status: 'bas ghoom rahe hain',
      homeArea: 'Walled City',
      hereFor: null,
      about: '',
      link: null,
      adult: true,
      pledge: true,
      pauseRequests: false,
    }),
  })
  return token
}

/** One wanderer: a socket, and a heading that drifts, turning back toward home past `ROAM_M`. */
function wander(token, stats) {
  const at = { x: home.x + (Math.random() - 0.5) * ROAM_M, z: home.z + (Math.random() - 0.5) * ROAM_M }
  let heading = Math.random() * Math.PI * 2
  const ws = new WebSocket(`${WS}/api/districts/${district}/live?token=${encodeURIComponent(token)}`)
  let timer = null
  ws.onopen = () => {
    stats.open++
    timer = setInterval(() => {
      heading += (Math.random() - 0.5) * 0.6
      if (Math.hypot(at.x - home.x, at.z - home.z) > ROAM_M) heading = Math.atan2(home.x - at.x, home.z - at.z)
      at.x += Math.sin(heading) * SPEED * (TICK_MS / 1000)
      at.z += Math.cos(heading) * SPEED * (TICK_MS / 1000)
      ws.send(JSON.stringify({ t: 'move', x: at.x, z: at.z, ry: Math.atan2(Math.sin(heading), Math.cos(heading)) }))
      stats.sent++
    }, TICK_MS)
  }
  ws.onmessage = (e) => {
    stats.received++
    const m = JSON.parse(e.data)
    if (m.t === 'error' && m.code === 'too-fast') {
      at.x = m.x
      at.z = m.z
    }
    if (m.t === 'error') stats.errors[m.code] = (stats.errors[m.code] ?? 0) + 1
  }
  ws.onclose = (e) => {
    clearInterval(timer)
    stats.open--
    stats.closed[e.code] = (stats.closed[e.code] ?? 0) + 1
  }
  return ws
}

const stats = { open: 0, sent: 0, received: 0, errors: {}, closed: {} }
const tokens = []
for (let i = 0; i < n; i += 10) {
  const batch = Array.from({ length: Math.min(10, n - i) }, (_, j) => signUp(i + j + 1))
  tokens.push(...(await Promise.all(batch)))
}
const sockets = tokens.map((t) => wander(t, stats))
console.log(`${n} residents signed up; wandering ${ROAM_M} m around ${district} spawn (${home.x}, ${home.z})`)

const report = setInterval(() => console.log(JSON.stringify(stats)), 5000)
function stop() {
  clearInterval(report)
  for (const ws of sockets) ws.close(1000, 'done')
  console.log(JSON.stringify(stats))
  setTimeout(() => process.exit(0), 300)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
if (secondsArg) setTimeout(stop, Number(secondsArg) * 1000)
