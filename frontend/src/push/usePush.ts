import { useEffect, useRef, useState } from 'react'
import type { Lang } from '../i18n/strings'
import { dropPushIfOn, syncPush } from './push'

/** The query a tapped notification opens the site with (public/sw.js). */
const INBOX_PARAM = 'inbox'
/** What the service worker posts to an open page when its notification is tapped. */
const OPEN_INBOX = 'gg-open-inbox'

export interface PushHookInput {
  /** Sign-in knows who this is (Clerk has loaded). */
  ready: boolean
  signedIn: boolean
  /** A resident: someone with an inbox. */
  resident: boolean
  token: () => Promise<string | null>
  lang: Lang
}

/**
 * The app's side of push notifications:
 *
 * - `inboxAsked`: a tapped notification wants the inbox open, either by opening the site at `?inbox=1` (taken
 *   out of the address at once) or by telling the page that is already open. The app opens it once there is a
 *   resident to open it for, and calls `inboxDone`.
 * - Each visit of a resident refreshes this device's subscription (see `syncPush`), and once nobody is signed
 *   in a device that was on stops getting them.
 */
export function usePush({ ready, signedIn, resident, token, lang }: PushHookInput) {
  const [inboxAsked, setInboxAsked] = useState(
    () => new URLSearchParams(location.search).get(INBOX_PARAM) === '1',
  )
  useEffect(() => {
    const url = new URL(location.href)
    if (!url.searchParams.has(INBOX_PARAM)) return
    url.searchParams.delete(INBOX_PARAM)
    history.replaceState(history.state, '', url)
  }, [])
  useEffect(() => {
    const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null
    if (!sw) return
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { t?: unknown } | null)?.t === OPEN_INBOX) setInboxAsked(true)
    }
    sw.addEventListener('message', onMessage)
    return () => sw.removeEventListener('message', onMessage)
  }, [])

  /** Read when a sync runs: a new token function alone is no reason to send it again. */
  const tokenRef = useRef(token)
  useEffect(() => {
    tokenRef.current = token
  }, [token])
  useEffect(() => {
    if (!ready) return
    if (!signedIn) {
      void dropPushIfOn()
      return
    }
    if (!resident) return
    let live = true
    void tokenRef
      .current()
      .then((tok) => {
        if (live && tok) return syncPush(tok, lang)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [ready, signedIn, resident, lang])

  return { inboxAsked, inboxDone: () => setInboxAsked(false) }
}
