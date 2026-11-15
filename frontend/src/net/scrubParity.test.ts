// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

/**
 * The page scrubs a report before it leaves, and the Worker scrubs again on arrival, each with its own copy of
 * the same three patterns. Two copies drift; this holds them to the same code.
 */
const code = (file: string) => {
  const src = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
  const take = (name: string) => {
    const at = src.indexOf(`const ${name} =`)
    expect(at, `${name} in ${file}`).toBeGreaterThanOrEqual(0)
    // up to the blank line that ends the declaration, without the comments (they name the other copy)
    return src
      .slice(at, src.indexOf('\n\n', at))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim()
  }
  return { END: take('END'), QUERY: take('QUERY'), EMAIL: take('EMAIL') }
}

it('the page and the Worker scrub with the same patterns', () => {
  const page = code('./errorBeacon.ts')
  const worker = code('../../../backend/src/errors.ts')
  expect(page.END).toBe(worker.END)
  expect(page.QUERY).toBe(worker.QUERY)
  expect(page.EMAIL).toBe(worker.EMAIL)
})
