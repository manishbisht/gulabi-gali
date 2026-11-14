import { afterEach, expect, it, vi } from 'vitest'
import { blockPerson, putProfile, sendMeetRequest, unblockPerson, unmatch } from './api'
import { onRateLimited } from './rateNotice'

afterEach(() => vi.unstubAllGlobals())

const tooMany = () =>
  vi.stubGlobal('fetch', () =>
    Promise.resolve(Response.json({ error: 'rate' }, { status: 429, headers: { 'Retry-After': '5' } })),
  )

it('every write path that has no line of its own tells the app to slow down', async () => {
  tooMany()
  const heard = vi.fn()
  const off = onRateLimited(heard)
  await sendMeetRequest('t', 'x', 'a reason')
  await blockPerson('t', 'x')
  await unblockPerson('t', 'x')
  await unmatch('t', 'm')
  await putProfile('t', {} as never).catch(() => undefined)
  expect(heard).toHaveBeenCalledTimes(5)
  off()
})

it('a success or another error stays quiet, and a stopped listener hears nothing', async () => {
  const heard = vi.fn()
  const off = onRateLimited(heard)
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('x', { status: 500 })))
  await blockPerson('t', 'x')
  expect(heard).not.toHaveBeenCalled()
  off()
  tooMany()
  await blockPerson('t', 'x')
  expect(heard).not.toHaveBeenCalled()
})
