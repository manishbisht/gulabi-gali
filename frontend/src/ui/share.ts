/**
 * How a picture made here (a photo, a postcard, the Darshan card) leaves the site: the phone's share sheet when
 * the browser can share files; in Instagram's in-app browser, which can do neither that nor a download, the
 * picture shown on its own to be pressed and saved (`hold`, see `HoldToSave`); anywhere else, a download.
 */
export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'hold' | 'retry'

/** Instagram's in-app browser says so in its user agent ("Instagram 300.0…"). */
export const isInstagram = (ua: string = navigator.userAgent): boolean => /\bInstagram\b/i.test(ua)

const pad = (n: number) => String(n).padStart(2, '0')

/** `gulabi-gali-<kind>20261115-090507.png`: by the moment, so two pictures never overwrite each other. */
export function pictureName(kind: '' | 'postcard-' | 'darshan-', at = new Date()): string {
  const day = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
  return `gulabi-gali-${kind}${day}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}.png`
}

/** Starts a download of `file`; its object URL is let go once the browser has had it. */
export function download(file: File): void {
  const url = URL.createObjectURL(file)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    link.hidden = true
    document.body.append(link)
    link.click()
    link.remove()
  } finally {
    // the click has already handed the URL to the browser's download
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

/**
 * Hands a PNG over (see the module's note). Closing the share sheet is `cancelled`, not a failure. A share sheet
 * refused because the tap that asked for it is too long ago (`NotAllowedError`: making the picture took a
 * while) is `retry`: the caller keeps the picture and offers a "Share" button, whose fresh tap can open it. A
 * share sheet that fails any other way falls through to the next way. Rejects only if even the download cannot
 * start.
 */
export async function shareImage(blob: Blob, name: string, ua?: string): Promise<ShareOutcome> {
  const file = new File([blob], name, { type: 'image/png' })
  const data = { files: [file] }
  if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
    try {
      if (navigator.canShare(data)) {
        await navigator.share(data)
        return 'shared'
      }
    } catch (err) {
      const name = (err as { name?: string } | null)?.name
      if (name === 'AbortError') return 'cancelled'
      if (name === 'NotAllowedError') return 'retry'
      // the share sheet failed after all: the next way
    }
  }
  if (isInstagram(ua)) return 'hold'
  download(file)
  return 'downloaded'
}
