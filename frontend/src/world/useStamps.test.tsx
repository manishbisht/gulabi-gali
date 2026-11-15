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

it('signing out stops the pushing', async () => {
  const fetchMock = server()
  const { out, rerender, settle } = mount(resident())
  rerender(null)
  collectAt(out, HAWA)
  await settle()
  expect(fetchMock).not.toHaveBeenCalled()
})
