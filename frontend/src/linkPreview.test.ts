/// <reference types="node" />
import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const file = (path: string) => new URL(`../${path}`, import.meta.url)
const html = readFileSync(file('index.html'), 'utf8')
/** Every `<meta property|name="key" content="…">` in the page, by key. */
const meta = new Map(
  [...html.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"/g)].map(([, k, v]) => [k!, v!]),
)
/** A PNG's width and height, from its IHDR chunk. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(file(path))
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/** A JPEG's width and height, from its first start-of-frame marker. */
function jpegSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(file(path))
  expect(bytes.readUInt16BE(0)).toBe(0xffd8)
  for (let at = 2; at < bytes.length; at += 2 + bytes.readUInt16BE(at + 2)) {
    const marker = bytes.readUInt16BE(at)
    if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker))
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) }
  }
  throw new Error(`${path}: no frame header`)
}

const SITE = 'https://gulabi-gali.manishbisht.me/'

describe('the link preview Instagram, WhatsApp and X draw', () => {
  it('has a short title and description, everywhere the scrapers look', () => {
    const title = meta.get('og:title')!
    const description = meta.get('description')!
    expect(title.length).toBeGreaterThan(0)
    expect(title.length).toBeLessThanOrEqual(60)
    expect(description.length).toBeGreaterThan(0)
    expect(description.length).toBeLessThanOrEqual(155)
    expect(meta.get('og:description')).toBe(description)
    expect(meta.get('twitter:title')).toBe(title)
    expect(meta.get('twitter:description')).toBe(description)
    expect(html).toContain(`<title>${title}</title>`)
  })

  it('is a website card with a large image, for India, at the site’s own address', () => {
    expect(meta.get('og:type')).toBe('website')
    expect(meta.get('og:url')).toBe(SITE)
    expect(meta.get('og:locale')).toBe('en_IN')
    expect(meta.get('twitter:card')).toBe('summary_large_image')
    expect(meta.get('og:image:alt')!.length).toBeGreaterThan(10)
  })

  it('points at og/default.jpg (no one in it) by an absolute URL, a 1200x630 JPEG under 300 kB', () => {
    const image = meta.get('og:image')!
    expect(image).toBe(`${SITE}og/default.jpg`)
    expect(new URL(image).protocol).toBe('https:')
    expect(meta.get('twitter:image')).toBe(image)
    expect(meta.get('og:image:type')).toBe('image/jpeg')
    expect(meta.get('og:image:width')).toBe('1200')
    expect(meta.get('og:image:height')).toBe('630')
    expect(jpegSize('public/og/default.jpg')).toEqual({ width: 1200, height: 630 })
    expect(statSync(file('public/og/default.jpg')).size).toBeLessThan(300 * 1024)
  })

  it('has a 180x180 home-screen icon for iOS', () => {
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
    expect(pngSize('public/apple-touch-icon.png')).toEqual({ width: 180, height: 180 })
  })
})
