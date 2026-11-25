/*
 * What kind of browser this is, for the home-screen hint and push: an iPhone or iPad (Safari or not), and whether
 * the page was opened from the home screen.
 */

/** An iPhone, iPad or iPod. An iPad asking for desktop sites calls itself a Mac; a Mac has no touch screen. */
export function isIOS(ua: string, touchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)
}

/**
 * Safari itself on an iPhone or iPad: the browser whose Share sheet has "Add to Home Screen". Chrome, Firefox, Edge,
 * Opera and the Google app on iOS say so in their user agents; the apps' own browsers (Instagram, Facebook) leave
 * out the `Safari/` token, or name themselves.
 */
export function isIOSSafari(ua: string, touchPoints: number): boolean {
  return (
    isIOS(ua, touchPoints) &&
    /Safari\//.test(ua) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo|Instagram|FBAN|FBAV|FB_IAB|\bLine\//.test(ua)
  )
}

/** Opened from the home screen: an installed web app (Android's `display-mode`, or iOS's `navigator.standalone`). */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return true
  try {
    return !!window.matchMedia?.('(display-mode: standalone)').matches
  } catch {
    return false
  }
}
