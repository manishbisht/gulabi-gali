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

/** Today's IST date, turning over at midnight IST with a single timer (never a per-frame check). */
function useIstDay(): string {
  const [day, setDay] = useState(() => istDay(Date.now()))
  useEffect(() => {
    const timer = setTimeout(() => setDay(istDay(Date.now())), nextIstMidnight(Date.now()) - Date.now() + 50)
    return () => clearTimeout(timer)
  }, [day])
  return day
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
  const day = useIstDay()
  const goal = useMemo(() => override ?? goalFor(day), [override, day])
  const user = account?.id ?? null
  const serverKey = keyOf(account?.today)
  const [record, setRecord] = useState<TodayRecord>(() =>
    account ? (account.today ?? NO_RECORD) : localRecord(),
  )
  const [toast, setToast] = useState<number | null>(null)

  const fromServer = useRef(account?.today)
  const tokenRef = useRef(account?.token)
  const userRef = useRef(user)
  const today = account?.today
  const token = account?.token
  useEffect(() => {
    fromServer.current = today
    tokenRef.current = token
    userRef.current = user
  }, [today, token, user])

  // whose record it is: a ghost's from the device, a resident's from the server's last word
  useEffect(() => {
    // the record belongs to whoever this is now (an external source: the device, or the profile's answer)
    setRecord(user ? (fromServer.current ?? NO_RECORD) : localRecord())
  }, [user, serverKey])

  /** Marks `on` done on the server for `who`; the answer replaces the record, a failure stays pending. */
  const mark = useCallback(async (who: string, on: string) => {
    setPendingDay(who, on)
    const tok = await tokenRef.current?.().catch(() => null)
    const answer = tok ? await putToday(tok, on) : null
    if (!answer || userRef.current !== who) return
    setPendingDay(who, '')
    setRecord(answer)
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

  // the deeds: today's goal, met, is done (once)
  const now = useRef({ goal, day, record })
  useEffect(() => {
    now.current = { goal, day, record }
  }, [goal, day, record])
  useEffect(
    () =>
      onDeed((deed) => {
        const { goal, day, record } = now.current
        if (record.last === day || !meets(goal, deed)) return
        const next = advance(record, day)
        now.current = { goal, day, record: next }
        setRecord(next)
        setToast(next.streak)
        const who = userRef.current
        if (who) void mark(who, day)
        else saveLocalRecord(next)
      }),
    [mark],
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
