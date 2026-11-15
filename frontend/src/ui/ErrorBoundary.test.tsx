// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { beaconError } from '../net/errorBeacon'
import { ErrorBoundary } from './ErrorBoundary'

vi.mock('../net/errorBeacon', () => ({ beaconError: vi.fn() }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  document.body.innerHTML = ''
})

function Boom(): never {
  throw new Error('render blew up')
}

it('shows a bilingual reload screen instead of a blank page when rendering throws', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    ),
  )
  expect(host.textContent).toContain('Kuch gadbad ho gayi')
  expect(host.querySelector('button')!.textContent).toBe('Reload karo')
  // and the error goes to the beacon, caught by React
  expect(beaconError).toHaveBeenCalledWith('react', expect.objectContaining({ message: 'render blew up' }))
  await act(async () => root.unmount())
})
