import { API_BASE } from './api'
import { LIVE_CLOSE, type InboxMsg, type InboxNotice } from './protocol'
import { reconnecting } from './reconnect'

/** With nothing else to send, a ping this often keeps phones and proxies from dropping a quiet socket. */
const PING_MS = 25_000
const PING = '{"t":"ping"}'

export interface InboxConn {
  /** For good: no reconnect follows. */
  close(): void
}

export interface InboxOptions {
  /** Read on every (re)connect. Null (signed out, offline) waits and tries again. */
  token: () => Promise<string | null>
  onNotice: (n: InboxNotice) => void
  /** Every time the socket comes up, the first included: fetch the lists, a notice may have gone unheard. */
  onOpen: () => void
  /** Another tab holds the inbox (close code 4001). Nothing reconnects after it. */
  onReplaced?: () => void
  /** No longer a resident (close code 4004: banned, or no profile any more). Nothing reconnects after it. */
  onBanned?: () => void
  WebSocketImpl?: typeof WebSocket
}

/** `ws(s)://<api>/api/inbox?token=` (sockets cannot carry headers). */
export const inboxUrl = (token: string) =>
  `${API_BASE.replace(/^http/, 'ws')}/api/inbox?token=${encodeURIComponent(token)}`

const NOTICES: readonly string[] = ['request', 'accepted', 'message', 'unmatched']

/** A resident's inbox socket, kept up by the same backoff as the district's. */
export function connectInbox(opts: InboxOptions): InboxConn {
  const Impl = opts.WebSocketImpl ?? WebSocket
  const backoff = reconnecting(() => void open())
  let ws: WebSocket | null = null
  let done = false
  let ping: ReturnType<typeof setInterval> | null = null

  const stopPing = () => {
    if (ping) clearInterval(ping)
    ping = null
  }

  async function open() {
    let token: string | null = null
    try {
      token = await opts.token()
    } catch {
      // no token: wait and try again
    }
    if (done) return
    if (!token) return backoff.later()
    let sock: WebSocket
    try {
      sock = new Impl(inboxUrl(token))
    } catch {
      return backoff.later()
    }
    ws = sock
    sock.onopen = () => {
      if (ws !== sock) return
      backoff.opened()
      stopPing()
      ping = setInterval(() => {
        try {
          sock.send(PING)
        } catch {
          // closing under us: onclose follows
        }
      }, PING_MS)
      opts.onOpen()
    }
    sock.onmessage = (e: MessageEvent) => {
      if (ws !== sock || typeof e.data !== 'string') return
      let msg: InboxMsg
      try {
        msg = JSON.parse(e.data) as InboxMsg
      } catch {
        return
      }
      if (msg && NOTICES.includes(msg.t)) opts.onNotice(msg as InboxNotice)
    }
    sock.onclose = (e: CloseEvent) => {
      if (ws !== sock) return
      ws = null
      stopPing()
      if (done) return
      if (e.code === LIVE_CLOSE.replaced) {
        done = true
        return opts.onReplaced?.()
      }
      // banned or hidden: the server would only refuse a reconnect
      if (e.code === LIVE_CLOSE.banned || e.code === LIVE_CLOSE.deleted) {
        done = true
        return opts.onBanned?.()
      }
      backoff.dropped()
    }
  }

  void open()

  return {
    close() {
      if (done) return
      done = true
      backoff.stop()
      stopPing()
      const sock = ws
      ws = null
      try {
        sock?.close(1000, 'bye')
      } catch {
        // already closed
      }
    },
  }
}
