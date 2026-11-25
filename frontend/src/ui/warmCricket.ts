/** Fetches gali cricket's code (once: the browser keeps the module); rejects if it cannot be had. */
export const loadCricket = (): Promise<unknown> => import('./Cricket')

/** Starts fetching gali cricket (the player has come up to a pitch), so "Cricket khelo" opens at once. */
export function warmCricket(): void {
  void loadCricket().catch(() => {}) // a failed fetch is tried again, and said, when the game is opened
}
