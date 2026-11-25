import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { StringKey } from '../i18n/strings'
import { shareImage, type ShareOutcome } from './share'

/** A picture made here, with the file name it goes by and the line that says it was saved as a download. */
export interface Picture {
  blob: Blob
  name: string
  saved: StringKey
}

/**
 * What happens to a picture once it is made (see `shareImage`), for photo mode and the Darshan sheet: `hold`
 * is the picture to show alone (Instagram's browser), `retry` the one the share sheet refused because the tap
 * was too long ago (a "Share" button offers it again). When the hold screen closes, focus goes back to `home`
 * (the shutter, "Card banao"), whatever useDialog found focused when it opened.
 */
export function useShareFlow(home: RefObject<HTMLElement | null>) {
  const [hold, setHold] = useState<Picture | null>(null)
  const [retry, setRetry] = useState<Picture | null>(null)
  const held = useRef(false)
  useEffect(() => {
    // after the dialog's own cleanup has put focus back where it found it
    if (held.current && !hold) home.current?.focus()
    held.current = !!hold
  }, [hold, home])

  const share = useCallback(async (picture: Picture): Promise<ShareOutcome> => {
    setRetry(null)
    const outcome = await shareImage(picture.blob, picture.name)
    if (outcome === 'hold') setHold(picture)
    if (outcome === 'retry') setRetry(picture)
    return outcome
  }, [])

  return {
    hold,
    closeHold: useCallback(() => setHold(null), []),
    retry,
    /** A new picture is on its way: the old one's "Share" button goes. */
    forget: useCallback(() => setRetry(null), []),
    share,
  }
}
