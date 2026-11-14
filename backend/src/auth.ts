import { decodeJwt, verifyJwt } from '@clerk/backend/jwt'
import { allowedOrigin } from './cors'
import type { Env } from './env'

/** Checks a Clerk session token and answers its claims, or throws. */
export type Verifier = (token: string, env: Env) => Promise<{ sub: string }>

/** How long a fetched Clerk key set is trusted before it is fetched again. */
export const JWKS_TTL_MS = 60 * 60 * 1000
/**
 * How often a token signed with a key the set has never heard of may make the
 * Worker fetch the set again. Clerk rotates keys rarely; a forged token can
 * name any key id it likes, and without this every one of them was a call to
 * Clerk's API made with the secret key.
 */
export const JWKS_RETRY_MS = 5 * 60 * 1000

/**
 * Clerk's signing keys, fetched once and kept: per isolate, by key id. A token
 * whose key is in the set verifies with no network at all; one whose key is
 * not may refresh the set at most once per `JWKS_RETRY_MS`, and concurrent
 * misses share that one fetch.
 */
export class ClerkKeys {
  private keys = new Map<string, JsonWebKey>()
  private fetchedAt = -Infinity
  private triedAt = -Infinity
  private inflight: Promise<void> | null = null

  constructor(
    private fetcher: typeof fetch = (input, init) => fetch(input, init),
    private clock: () => number = Date.now,
  ) {}

  async key(kid: string, secretKey: string): Promise<JsonWebKey | null> {
    const now = this.clock()
    const fresh = now - this.fetchedAt < JWKS_TTL_MS
    if (fresh && this.keys.has(kid)) return this.keys.get(kid)!
    // Stale or missing, the set is asked for again at most once a window: a Clerk outage, or a stream of
    // forged key ids, costs one call per window. Meanwhile a stale set still serves the keys it holds.
    if (now - this.triedAt >= JWKS_RETRY_MS) await this.refresh(secretKey)
    return this.keys.get(kid) ?? null
  }

  private refresh(secretKey: string): Promise<void> {
    this.inflight ??= (async () => {
      // Stamped before the call, so a Clerk outage is asked about once a window too.
      this.triedAt = this.clock()
      try {
        const response = await this.fetcher('https://api.clerk.com/v1/jwks', {
          headers: { Authorization: `Bearer ${secretKey}` },
        })
        if (!response.ok) return void (await response.body?.cancel())
        const { keys } = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] }
        if (!Array.isArray(keys) || !keys.length) return
        // A key that left the set is gone: Clerk no longer signs with it.
        this.keys = new Map(keys.filter((key) => typeof key.kid === 'string').map((key) => [key.kid!, key]))
        this.fetchedAt = this.clock()
      } catch {
        // Unreachable: keep whatever keys were already here, and try again next window.
      } finally {
        this.inflight = null
      }
    })()
    return this.inflight
  }
}

const clerkKeys = new ClerkKeys()

/**
 * A Clerk session token's claims. With `CLERK_JWT_KEY` (the instance's PEM public key) it never touches the
 * network; otherwise the key comes from the cached set above. `azp` names the page origin the token was
 * minted for, and must be one of ours.
 */
export async function verifyClerkToken(
  token: string,
  env: Env,
  keys: ClerkKeys = clerkKeys,
): Promise<{ sub: string }> {
  let key: JsonWebKey | string | null = env.CLERK_JWT_KEY || null
  if (!key) {
    const kid = decodeJwt(token).header.kid
    if (!kid || !env.CLERK_SECRET_KEY) throw new Error('no key to verify with')
    key = await keys.key(kid, env.CLERK_SECRET_KEY)
    if (!key) throw new Error('unknown signing key')
  }
  const payload = await verifyJwt(token, { key })
  if (typeof payload.azp === 'string' && !allowedOrigin(payload.azp)) throw new Error('wrong site')
  return payload
}

const enc = new TextEncoder()

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** `dev.<slug>.<hmac>`: a local stand-in for a Clerk token. Only ever minted and accepted under DEV_AUTH=1. */
export async function mintDevToken(env: Env, slug: string): Promise<string> {
  return `dev.${slug}.${await hmacHex(env.DEV_AUTH_SECRET ?? 'dev-only', slug)}`
}

/** A slug of a display name for dev identities: lowercase letters, digits and hyphens. */
export function devSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

async function verifyDevToken(token: string, env: Env): Promise<string | null> {
  const [prefix, slug, mac, extra] = token.split('.')
  if (prefix !== 'dev' || !slug || !mac || extra !== undefined || !/^[a-z0-9-]+$/.test(slug)) return null
  const expected = await hmacHex(env.DEV_AUTH_SECRET ?? 'dev-only', slug)
  return timingSafeEqual(mac, expected) ? slug : null
}

/** The bearer token, or a `?token=` query param (browsers cannot set headers on a WebSocket upgrade). */
function tokenOf(request: Request): string | null {
  const bearer = request.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  return bearer ?? new URL(request.url).searchParams.get('token')
}

/** Who is calling: `clerk:<sub>`, or `dev:<slug>` when DEV_AUTH=1, or null. */
export async function resolveUser(
  request: Request,
  env: Env,
  verify: Verifier = verifyClerkToken,
): Promise<{ id: string } | null> {
  const token = tokenOf(request)
  // A session token is a few hundred bytes; anything far past that is not one.
  if (!token || token.length > 4096) return null
  if (token.startsWith('dev.')) {
    if (env.DEV_AUTH !== '1') return null
    const slug = await verifyDevToken(token, env)
    return slug ? { id: `dev:${slug}` } : null
  }
  if (!env.CLERK_SECRET_KEY && !env.CLERK_JWT_KEY) return null
  try {
    const { sub } = await verify(token, env)
    return sub ? { id: `clerk:${sub}` } : null
  } catch {
    return null
  }
}
