import { API_BASE } from './api'
import { reconnecting } from './reconnect'
import { LIVE_CLOSE, type ClientMsg, type DistrictId, type ServerMsg } from './protocol'

/** Moves go out at most this often (10 Hz), and only when they say something new. */
const MOVE_MS = 100
const MOVE_MIN_M = 0.05
const MOVE_MIN_TURN = (2 * Math.PI) / 180
/** With nothing else sent for this long, a ping keeps the server from calling the socket idle. */
const PING_MS = 10_000
/** Exactly these bytes: the edge answers them without waking the district. */
const PING = '{"t":"ping"}'

export type LiveState = 'connecting' | 'open' | 'closed'

export interface LiveConn {
  /** Sent only while open. A `move` may be held back by the throttle; the next one carries the news. */
  send(m: ClientMsg): void
  /** For good: no reconnect follows. */
  close(): void
  /** `connecting` covers the wait before a reconnect; `closed` is only ever final. */
  state(): LiveState
}

export interface LiveOptions {
  district: DistrictId
  /** Read on every (re)connect. Null connects as a ghost. */
  token: () => Promise<string | null>
  onMsg: (m: ServerMsg) => void
  /** Another tab of the same person took this place over (close code 4001). Nothing reconnects after it. */
  onReplaced?: () => void
  WebSocketImpl?: typeof WebSocket
}

/** `ws(s)://<api>/api/districts/<id>/live`, with `?token=` when there is one (sockets cannot carry headers). */
export function liveUrl(district: DistrictId, token: string | null): string {
  const q = token ? `?token=${encodeURIComponent(token)}` : ''
  return `${API_BASE.replace(/^http/, 'ws')}/api/districts/${district}/live${q}`
}

const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

/** A district socket that keeps itself up: reconnects with backoff, throttles moves and pings when idle. */
export function connectLive(opts: LiveOptions): LiveConn {
  const Impl = opts.WebSocketImpl ?? WebSocket
  let ws: WebSocket | null = null
  let state: LiveState = 'connecting'
  const backoff = reconnecting(() => void open())
  let ping: ReturnType<typeof setTimeout> | null = null
  /** When anything last went out, for the idle ping. */
  let lastSend = 0
  /** The last move this socket sent; NaN until it sends one, so the first always goes. */
  let sentAt = -Infinity
  let sentX = NaN
  let sentZ = NaN
  let sentRy = NaN

  function raw(text: string) {
    try {
      ws!.send(text)
      lastSend = Date.now()
    } catch {
      // Closing under us: onclose follows.
    }
  }

  function armPing(delay: number) {
    ping = setTimeout(() => {
      ping = null
      if (state !== 'open') return
      const quiet = Date.now() - lastSend
      if (quiet >= PING_MS) raw(PING)
      armPing(quiet >= PING_MS ? PING_MS : PING_MS - quiet)
    }, delay)
  }

  function stopTimers() {
    backoff.stop()
    if (ping) clearTimeout(ping)
    ping = null
  }

  function reconnectLater() {
    state = 'connecting'
    backoff.later()
  }

  async function open() {
    let token: string | null = null
    try {
      token = await opts.token()
    } catch {
      // No token to be had: come in as a ghost rather than not at all.
    }
    if (state === 'closed') return
    let sock: WebSocket
    try {
      sock = new Impl(liveUrl(opts.district, token))
    } catch {
      return reconnectLater()
    }
    ws = sock
    sock.onopen = () => {
      if (ws !== sock) return
      state = 'open'
      backoff.opened()
      lastSend = Date.now()
      sentAt = -Infinity
      sentX = sentZ = sentRy = NaN
      armPing(PING_MS)
    }
    sock.onmessage = (e: MessageEvent) => {
      if (ws !== sock || typeof e.data !== 'string') return
      let msg: ServerMsg
      try {
        msg = JSON.parse(e.data) as ServerMsg
      } catch {
        return
      }
      opts.onMsg(msg)
    }
    sock.onclose = (e: CloseEvent) => {
      if (ws !== sock) return
      ws = null
      stopTimers()
      if (state === 'closed') return
      if (e.code === LIVE_CLOSE.replaced) {
        state = 'closed'
        return opts.onReplaced?.()
      }
      state = 'connecting'
      backoff.dropped()
    }
  }

  void open()

  return {
    send(m) {
      if (state !== 'open' || !ws) return
      if (m.t === 'move') {
        const now = Date.now()
        if (now - sentAt < MOVE_MS) return
        const moved = Math.hypot(m.x - sentX, m.z - sentZ)
        // NaN (nothing sent yet) compares false both ways, so the first move always goes
        if (moved <= MOVE_MIN_M && turn(m.ry, sentRy) <= MOVE_MIN_TURN) return
        sentAt = now
        sentX = m.x
        sentZ = m.z
        sentRy = m.ry
      }
      raw(JSON.stringify(m))
    },
    close() {
      if (state === 'closed') return
      state = 'closed'
      stopTimers()
      const sock = ws
      ws = null
      try {
        sock?.close(1000, 'bye')
      } catch {
        // Already closed.
      }
    },
    state: () => state,
  }
}
