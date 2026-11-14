import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { getMe, putProfile, type ProfileInput } from '../net/api'
import type { Me } from '../net/protocol'

export type SaveOutcome = { ok: true } | { ok: false; fields: string[]; words?: true }

/** Who the signed-in visitor is to the server. Null while signed out, loading, or when the API is down. */
export function useMe(): {
  me: Me | null
  refresh(): Promise<void>
  save(p: ProfileInput): Promise<SaveOutcome>
} {
  const { signedIn, token } = useAuth()
  const [fetched, setFetched] = useState<Me | null>(null)

  const refresh = useCallback(async () => {
    const tok = await token()
    if (!tok) return setFetched(null)
    try {
      setFetched(await getMe(tok))
    } catch {
      // keep what we have: the city carries on as a ghost
    }
  }, [token])

  useEffect(() => {
    const ctl = new AbortController()
    void (async () => {
      const tok = await token()
      if (ctl.signal.aborted) return
      if (!tok) return setFetched(null)
      try {
        const next = await getMe(tok, ctl.signal)
        if (!ctl.signal.aborted) setFetched(next)
      } catch {
        // offline or the API is down: stay a ghost
      }
    })()
    return () => ctl.abort()
  }, [token, signedIn])

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

  return { me: signedIn ? fetched : null, refresh, save }
}
