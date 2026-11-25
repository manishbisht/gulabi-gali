/** Instagram, Facebook (FBAN/FBAV), Line and generic Android WebViews (`wv`): Google refuses to sign in inside them. */
const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|\bLine\/|;\s*wv\)/i

export function isInAppBrowser(ua: string = navigator.userAgent): boolean {
  return IN_APP.test(ua)
}

/**
 * The social app whose own browser this is, by the name the welcome screen's note uses: Instagram, or Facebook
 * (and Messenger, which says FBAN/FBAV too). Null in a browser, and in the other in-app browsers `isInAppBrowser`
 * knows (a note naming the wrong app would be worse than none).
 */
export function socialApp(ua: string = navigator.userAgent): 'Instagram' | 'Facebook' | null {
  if (/Instagram/i.test(ua)) return 'Instagram'
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return 'Facebook'
  return null
}
