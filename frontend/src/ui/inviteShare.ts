import { t, type Lang } from '../i18n/strings'

/** `ABCD1234` as people read it out: `ABCD-1234`. */
export const showCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`

/** Where a recipient finds the app. */
export const SITE_URL = 'https://gulabi-gali.manishbisht.me'

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

/**
 * Hands a line and a link to someone: the phone's share sheet when there is one, else the clipboard (the line,
 * then the link). A person closing the share sheet is not a failure (`cancelled`); if neither works the caller
 * says so.
 */
export async function shareLink(text: string, url: string): Promise<ShareOutcome> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text, url })
      return 'shared'
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return 'cancelled'
      // no share sheet after all: try the clipboard
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`)
    return 'copied'
  } catch {
    return 'failed'
  }
}

/** Hands a code to someone (see `shareLink`); if that fails the caller shows the code to send by hand. */
export const shareCode = (code: string, lang: Lang): Promise<ShareOutcome> =>
  shareLink(t('inviteShareText', lang, { code: showCode(code) }), SITE_URL)
