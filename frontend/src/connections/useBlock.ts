import { useCallback, useEffect, useRef, useState } from 'react'
import { t, type Lang } from '../i18n/strings'
import { blockPerson, blockPosterOwner } from '../net/api'

const TOAST_MS = 3500

/**
 * How a block went: true once done; false when it failed (try again); `gone` when it was from a poster that came
 * down so long ago that its owner is no longer known (there is nobody to block, and trying again will not help).
 */
export type BlockOutcome = boolean | 'gone'

/** Blocking someone, and the short toast that says it is done. The caller closes whatever was open. */
export function useBlock(token: () => Promise<string | null>, lang: Lang) {
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const run = useCallback(
    async <T extends BlockOutcome>(send: (tok: string) => Promise<T>, name: string): Promise<T | false> => {
      const tok = await token().catch(() => null)
      const done = tok ? await send(tok) : false
      if (done !== true) return done
      setToast(t('blockDone', lang, { name }))
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setToast(null), TOAST_MS)
      return done
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
