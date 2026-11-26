import { expect, it, vi } from 'vitest'
import { onTouched, touched } from './touched'

it('tells every listener what was touched, until it stops listening', () => {
  const a = vi.fn()
  const b = vi.fn()
  const offA = onTouched(a)
  const offB = onTouched(b)
  touched('bell')
  offA()
  touched('feed')
  expect(a.mock.calls).toEqual([['bell']])
  expect(b.mock.calls).toEqual([['bell'], ['feed']])
  offB()
})

it('a listener that throws stops neither the others nor the touch', () => {
  const after = vi.fn()
  const off1 = onTouched(() => {
    throw new Error('broken')
  })
  const off2 = onTouched(after)
  expect(() => touched('diyas')).not.toThrow()
  expect(after).toHaveBeenCalledWith('diyas')
  off1()
  off2()
})
