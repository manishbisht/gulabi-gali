/** Starts fetching gali cricket (the player has come up to a pitch), so "Cricket khelo" opens at once. */
export function warmCricket(): void {
  void import('./Cricket').catch(() => {}) // a failed fetch is tried again, and said, when the game is opened
}
