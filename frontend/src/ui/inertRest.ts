/**
 * Makes every child of `parent` that `keep` does not name inert, and keeps doing it for any child added
 * later (a toast, a card, a sheet that opens while a game is up). The returned function undoes only what this
 * set: a child that was inert already stays so.
 */
export function inertRest(parent: Element | null | undefined, keep: (el: Element) => boolean): () => void {
  if (!parent) return () => {}
  const made = new Set<Element>()
  const apply = (el: Element) => {
    if (keep(el) || el.hasAttribute('inert')) return
    el.setAttribute('inert', '')
    made.add(el)
  }
  for (const el of parent.children) apply(el)
  const watch = new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n instanceof Element) apply(n)
  })
  watch.observe(parent, { childList: true })
  return () => {
    watch.disconnect()
    for (const el of made) el.removeAttribute('inert')
  }
}
