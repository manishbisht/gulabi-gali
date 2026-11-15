// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { inertRest } from './inertRest'

const flush = () => new Promise((r) => setTimeout(r, 0))

function page() {
  document.body.innerHTML =
    '<div id="p"><div id="hud"></div><div id="mine" data-own></div><div id="was" inert></div></div>'
  return document.getElementById('p')!
}
const keep = (el: Element) => el.hasAttribute('data-own')

it('makes the other children inert, but not its own, and gives them back', () => {
  const p = page()
  const undo = inertRest(p, keep)
  expect(p.querySelector('#hud')!.hasAttribute('inert')).toBe(true)
  expect(p.querySelector('#mine')!.hasAttribute('inert')).toBe(false)
  undo()
  expect(p.querySelector('#hud')!.hasAttribute('inert')).toBe(false)
  expect(p.querySelector('#was')!.hasAttribute('inert')).toBe(true) // inert before, inert after
})

it('also covers a child added while it holds, and stops watching when undone', async () => {
  const p = page()
  const undo = inertRest(p, keep)
  const late = p.appendChild(document.createElement('div'))
  const own = p.appendChild(document.createElement('div'))
  own.setAttribute('data-own', '')
  await flush()
  expect(late.hasAttribute('inert')).toBe(true)
  expect(own.hasAttribute('inert')).toBe(false)
  undo()
  expect(late.hasAttribute('inert')).toBe(false)
  const after = p.appendChild(document.createElement('div'))
  await flush()
  expect(after.hasAttribute('inert')).toBe(false)
})
