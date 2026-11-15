/*
 * Cloudflare Web Analytics: cookieless page views, on only when the build has `VITE_CF_BEACON_TOKEN` (the
 * deploy's secret; never in dev or e2e). Used by vite.config.ts, which puts the tag in index.html and widens
 * the Content-Security-Policy by exactly these hosts, and only then.
 */
const SCRIPT_HOST = 'https://static.cloudflareinsights.com'
const REPORT_HOST = 'https://cloudflareinsights.com'

/** A site token is a short run of letters, digits, `-` and `_`: anything else is refused, never escaped. */
const TOKEN = /^[A-Za-z0-9_-]{8,64}$/

function checked(token: string): string {
  if (!TOKEN.test(token)) throw new Error('VITE_CF_BEACON_TOKEN is not a Web Analytics site token')
  return token
}

/** The beacon's <script>, or '' without a token. */
export function analyticsTag(token: string | undefined): string {
  if (!token) return ''
  const config = JSON.stringify({ token: checked(token) })
  return `<script defer src="${SCRIPT_HOST}/beacon.min.js" data-cf-beacon='${config}'></script>`
}

/** What the policy's script-src and connect-src gain: nothing without a token. */
export function analyticsCsp(token: string | undefined): { script: string[]; connect: string[] } {
  return token ? { script: [SCRIPT_HOST], connect: [REPORT_HOST] } : { script: [], connect: [] }
}
