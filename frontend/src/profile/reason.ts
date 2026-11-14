import { MAX_REASON, MIN_REASON } from '../net/protocol'

/** Code points, as the server counts them (an emoji is one, not two). */
export const points = (text: string) => [...text].length

/** The same cleaning the server does: NFC, one line, no control or format characters; null unless 10-140. */
export function cleanReason(text: string): string | null {
  const clean = text
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  const n = points(clean)
  return n >= MIN_REASON && n <= MAX_REASON ? clean : null
}
