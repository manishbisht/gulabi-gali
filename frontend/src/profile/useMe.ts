import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { BannedError, getMe, putProfile, type ProfileInput } from '../net/api'
import type { Me } from '../net/protocol'

export type SaveOutcome = { ok: true } | { ok: false; fields: string[]; words?: true }

/**
 * Who the signed-in visitor is to the server. Null while signed out, loading, or when the API is down.
 * `banned`: the server said this account is banned (and `me` stays null).
 */
export function useMe(): {
  me: Me | null
  banned: boolean
  refresh(): Promise<void>
  save(p: ProfileInput): Promise<SaveOutcome>
} {
  const { signedIn, token } = useAuth()
  const [fetched, setFetched] = useState<Me | null>(null)
  /** The token getter the server said was banned: a ban belongs to that sign-in, never to the next one. */
  const [bannedFor, setBannedFor] = useState<(() => Promise<string | null>) | null>(null)
  const got = useCallback((next: Me) => {
    setFetched(next)
    setBannedFor(null)
  }, [])
  const failed = useCallback((err: unknown, of: () => Promise<string | null>) => {
    if (!(err instanceof BannedError)) return
    setFetched(null)
    setBannedFor(() => of)
  }, [])

  const refresh = useCallback(async () => {
    const tok = await token()
    if (!tok) return setFetched(null)
    try {
      got(await getMe(tok))
    } catch (err) {
      // anything but a ban keeps what we have: the city carries on as a ghost
      failed(err, token)
    }
  }, [token, got, failed])

  useEffect(() => {
    const ctl = new AbortController()
    void (async () => {
      const tok = await token()
      if (ctl.signal.aborted) return
      if (!tok) return setFetched(null)
      try {
        const next = await getMe(tok, ctl.signal)
        if (!ctl.signal.aborted) got(next)
      } catch (err) {
        // offline or the API is down: stay a ghost
        if (!ctl.signal.aborted) failed(err, token)
      }
    })()
    return () => ctl.abort()
  }, [token, signedIn, got, failed])

  const save = useCallback(
    async (input: ProfileInput): Promise<SaveOutcome> => {
      const tok = await token()
      if (!tok) return { ok: false, fields: [] }
      try {
        const res = await putProfile(tok, input)
        if (res.ok) setFetched(res.me)
        return res.ok ? { ok: true } : res
      } catch {
        return { ok: false, fields: [] }
      }
    },
    [token],
  )

  return { me: signedIn ? fetched : null, banned: signedIn && bannedFor === token, refresh, save }
}
