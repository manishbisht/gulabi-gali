import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { putToday } from '../net/api'
import type { TodayRecord } from '../net/protocol'
import { onDeed } from './deeds'
import {
  advance,
  goalFor,
  istDay,
  liveStreak,
  localRecord,
  meets,
  nextIstMidnight,
  NO_RECORD,
  pendingDay,
  saveLocalRecord,
  setPendingDay,
  type Goal,
} from './today'

/** How long the "done" toast stays, once the HUD is there to show it. */
const TOAST_MS = 4000

/** A resident, whose record the server keeps. Null for a ghost: theirs stays on this device. */
export interface TodayAccount {
  id: string
  token(): Promise<string | null>
  /** The record `/api/me` carried. Missing: no day done yet (or an older Worker). */
  today?: TodayRecord
}

/**
 * Today's IST date, and a way to read it afresh now. It turns over at midnight IST with a single timer (never a
 * per-frame check); a timer that fires early (or not at all while the phone sleeps or the page is frozen) is
 * caught up when the page shows again (`visibilitychange`, `pageshow`) and is armed again when it finds the day
 * unchanged.
 */
function useIstDay(): [string, () => string] {
  const [day, setDay] = useState(() => istDay(Date.now()))
  /** Bumped by a timer that fired with the day unchanged, so it is armed again. */
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => {
    const fresh = istDay(Date.now())
    setDay(fresh)
    return fresh
  }, [])
  useEffect(() => {
    const wait = Math.max(1000, nextIstMidnight(Date.now()) - Date.now() + 50)
    const timer = setTimeout(() => {
      const fresh = istDay(Date.now())
      if (fresh !== day) setDay(fresh)
      else setTick((n) => n + 1)
    }, wait)
    return () => clearTimeout(timer)
  }, [day, tick])
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('pageshow', refresh)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('pageshow', refresh)
    }
  }, [refresh])
  return [day, refresh]
}

const keyOf = (r: TodayRecord | undefined) => (r ? `${r.last}|${r.streak}|${r.best}` : '')

/**
 * "Aaj ka Darshan": the day's goal, whether it is done, the streak, and the gentle toast when it gets done. It
 * listens for deeds (see `deeds.ts`) and does nothing else: no reminders, no pushes. A ghost's record is kept on
 * this device. A resident's is the server's: a done day is shown at once, marked on the server (which works the
 * streak out itself), and the answer is what stays; a failed mark is kept as pending and tried again on the next
 * load, for that same IST day only. A ghost who did today's goal and then signs in brings today's along.
 * `override` (the test URL's `gg-today`) stands in for the day's own goal. `visible`: the HUD is up, so the
 * toast's time starts.
 */
export function useToday(account: TodayAccount | null, visible: boolean, override: Goal | null = null) {
  const [day, refreshDay] = useIstDay()
  const goal = useMemo(() => override ?? goalFor(day), [override, day])
  const user = account?.id ?? null
  const serverKey = keyOf(account?.today)
  const [record, setRecord] = useState<TodayRecord>(() =>
    account ? (account.today ?? NO_RECORD) : localRecord(),
  )
  const [toast, setToast] = useState<number | null>(null)

  const fromServer = useRef(account?.today)
  /** The server's last word on this resident's record: the profile's, then each answer. */
  const serverRecord = useRef<TodayRecord>(account?.today ?? NO_RECORD)
  const tokenRef = useRef(account?.token)
  const userRef = useRef(user)
  const today = account?.today
  const token = account?.token
  useEffect(() => {
    fromServer.current = today
    tokenRef.current = token
    userRef.current = user
  }, [today, token, user])
  useEffect(() => {
    serverRecord.current = fromServer.current ?? NO_RECORD
  }, [user, serverKey])

  // whose record it is: a ghost's from the device, a resident's from the server's last word
  useEffect(() => {
    // the record belongs to whoever this is now (an external source: the device, or the profile's answer)
    setRecord(user ? (fromServer.current ?? NO_RECORD) : localRecord())
  }, [user, serverKey])

  /**
   * Marks `on` done on the server for `who`; the answer replaces the record. A failure worth trying again stays
   * pending; one the server refused for good (a day it will not take, a phone clock that is off) is dropped,
   * and the record falls back to the server's, so a done day it never took is not kept as done.
   */
  // a day the server refused for good: no second toast or mark for it (a phone clock hours off would otherwise
  // cheer and send again at every deed that meets the goal)
  const refused = useRef('')
  const mark = useCallback(async (who: string, on: string) => {
    setPendingDay(who, on)
    const tok = await tokenRef.current?.().catch(() => null)
    const answer = tok ? await putToday(tok, on) : null
    if (!answer || userRef.current !== who) return
    setPendingDay(who, '')
    if (answer !== 'refused') serverRecord.current = answer
    else refused.current = on
    setRecord(serverRecord.current)
  }, [])

  // a resident's load: a mark that never reached the server, or today's done as a ghost here, goes up now
  useEffect(() => {
    if (!user) return
    const server = fromServer.current ?? NO_RECORD
    if (server.last === day) {
      setPendingDay(user, '')
      return
    }
    const pending = pendingDay(user)
    if (pending && pending !== day) setPendingDay(user, '') // a past day can no longer be marked
    if (pending === day || localRecord().last === day) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- shown at once; the server's answer follows
      setRecord((r) => advance(r, day))
      void mark(user, day)
    }
  }, [user, serverKey, day, mark])

  // the deeds: today's goal, met, is done (once). The day is read afresh at each deed, so a page left open
  // across midnight (a timer late, a phone asleep) matches the new day's goal, never yesterday's.
  const now = useRef({ override, record })
  useEffect(() => {
    now.current = { override, record }
  }, [override, record])
  useEffect(
    () =>
      onDeed((deed) => {
        const day = refreshDay()
        const { override, record } = now.current
        const goal = override ?? goalFor(day)
        if (record.last === day || refused.current === day || !meets(goal, deed)) return
        const next = advance(record, day)
        now.current = { override, record: next }
        setRecord(next)
        setToast(next.streak)
        const who = userRef.current
        if (who) void mark(who, day)
        else saveLocalRecord(next)
      }),
    [mark, refreshDay],
  )

  // the toast's time runs only while it can be seen (not in photo mode, not mid-ride)
  useEffect(() => {
    if (toast === null || !visible) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast, visible])

  return {
    day,
    goal,
    done: record.last === day,
    streak: liveStreak(record, day),
    best: record.best,
    /** The streak the toast celebrates, while it is up. */
    toast: visible ? toast : null,
  }
}
