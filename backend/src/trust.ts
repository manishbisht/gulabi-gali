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

  const claimed = await env.DB.prepare(
    'UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL',
  )
    .bind(userId, now, code)
    .run()
  if (claimed.meta.changes !== 1) return fail('used', 410)
  const verified = await env.DB.prepare(
    'UPDATE users SET verified = 1, verified_by = ? WHERE id = ? AND verified = 0',
  )
    .bind(invite.owner, userId)
    .run()
  if (verified.meta.changes !== 1) {
    // Verified in the meantime (another code of theirs won): this one goes back to its owner.
    await env.DB.prepare('UPDATE invites SET used_by = NULL, used_at = NULL WHERE code = ? AND used_by = ?')
      .bind(code, userId)
      .run()
    return fail('already-verified', 409)
  }
  await issueCodes(env, userId)
  later(refreshUser(env, userId, 'profile'))
  return Response.json(await getMe(env, userId))
}
