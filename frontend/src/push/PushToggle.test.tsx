// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { t } from '../i18n/strings'
import type { PushSupport } from './push'
import { PushToggle } from './PushToggle'

const push = vi.hoisted(() => ({
  pushIsOn: vi.fn(async () => false),
  enablePush: vi.fn(async () => 'on' as const),
  disablePush: vi.fn(async () => undefined),
}))
vi.mock('./push', async (real) => ({ ...(await real<typeof import('./push')>()), ...push }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  push.pushIsOn.mockResolvedValue(false)
  push.enablePush.mockResolvedValue('on')
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

const token = async () => 'tok'
const mount = (support: PushSupport) =>
  act(async () => root.render(<PushToggle lang="hi" token={token} support={support} />))
const box = () => host.querySelector('[data-field="push"]') as HTMLInputElement | null

it('without a VAPID key in the build there is nothing to see', async () => {
  await mount('off')
  expect(host.innerHTML).toBe('')
})

for (const [support, key] of [
  ['in-app', 'pushInApp'],
  ['ios-browser', 'pushIos'],
  ['unsupported', 'pushUnsupported'],
] as const)
  it(`${support}: no switch, and it says why`, async () => {
    await mount(support)
    expect(box()).toBeNull()
    expect(host.textContent).toContain(t('pushToggle', 'hi'))
    expect(host.textContent).toContain(t(key, 'hi'))
  })

it('"Naye messages pe batao": on with a tap, and it says what the lock screen will (and will not) show', async () => {
  await mount('ok')
  expect(host.textContent).toContain('Naye messages pe batao')
  expect(host.textContent).toContain(t('pushHint', 'hi'))
  expect(box()!.checked).toBe(false)
  await act(async () => box()!.click())
  expect(push.enablePush).toHaveBeenCalledWith('tok', 'hi')
  expect(box()!.checked).toBe(true)
  await act(async () => box()!.click())
  expect(push.disablePush).toHaveBeenCalledWith('tok')
  expect(box()!.checked).toBe(false)
})

it('shows it is on when this device already gets them', async () => {
  push.pushIsOn.mockResolvedValue(true)
  await mount('ok')
  expect(box()!.checked).toBe(true)
})

it('refused permission, or a failure: stays off and says so', async () => {
  push.enablePush.mockResolvedValue('denied' as never)
  await mount('ok')
  await act(async () => box()!.click())
  expect(box()!.checked).toBe(false)
  expect(host.querySelector('[role="alert"]')!.textContent).toBe(t('pushDenied', 'hi'))
  push.enablePush.mockResolvedValue('failed' as never)
  await act(async () => box()!.click())
  expect(host.querySelector('[role="alert"]')!.textContent).toBe(t('pushFailed', 'hi'))
})
