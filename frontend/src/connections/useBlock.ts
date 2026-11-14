import { useCallback, useEffect, useRef, useState } from 'react'
import { t, type Lang } from '../i18n/strings'
import { blockPerson, blockPosterOwner } from '../net/api'

const TOAST_MS = 3500

/** Blocking someone, and the short toast that says it is done. The caller closes whatever was open. */
export function useBlock(token: () => Promise<string | null>, lang: Lang) {
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const run = useCallback(
    async (send: (tok: string) => Promise<boolean>, name: string): Promise<boolean> => {
      const tok = await token().catch(() => null)
      if (!tok || !(await send(tok))) return false
      setToast(t('blockDone', lang, { name }))
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setToast(null), TOAST_MS)
      return true
    },
    [token, lang],
  )
  const block = useCallback((id: string, name: string) => run((tok) => blockPerson(tok, id), name), [run])
  /** Blocks whoever pinned `posterId` (the page never learns their id). */
  const blockPoster = useCallback(
    (posterId: string, name: string) => run((tok) => blockPosterOwner(tok, posterId), name),
    [run],
  )
  return { block, blockPoster, toast }
}
