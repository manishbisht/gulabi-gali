// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LandmarkDef } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Hook = typeof import('./useStamps')
type Account = Parameters<Hook['useStamps']>[1]
let hook: Hook

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules() // storage keeps an in-memory fallback map, so start from a fresh copy
  hook = await import('./useStamps')
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
/** The server's side: a set that PUTs union into, answered whole. */
function server(start: string[] = [], fail = false) {
  const held = new Set(start)
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (fail) return json({ error: 'rate' }, 429)
    for (const id of (JSON.parse(String(init?.body)) as { stamps: string[] }).stamps) held.add(id)
    return json({ stamps: [...held] })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const pushed = (fetchMock: ReturnType<typeof server>) =>
  fetchMock.mock.calls.map(([url, init]) => {
    expect(url).toContain('/api/me/stamps')
    expect(init?.method).toBe('PUT')
    return (JSON.parse(String(init?.body)) as { stamps: string[] }).stamps
  })

const HAWA = { id: 'hawa-mahal', name: { hi: 'Hawa Mahal', en: 'Hawa Mahal' }, at: { x: 0, z: 0 }, radius: 5 }
const JKK = { id: 'jkk', name: { hi: 'JKK', en: 'JKK' }, at: { x: 100, z: 0 }, radius: 5 }
const LANDMARKS = [HAWA, JKK] as unknown as LandmarkDef[]

function mount(account: Account) {
  const out = {} as ReturnType<Hook['useStamps']>
  let root: Root
  function Probe({ acc }: { acc: Account }) {
    Object.assign(out, hook.useStamps('en', acc))
    return null
  }
  const host = document.createElement('div')
  act(() => {
    root = createRoot(host)
    root.render(<Probe acc={account} />)
  })
  return {
    out,
    rerender: (acc: Account) => act(() => root.render(<Probe acc={acc} />)),
    /** Lets the push's promises settle. */
    settle: () => act(async () => {}),
    unmount: () => act(() => root.unmount()),
  }
}
const resident = (stamps: string[] = [], id = 'dev:asha'): Account => ({
  id,
  token: async () => 'tok',
  stamps,
})
/** Stands at a landmark and presses E. */
const collectAt = (out: ReturnType<Hook['useStamps']>, l: { at: { x: number; z: number } }) =>
  act(() => void out.track(l.at, LANDMARKS, true))

it('a ghost never talks to the server: stamps stay on the device', async () => {
  const fetchMock = server()
  const { out, settle } = mount(null)
  collectAt(out, HAWA)
  await settle()
  expect(out.have).toEqual(['hawa-mahal'])
  expect(fetchMock).not.toHaveBeenCalled()
})

it("signing in pushes what the device collected, and takes in the server's set (a second device's stamps)", async () => {
  localStorage.setItem('gg-stamps', JSON.stringify(['hawa-mahal']))
  const fetchMock = server(['wtp'])
  const { out, settle } = mount(resident(['wtp']))
  await settle()
  expect(pushed(fetchMock)).toEqual([['hawa-mahal', 'wtp']])
  expect(out.have).toEqual(['hawa-mahal', 'wtp'])
  expect(JSON.parse(localStorage.getItem('gg-stamps')!)).toEqual(['hawa-mahal', 'wtp'])
})

it('a load with nothing new on either side sends nothing', async () => {
  localStorage.setItem('gg-stamps', JSON.stringify(['wtp']))
  const fetchMock = server(['wtp'])
  const { out, settle } = mount(resident(['wtp']))
  await settle()
  expect(fetchMock).not.toHaveBeenCalled()
  expect(out.have).toEqual(['wtp'])
})

it('a fresh device shows the stamps the profile carries', async () => {
  const fetchMock = server(['jkk', 'wtp'])
  const { out, settle } = mount(resident(['jkk', 'wtp']))
  await settle()
  expect(out.have).toEqual(['jkk', 'wtp'])
  expect(fetchMock).not.toHaveBeenCalled()
})

it('each new stamp while signed in is pushed', async () => {
  const fetchMock = server()
  const { out, settle } = mount(resident())
  await settle()
  expect(fetchMock).not.toHaveBeenCalled()
  collectAt(out, HAWA)
  await settle()
  collectAt(out, JKK)
  await settle()
  expect(pushed(fetchMock)).toEqual([['hawa-mahal'], ['hawa-mahal', 'jkk']])
  // collecting one already held sends nothing more
  collectAt(out, HAWA)
  await settle()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('a failed push is silent, keeps the stamp, and is retried with the next one', async () => {
  let fetchMock = server([], true)
  const { out, settle } = mount(resident())
  collectAt(out, HAWA)
  await settle()
  expect(out.have).toEqual(['hawa-mahal'])
  expect(out.toast).toContain('Hawa Mahal')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  fetchMock = server()
  collectAt(out, JKK)
  await settle()
  expect(pushed(fetchMock)).toEqual([['hawa-mahal', 'jkk']])
})

it('a failed push on sign-in is retried on the next load', async () => {
  localStorage.setItem('gg-stamps', JSON.stringify(['hawa-mahal']))
  const failing = server([], true)
  const first = mount(resident())
  await first.settle()
  expect(failing).toHaveBeenCalledTimes(1)
  first.unmount()
  const fetchMock = server()
  const again = mount(resident())
  await again.settle()
  expect(pushed(fetchMock)).toEqual([['hawa-mahal']])
})

it('a profile without `stamps` (an older Worker) reads as none: no crash, and the device still pushes', async () => {
  localStorage.setItem('gg-stamps', JSON.stringify(['hawa-mahal']))
  const fetchMock = server()
  const { id, token } = resident()!
  const { out, settle } = mount({ id, token } as Account)
  await settle()
  expect(out.have).toEqual(['hawa-mahal'])
  expect(pushed(fetchMock)).toEqual([['hawa-mahal']])
})

it('signing out stops the pushing', async () => {
  const fetchMock = server()
  const { out, rerender, settle } = mount(resident())
  rerender(null)
  collectAt(out, HAWA)
  await settle()
  expect(fetchMock).not.toHaveBeenCalled()
})

it("signing out wipes the device's set, so the next account on it neither shows nor pushes it", async () => {
  const fetchMock = server()
  const { out, rerender, settle } = mount(resident([], 'dev:asha'))
  collectAt(out, HAWA)
  await settle()
  expect(pushed(fetchMock)).toEqual([['hawa-mahal']])
  rerender(null) // Asha signs out
  expect(out.have).toEqual([])
  expect(JSON.parse(localStorage.getItem('gg-stamps')!)).toEqual([])
  fetchMock.mockClear()
  rerender(resident([], 'dev:ravi')) // Ravi signs in on the same device
  await settle()
  expect(out.have).toEqual([])
  expect(fetchMock).not.toHaveBeenCalled()
})

it('a set left by another account (the page closed without a sign-out) is not inherited or pushed', async () => {
  localStorage.setItem('gg-stamps', JSON.stringify(['hawa-mahal']))
  localStorage.setItem('gg-stamps-owner', 'dev:asha')
  const fetchMock = server(['wtp'])
  const { out, settle } = mount(resident(['wtp'], 'dev:ravi'))
  await settle()
  expect(fetchMock).not.toHaveBeenCalled() // nothing of Asha's went up under Ravi
  expect(out.have).toEqual(['wtp']) // only what the server holds for Ravi
})

const local = () => JSON.parse(localStorage.getItem('gg-stamps') ?? '[]') as string[]
const stashOf = (id: string) => JSON.parse(localStorage.getItem(`gg-stamps-of:${id}`) ?? '[]') as string[]

it('(a) a ghost who signs in without finishing a profile and signs out keeps the stamps they collected', async () => {
  const fetchMock = server()
  const { out, rerender, settle } = mount(null) // a ghost
  collectAt(out, HAWA)
  rerender(null) // signed in, no profile yet: no account for the hook
  rerender(null) // and signed out again
  await settle()
  expect(out.have).toEqual(['hawa-mahal'])
  expect(local()).toEqual(['hawa-mahal'])
  expect(fetchMock).not.toHaveBeenCalled()
})

it('(b) stamps the server never confirmed survive a session that just ends, and only their account gets them back', async () => {
  const fetchMock = server([], true) // every push fails: nothing is confirmed
  const asha = mount(resident([], 'dev:asha'))
  collectAt(asha.out, HAWA)
  await asha.settle()
  asha.rerender(null) // the token is lost; no sign-out ran
  await asha.settle()
  expect(asha.out.have).toEqual([]) // the street no longer shows her stamps
  expect(stashOf('dev:asha')).toEqual(['hawa-mahal']) // but they are kept
  // Ravi signs in on this phone: he neither sees nor pushes them
  const ok = server()
  asha.unmount()
  const ravi = mount(resident([], 'dev:ravi'))
  await ravi.settle()
  expect(ravi.out.have).toEqual([])
  expect(ok).not.toHaveBeenCalled()
  ravi.unmount()
  // Asha comes back: they are hers again, and go up
  const back = mount(resident([], 'dev:asha'))
  await back.settle()
  expect(back.out.have).toEqual(['hawa-mahal'])
  expect(pushed(ok)).toEqual([['hawa-mahal']])
  expect(fetchMock).toHaveBeenCalled()
})

it('(b) a set tagged to an account, found by a page that is not signed in (a lost token), is parked, not shown or wiped', async () => {
  localStorage.setItem('gg-stamps', JSON.stringify(['hawa-mahal']))
  localStorage.setItem('gg-stamps-owner', 'dev:asha')
  const fetchMock = server()
  const ghost = mount(null)
  await ghost.settle()
  expect(ghost.out.have).toEqual([])
  expect(stashOf('dev:asha')).toEqual(['hawa-mahal'])
  ghost.unmount()
  const asha = mount(resident([], 'dev:asha'))
  await asha.settle()
  expect(asha.out.have).toEqual(['hawa-mahal'])
  expect(pushed(fetchMock)).toEqual([['hawa-mahal']])
})

it('(c) an account that collects before its profile is finished keeps those stamps when it is', async () => {
  // the phone still holds the last account\'s unconfirmed set
  localStorage.setItem('gg-stamps', JSON.stringify(['wtp']))
  localStorage.setItem('gg-stamps-owner', 'dev:asha')
  const fetchMock = server()
  const { out, rerender, settle } = mount(null) // Ravi signed in, profile not done
  collectAt(out, HAWA)
  rerender(resident([], 'dev:ravi'))
  await settle()
  expect(out.have).toEqual(['hawa-mahal'])
  expect(pushed(fetchMock)).toEqual([['hawa-mahal']]) // Asha's 'wtp' is not Ravi's to push
  expect(stashOf('dev:asha')).toEqual(['wtp'])
})

it('the account that signs in keeps what its ghost collected, and the same account on a reload keeps its set', async () => {
  const fetchMock = server()
  const { out, rerender, settle } = mount(null)
  collectAt(out, HAWA)
  rerender(resident([], 'dev:asha'))
  await settle()
  expect(pushed(fetchMock)).toEqual([['hawa-mahal']])
  expect(localStorage.getItem('gg-stamps-owner')).toBe('dev:asha')
  const again = mount(resident(['hawa-mahal'], 'dev:asha'))
  await settle()
  expect(again.out.have).toEqual(['hawa-mahal'])
})
