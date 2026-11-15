import { useCallback, useState, type FormEvent, type ReactNode } from 'react'
import { useLang } from '../i18n/lang'
import { t } from '../i18n/strings'
import { API_BASE } from '../net/api'
import { fetchNoting } from '../net/rateNotice'
import { AuthShell } from './AuthShell'

// The one `gg-` key outside storage.ts: that rule covers localStorage, and this is a per-tab
// sessionStorage token that only exists against a Worker running DEV_AUTH=1.
const KEY = 'gg-dev-token'

function stored(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

function store(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(KEY, token)
    else sessionStorage.removeItem(KEY)
  } catch {
    // blocked storage: the token lives in React state for this page
  }
}

function DevForm({ onToken }: { onToken: (token: string) => void }) {
  const [lang] = useLang()
  const [name, setName] = useState('')
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetchNoting(`${API_BASE}/api/dev/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const { token } = (await res.json()) as { token?: unknown }
      if (typeof token !== 'string' || !token) throw new Error('no token in the answer')
      onToken(token)
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        {t('signInName', lang)}
        <input value={name} maxLength={40} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        {t('signInGo', lang)}
      </button>
      {failed && <p role="alert">{t('signInFailed', lang)}</p>}
    </form>
  )
}

/** Local and e2e sign-in: a name, exchanged at /api/dev/login for a token that lasts the tab. */
export default function DevAuth({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(stored)
  const getToken = useCallback(async () => token, [token])
  const signOut = useCallback(async () => {
    store(null)
    setToken(null)
  }, [])
  return (
    <AuthShell
      mode="dev"
      signedIn={token !== null}
      token={getToken}
      signOut={signOut}
      form={
        <DevForm
          onToken={(next) => {
            store(next)
            setToken(next)
          }}
        />
      }
    >
      {children}
    </AuthShell>
  )
}
