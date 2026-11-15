import { describe, expect, it } from 'vitest'
import { analyticsCsp, analyticsTag } from './analytics'

const TOKEN = '0123456789abcdef0123456789abcdef'

describe('Cloudflare Web Analytics, only with a token at build time', () => {
  it('no token: no script and nothing added to the policy', () => {
    expect(analyticsTag(undefined)).toBe('')
    expect(analyticsTag('')).toBe('')
    expect(analyticsCsp(undefined)).toEqual({ script: [], connect: [] })
  })

  it('a token: the deferred beacon, and its script and report hosts in the policy', () => {
    expect(analyticsTag(TOKEN)).toBe(
      `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${TOKEN}"}'></script>`,
    )
    expect(analyticsCsp(TOKEN)).toEqual({
      script: ['https://static.cloudflareinsights.com'],
      connect: ['https://cloudflareinsights.com'],
    })
  })

  it('refuses a token that could break out of the attribute', () => {
    expect(() => analyticsTag(`x'><script>alert(1)</script>`)).toThrow(/VITE_CF_BEACON_TOKEN/)
  })
})
