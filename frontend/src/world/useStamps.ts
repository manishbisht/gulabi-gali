import { useCallback, useEffect, useRef, useState } from 'react'
import type { Lang } from '../i18n/strings'
import { t } from '../i18n/strings'
import { putStamps } from '../net/api'
import type { LandmarkDef, Vec2 } from './types'
import { claim, collect, collected, mergeStamps, nearestLandmark, park, release, STAMPS } from './stamps'

const TOAST_MS = 3500

/** A resident whose stamps the server keeps too. Null for a ghost: their stamps stay on this device. */
export interface StampAccount {
  /** Who they are: a different one starts the syncing afresh. */
  id: string
  token(): Promise<string | null>
  /** The stamps the server last said they hold (their profile's). Missing (an older Worker) reads as none. */
  stamps?: readonly string[]
}

/** A stamp the server knows: a save from an older page may hold one that is no longer a landmark. */
const known = (id: string) => STAMPS.some((s) => s.id === id)

/** A set's identity, whatever its order. */
const keyOf = (ids: readonly string[]) => [...ids].sort().join(',')

/**
 * Landmark proximity, stamp collection and the toast, so App stays thin. For a resident it also keeps the
 * server's copy: their profile's stamps join the ones here, and whenever this device holds one the server has
 * not confirmed (on sign-in, after each new stamp) the set is pushed, and the answer (everything the server
 * holds) joins too. A failed push is silent and is tried again on the next stamp or the next load; nothing
 * here ever waits on the server.
 *
 * The set on the device is tagged with the account it belongs to (`claim`, once that account has a profile);
 * an untagged one is a ghost's, or an account that has no profile yet, and is never touched. With no account
 * (a ghost, a lost token, a profile still loading) a tagged set is parked in its account's stash, not shown
 * and not wiped (`park`); that account gets it back, and pushes what the server never confirmed, when it next
 * has a profile. Only on a sign-out after `claim` ran, and with every stamp confirmed on the server, is the set
 * cleared outright. No other account ever receives or pushes it.
 */
export function useStamps(lang: Lang, account: StampAccount | null) {
  const [near, setNear] = useState<LandmarkDef | null>(null)
  const [have, setHave] = useState(() => {
    if (!account) park() // a page that opens with a set tagged to someone must not show it as the street's
    return collected()
  })
  const [toast, setToast] = useState<string | null>(null)
  const nearRef = useRef<LandmarkDef | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const langRef = useRef(lang)
  useEffect(() => {
    langRef.current = lang
  }, [lang])
  useEffect(() => () => clearTimeout(timer.current), [])

  const user = account?.id ?? null
  const token = account?.token
  const serverKey = account ? keyOf(account.stamps ?? []) : null
  const serverStamps = useRef<readonly string[]>([])
  /** The resident now: an answer for anyone else is dropped. */
  const userRef = useRef(user)
  const stamps = account?.stamps
  useEffect(() => {
    serverStamps.current = stamps ?? []
    userRef.current = user
  }, [stamps, user])
  /** The set the server is known to hold for `user`, and the one being pushed now. */
  const synced = useRef<{ user: string; key: string } | null>(null)
  const pushing = useRef<{ user: string; key: string } | null>(null)

  /** The stamps the server is known to hold for `user`: the profile's, and every push answer. */
  const confirmed = useRef<ReadonlySet<string>>(new Set())
  /** The account `claim` ran for, until it has none again. */
  const claimedFor = useRef<string | null>(null)

  // Before anything is merged or pushed. With a profile: the set is this account's (see `claim`). Without one
  // after having had one (a sign-out, a lost token): cleared when the server holds all of it, else parked.
  useEffect(() => {
    const was = claimedFor.current
    claimedFor.current = user
    let changed: boolean
    if (user) changed = claim(user)
    else {
      synced.current = null
      pushing.current = null
      const all = was !== null && collected().every((id) => confirmed.current.has(id))
      if (all) release()
      else park()
      changed = true
    }
    confirmed.current = new Set()
    if (!changed) return
    const next = collected()
    // the device's storage changed under the page (an external system): show what it holds now
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHave((was) => (keyOf(was) === keyOf(next) ? was : next))
  }, [user])

  // What the profile says the server holds joins the stamps here (a second device's show up).
  useEffect(() => {
    if (!user || serverKey === null) return
    synced.current = { user, key: serverKey }
    confirmed.current = new Set(serverStamps.current)
    if (mergeStamps(serverStamps.current)) setHave(collected())
  }, [user, serverKey])

  // Anything here the server has not confirmed goes up; what comes back joins the stamps here.
  useEffect(() => {
    if (!user || !token) return
    const local = collected().filter(known)
    const key = keyOf(local)
    const same = (s: { user: string; key: string } | null) => s?.user === user && s.key === key
    if (same(synced.current) || same(pushing.current)) return
    pushing.current = { user, key }
    void (async () => {
      const tok = await token().catch(() => null)
      const answer = tok ? await putStamps(tok, local) : null
      if (same(pushing.current)) pushing.current = null
      if (!answer || userRef.current !== user) return
      synced.current = { user, key: keyOf(answer) }
      confirmed.current = new Set(answer)
      if (mergeStamps(answer)) setHave(collected())
    })()
  }, [user, token, serverKey, have])

  const collectHere = useCallback(() => {
    const landmark = nearRef.current
    if (!landmark || !collect(landmark.id)) return
    setHave(collected())
    setToast(t('stampGot', langRef.current, { place: landmark.name[langRef.current] }))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  /** Call every frame; re-renders only when the nearby landmark changes. Returns that landmark. */
  const track = useCallback(
    (pos: Vec2, landmarks: LandmarkDef[], pressed: boolean) => {
      const found = nearestLandmark(pos, landmarks)
      if (found?.id !== nearRef.current?.id) {
        nearRef.current = found
        setNear(found)
      }
      if (pressed) collectHere()
      return found
    },
    [collectHere],
  )

  return { near, have, toast, collectHere, track }
}
