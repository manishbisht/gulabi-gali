/** Instagram, Facebook (FBAN/FBAV), Line and generic Android WebViews (`wv`): Google refuses to sign in inside them. */
const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|\bLine\/|;\s*wv\)/i

export function isInAppBrowser(ua: string = navigator.userAgent): boolean {
  return IN_APP.test(ua)
}
