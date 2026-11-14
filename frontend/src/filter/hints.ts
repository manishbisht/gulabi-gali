import { useEffect, useState } from 'react'
import { API_BASE } from '../net/api'
import { candidates } from './index'

/**
 * Instant word hints. The server is the authority and refuses what the filter refuses; this only warns
 * sooner. It holds SHA-1 hashes, never the words, and fails open: no list, no crypto or a failed fetch all
 * mean "no hint".
 */

const RETRY_MS = 60_000

let hashes: Promise<Set<string> | null> | null = null
let retryAt = 0

/** The hashed list, fetched once (the server lets it be cached for a day); a failure is retried after a minute. */
export function loadHints(): Promise<Set<string> | null> {
  if (hashes) return hashes
  if (Date.now() < retryAt) return Promise.resolve(null)
  const pending: Promise<Set<string> | null> = fetch(`${API_BASE}/api/filter/words.json`)
    .then((res) => (res.ok ? (res.json() as Promise<{ hashes?: unknown }>) : null))
    .then((body) => (Array.isArray(body?.hashes) ? new Set<string>(body.hashes as string[]) : null))
    .catch(() => null)
    .then((set) => {
      if (!set) {
        hashes = null
        retryAt = Date.now() + RETRY_MS
      }
      return set
    })
  hashes = pending
  return pending
}

/** Forgets the list and the retry wait (tests). */
export function resetHints(): void {
  hashes = null
  retryAt = 0
}

const sha1 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

/** True when `text` would be refused. False for anything uncertain. Never rejects. */
export async function hintFlagged(text: string): Promise<boolean> {
  try {
    if (!text.trim() || !globalThis.crypto?.subtle) return false
    const list = await loadHints()
    if (!list) return false
    for (const c of candidates(text)) if (list.has(await sha1(c))) return true
    return false
  } catch {
    return false
  }
}

const DEBOUNCE_MS = 300

/** Whether `text` has gone past the word hint, checked a moment after the last keystroke. */
export function useWordHint(text: string): boolean {
  // The verdict belongs to the text it was made for: older text never shows a newer verdict.
  const [verdict, setVerdict] = useState({ text: '', flagged: false })
  useEffect(() => {
    if (!text.trim()) return
    let live = true
    const timer = setTimeout(
      () => void hintFlagged(text).then((flagged) => live && setVerdict({ text, flagged })),
      DEBOUNCE_MS,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [text])
  return verdict.flagged && verdict.text === text
}
