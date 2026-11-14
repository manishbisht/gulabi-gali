import type { Env } from './env'
import { floating, type Later } from './inbox'
import { allow, rateLimited } from './limits'
import type { InviteView } from './protocol'
import { activeRow, getMe } from './profiles'
import { refreshUser } from './refresh'

export const CODE_LENGTH = 8
/** How many unused codes a verified member holds, and how many a new member is given. */
export const CODES_HELD = 2
/** Crockford base32: no I, L, O or U, so a code read aloud or off a screenshot is hard to get wrong. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** Redeeming is guessable, so each person gets this many attempts (right or wrong) per window. */
export const REDEEM_LIMIT = { perWindow: 10, windowMs: 3600_000, bucket: 'redeem' } as const

const fail = (error: string, status: number) => Response.json({ error }, { status })

/** 8 random characters, 5 bits each: 256 is a multiple of 32, so every character is equally likely. */
export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join('')
}

/**
 * What a person typed, as the code it means: uppercase, hyphens and spaces gone, I and L read as 1, O as 0
 * (Crockford). Null for anything that is not 8 characters of the alphabet.
 */
export function normaliseCode(x: unknown): string | null {
  if (typeof x !== 'string' || x.length > 64) return null
  const code = x.toUpperCase().replace(/[-\s]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : null
}

/**
 * Gives `userId` as many new codes as they need to hold `count` unused ones. A collision on the primary key
 * (a 1 in 10^12 chance) just tries a fresh code.
 */
export async function issueCodes(env: Env, userId: string, count: number = CODES_HELD): Promise<void> {
  const held = await env.DB.prepare('SELECT COUNT(*) AS n FROM invites WHERE owner = ? AND used_by IS NULL')
    .bind(userId)
    .first<{ n: number }>()
  const now = Date.now()
  for (let i = held?.n ?? 0; i < count; i++) {
    for (let tries = 0; tries < 5; tries++) {
      const done = await env.DB.prepare(
        'INSERT OR IGNORE INTO invites (code, owner, created_at) VALUES (?, ?, ?)',
      )
        .bind(generateCode(), userId, now)
        .run()
      if (done.meta.changes === 1) break
    }
  }
}

/**
 * Makes someone verified (an admin's mark, `by` the admin's id) and gives them their codes. Answers whether
 * they were newly verified; someone already verified keeps what they have.
 */
export async function markVerified(
  env: Env,
  userId: string,
  by: string,
  later: Later = floating,
): Promise<boolean> {
  const done = await env.DB.prepare(
    'UPDATE users SET verified = 1, verified_by = ? WHERE id = ? AND verified = 0',
  )
    .bind(by, userId)
    .run()
  if (done.meta.changes !== 1) return false
  await issueCodes(env, userId)
  later(refreshUser(env, userId, 'profile'))
  return true
}

export async function isVerified(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT verified FROM users WHERE id = ?')
    .bind(userId)
    .first<{ verified: number }>()
  return row?.verified === 1
}

/** `GET /api/invites`: the caller's own codes, used or not. Only a resident has any. */
export async function listInvites(env: Env, userId: string): Promise<Response> {
  if (!(await activeRow(env, userId))) return fail('ghost', 403)
  // A verified member who never got their codes (an admin's mark that failed halfway) gets them now.
  if (await isVerified(env, userId)) {
    const any = await env.DB.prepare('SELECT 1 AS x FROM invites WHERE owner = ? LIMIT 1')
      .bind(userId)
      .first()
    if (!any) await issueCodes(env, userId)
  }
  const rows = await env.DB.prepare(
    'SELECT code, used_by FROM invites WHERE owner = ? ORDER BY created_at, code LIMIT 50',
  )
    .bind(userId)
    .all<{ code: string; used_by: string | null }>()
  const codes: InviteView[] = rows.results.map((r) => ({ code: r.code, used: r.used_by !== null }))
  return Response.json({ codes })
}

/**
 * `POST /api/invites/redeem {code}`. The code is claimed with one conditional UPDATE, so of two people
 * redeeming it at once exactly one gets `meta.changes === 1`; the verification is claimed the same way, so one
 * person redeeming two codes at once is verified once and the spare code is put back.
 */
export async function redeemInvite(
  env: Env,
  userId: string,
  raw: unknown,
  later: Later = floating,
  now = Date.now(),
): Promise<Response> {
  if (!(await activeRow(env, userId))) return fail('ghost', 403)
  const { perWindow, windowMs, bucket } = REDEEM_LIMIT
  if (!(await allow(env, userId, bucket, perWindow, windowMs, now))) return rateLimited(windowMs, now)
  const code = normaliseCode((raw as { code?: unknown } | null)?.code)
  if (!code) return fail('bad-code', 404)
  const invite = await env.DB.prepare('SELECT owner, used_by FROM invites WHERE code = ?')
    .bind(code)
    .first<{ owner: string; used_by: string | null }>()
  if (!invite) return fail('bad-code', 404)
  if (invite.owner === userId) return fail('own-code', 403)
  // Checked before the code is touched, so a member who is already verified never burns someone's code.
  if (await isVerified(env, userId)) return fail('already-verified', 409)
  if (invite.used_by !== null) return fail('used', 410)

  // One transaction: claim the code, verify the redeemer and give them their codes. Each statement is guarded
  // by the claim (`used_by = me`), and the claim by the redeemer not being verified yet, so any failure rolls
  // the lot back (no burnt code, no verified member without codes) and a lost race changes nothing.
  const fresh = Array.from({ length: CODES_HELD }, generateCode)
  const won = () => 'EXISTS (SELECT 1 FROM invites WHERE code = ? AND used_by = ?)'
  let results: D1Result[]
  try {
    results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL
         AND NOT EXISTS (SELECT 1 FROM users WHERE id = ? AND verified = 1)`,
      ).bind(userId, now, code, userId),
      env.DB.prepare(
        `UPDATE users SET verified = 1, verified_by = ? WHERE id = ? AND verified = 0 AND ${won()}`,
      ).bind(invite.owner, userId, code, userId),
      ...fresh.map((c) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO invites (code, owner, created_at) SELECT ?, ?, ? WHERE ${won()}`,
        ).bind(c, userId, now, code, userId),
      ),
    ])
  } catch (err) {
    console.error('redeem failed', err)
    return fail('failed', 500)
  }
  if (results[0]!.meta.changes !== 1) {
    // Someone else won the code, or this person was verified in the meantime.
    return (await isVerified(env, userId)) ? fail('already-verified', 409) : fail('used', 410)
  }
  // A freshly drawn code colliding with an existing one (1 in 10^12) leaves a short hand: top up.
  await issueCodes(env, userId).catch((err) => console.error('top-up failed', err))
  later(refreshUser(env, userId, 'profile'))
  return Response.json(await getMe(env, userId))
}

/**
 * `POST /api/dev/verify {userId}`, DEV_AUTH only (the caller has checked the flag, like `devLogin`): makes the
 * user (created if need be) verified, as an admin would, and answers their unused codes so an e2e test can
 * hand one over.
 */
export async function devVerify(env: Env, raw: unknown): Promise<Response> {
  const userId = (raw as { userId?: unknown } | null)?.userId
  if (typeof userId !== 'string' || !userId || userId.length > 200) return fail('invalid', 400)
  await env.DB.prepare('INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)')
    .bind(userId, Date.now())
    .run()
  await markVerified(env, userId, 'dev')
  await issueCodes(env, userId)
  const rows = await env.DB.prepare(
    'SELECT code FROM invites WHERE owner = ? AND used_by IS NULL ORDER BY code',
  )
    .bind(userId)
    .all<{ code: string }>()
  return Response.json({ codes: rows.results.map((r) => r.code) })
}
