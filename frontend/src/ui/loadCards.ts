/** The picture composer (`cards.ts`), fetched once and kept; a failed fetch is tried afresh next time. */
let pending: Promise<typeof import('./cards')> | null = null

export function loadCards(): Promise<typeof import('./cards')> {
  pending ??= import('./cards').catch((err: unknown) => {
    pending = null
    throw err
  })
  return pending
}

/**
 * Starts fetching the composer and the fonts it draws with, when a picture is about to be asked for (the
 * Postcard frame picked, the Darshan sheet open). The share sheet only opens soon after a tap, so the less the
 * tap has to wait for, the likelier it still counts. Never fails: the tap itself tries again.
 */
export function preloadCards(): void {
  loadCards()
    .then((cards) => cards.fontsReady())
    .catch(() => undefined)
}
