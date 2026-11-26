import { API_BASE } from './api'
import { reconnecting } from './reconnect'
import { LIVE_CLOSE, type ClientMsg, type DistrictId, type ServerMsg } from './protocol'

/** A resident's moves go out at most this often (10 Hz), and only when they say something new. */
const MOVE_MS = 100
/**
 * A ghost's, at most this often (2 Hz). Nobody sees a ghost; the server only needs its point now and then, to
 * know whose moves are near enough to send it.
 */
const GHOST_MOVE_MS = 500
const MOVE_MIN_M = 0.05
const MOVE_MIN_TURN = (2 * Math.PI) / 180
/** With nothing else sent for this long, a ping keeps the server from calling the socket idle. */
const PING_MS = 10_000
/** Exactly these bytes: the edge answers them without waking the district. */
const PING = '{"t":"ping"}'

export type LiveState = 'connecting' | 'open' | 'closed'

export interface LiveConn {
  /**
   * Sent only while open. A `move` may be held back by the throttle; the next one carries the news. `now`: a
   * move that must not wait (an emote begins or ends where the player stands): it goes at once, however small
   * the step and however soon after the last, unless it says exactly what the last one sent did.
   */
  send(m: ClientMsg, now?: boolean): void
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
  /**
   * A moderator banned this person (close code 4004). It reconnects as usual: the server decides what the
   * next socket is (a ghost, for a banned person), and the page is told so it can ask who it is now.
   */
  onBanned?: () => void
  /** Each change of `state()`, as it happens. */
  onState?: (s: LiveState) => void
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
  const setState = (s: LiveState) => {
    if (s === state) return
    state = s
    opts.onState?.(s)
  }
  const backoff = reconnecting(() => void open())
  let ping: ReturnType<typeof setTimeout> | null = null
  /** When anything last went out, for the idle ping. */
  let lastSend = 0
  /** This socket's move throttle: a resident's or a ghost's, by the token it opened with. */
  let moveMs = MOVE_MS
  /** The last move this socket sent; NaN until it sends one, so the first always goes. */
  let sentAt = -Infinity
  let sentX = NaN
  let sentZ = NaN
  let sentRy = NaN
  /** Whether the last move sent said "driving": getting in or out is news even if nobody moved. */
  let sentV: string | undefined

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
    setState('connecting')
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
    moveMs = token ? MOVE_MS : GHOST_MOVE_MS
    sock.onopen = () => {
      if (ws !== sock) return
      setState('open')
      backoff.opened()
      lastSend = Date.now()
      sentAt = -Infinity
      sentX = sentZ = sentRy = NaN
      sentV = undefined
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
        setState('closed')
        return opts.onReplaced?.()
      }
      if (e.code === LIVE_CLOSE.banned || e.code === LIVE_CLOSE.deleted) opts.onBanned?.()
      setState('connecting')
      backoff.dropped()
    }
  }

  void open()

  return {
    send(m, urgent = false) {
      if (state !== 'open' || !ws) return
      if (m.t === 'move') {
        const now = Date.now()
        if (urgent) {
          if (m.x === sentX && m.z === sentZ && m.ry === sentRy && m.v === sentV) return
        } else {
          if (now - sentAt < moveMs) return
          const moved = Math.hypot(m.x - sentX, m.z - sentZ)
          // NaN (nothing sent yet) compares false both ways, so the first move always goes
          if (moved <= MOVE_MIN_M && turn(m.ry, sentRy) <= MOVE_MIN_TURN && m.v === sentV) return
        }
        sentAt = now
        sentX = m.x
        sentZ = m.z
        sentRy = m.ry
        sentV = m.v
      }
      raw(JSON.stringify(m))
    },
    close() {
      if (state === 'closed') return
      setState('closed')
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
