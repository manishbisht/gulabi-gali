import { MAX_REASON, MIN_REASON } from '../net/protocol'

/** Code points, as the server counts them (an emoji is one, not two). */
export const points = (text: string) => [...text].length

/**
 * The same cleaning the server does: NFC, one line, no control or format characters; null unless `min` to
 * `max` characters (10-140, for a request's reason and a poster's text alike).
 */
export function cleanReason(text: string, min = MIN_REASON, max = MAX_REASON): string | null {
  const clean = text
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  const n = points(clean)
  return n >= min && n <= max ? clean : null
}
