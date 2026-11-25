/// <reference types="node" />
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { SITE_URL } from '../ui/inviteShare'
import { mapItems } from '../world/cityMap'
import { DISTRICTS, loadDef } from '../world/district'
import { placeUrl, readPlaceLink } from '../world/placeLink'
import {
  DEFAULT_IMAGE,
  districtImage,
  placeImage,
  previewPage,
  previewPages,
  type PreviewPage,
} from './pages'
import { sharedPlaces, type SharedPlace } from './places'

const PUBLIC = new URL('../../public/', import.meta.url)
const has = (file: string) => existsSync(new URL(file, PUBLIC))

/** Every `<meta property|name="key" content="…">` in a page, by key, as written (still escaped). */
const metaOf = (html: string) =>
  new Map(
    [...html.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"/g)].map(([, k, v]) => [
      k!,
      v!,
    ]),
  )
/** HTML's five escapes undone, for comparing a tag's text with what was put in. */
const unescape = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
/** Where a page sends its visitor: the link's href (the script goes to the same place). */
const forwardOf = (html: string) => unescape(/<a id="go" href="([^"]+)"/.exec(html)![1]!)

let places: SharedPlace[]
let pages: PreviewPage[]
beforeAll(async () => {
  places = await sharedPlaces()
  pages = previewPages(places, has)
})

describe('the link preview pages', () => {
  it('there is one for every place on every district’s map, each in a folder of its own', async () => {
    let count = 0
    for (const id of DISTRICTS) {
      const def = await loadDef(id)
      count += mapItems(def, []).length
      // every landmark, the metro, and the district's name is on its pages
      for (const l of def.landmarks)
        expect(
          places.some((p) => p.district === id && p.place === l.id),
          l.id,
        ).toBe(true)
      expect(places.some((p) => p.district === id && p.place === 'metro')).toBe(true)
    }
    expect(pages).toHaveLength(count)
    expect(new Set(pages.map((p) => p.file)).size).toBe(pages.length)
    for (const [i, p] of places.entries())
      expect(pages[i]!.file).toBe(`p/${p.district}/${p.place}/index.html`)
  })

  it('the shared link is the page (GitHub Pages serves a folder’s index.html), and the page forwards to the place', () => {
    for (const [i, p] of places.entries()) {
      const url = new URL(placeUrl(p.district, p.place))
      expect(`${url.pathname}index.html`).toBe(`/${pages[i]!.file}`)
      const forward = new URL(forwardOf(pages[i]!.html), SITE_URL)
      expect(forward.origin).toBe(SITE_URL)
      expect(forward.pathname).toBe('/')
      expect(readPlaceLink(forward.search), p.place).toEqual({ district: p.district, place: p.place })
    }
  })

  it('every page has the tags the scrapers read: a title, a short line, an absolute picture, its own address', () => {
    for (const [i, p] of places.entries()) {
      const { html } = pages[i]!
      const meta = metaOf(html)
      const title = meta.get('og:title')!
      expect(title).toMatch(/ · Gulabi Gali$/)
      expect(html).toContain(`<title>${title}</title>`)
      expect(meta.get('twitter:title')).toBe(title)
      const line = unescape(meta.get('og:description')!)
      expect(line.length, line).toBeGreaterThan(20)
      expect(line.length, line).toBeLessThanOrEqual(160)
      expect(meta.get('description')).toBe(meta.get('og:description'))
      expect(meta.get('twitter:description')).toBe(meta.get('og:description'))
      const image = new URL(meta.get('og:image')!)
      expect(image.origin).toBe(SITE_URL)
      expect(meta.get('twitter:image')).toBe(meta.get('og:image'))
      expect(has(image.pathname.slice(1)), image.pathname).toBe(true)
      expect(meta.get('og:image:width')).toBe('1200')
      expect(meta.get('og:image:height')).toBe('630')
      expect(meta.get('og:image:alt')!.length).toBeGreaterThan(10)
      expect(meta.get('og:url')).toBe(placeUrl(p.district, p.place))
      expect(meta.get('og:type')).toBe('website')
      expect(meta.get('twitter:card')).toBe('summary_large_image')
      // crawlers follow a refresh: the forward is the script and the link only
      expect(html).not.toMatch(/http-equiv="refresh"/i)
    }
  })

  it('names the landmark, in Hinglish and English where they differ, with a line about it', () => {
    const page = (place: string) => metaOf(pages[places.findIndex((p) => p.place === place)]!.html)
    expect(page('hawa-mahal').get('og:title')).toBe('Hawa Mahal · Gulabi Gali')
    expect(page('amer-fort').get('og:title')).toBe('Amer ka Qila (Amer Fort) · Gulabi Gali')
    expect(unescape(page('hawa-mahal').get('og:description')!)).toMatch(
      /^953 little windows .* Aao, yahin milte hain!$/,
    )
    expect(page('tapri-0').get('og:title')).toBe('Chai ki tapri 1, Gulabi Shahar · Gulabi Gali')
  })

  it('carries nothing about who shared it: the same page for everyone, no query or id in any address', () => {
    for (const { html } of pages) {
      for (const [, url] of html.matchAll(/(?:href|content)="(https?:[^"]*|\/[^"]*)"/g)) {
        const u = new URL(unescape(url!), SITE_URL)
        expect(
          [...u.searchParams.keys()].filter((k) => k !== 'at'),
          url,
        ).toEqual([])
      }
    }
    expect(previewPages(places, has)).toEqual(pages)
  })

  it('escapes what it puts in the page', () => {
    const odd: SharedPlace = {
      district: 'mi-road',
      place: 'odd-place',
      kind: 'landmark',
      name: { hi: `<b>"Chai" & 'pakode'</b>`, en: `<b>"Chai" & 'pakode'</b>` },
    }
    const { html } = previewPage(odd, () => false)
    expect(html).not.toContain('<b>')
    expect(html).not.toContain(`"Chai"`)
    const meta = metaOf(html)
    expect(meta.get('og:title')).toBe(
      '&lt;b&gt;&quot;Chai&quot; &amp; &#39;pakode&#39;&lt;/b&gt; · Gulabi Gali',
    )
    // a landmark with no line of its own still gets one, and its district's name says "&" safely
    expect(unescape(meta.get('og:description')!)).toContain(`<b>"Chai" & 'pakode'</b>, in Gulabi Gali`)
  })

  it('uses a landmark’s own picture, else its district’s, else the site’s: a new place previews before its picture is made', () => {
    const hawa = places.find((p) => p.place === 'hawa-mahal')!
    const bench = places.find((p) => p.district === 'walled-city' && p.kind === 'bench')!
    const image = (p: SharedPlace, files: string[]) =>
      metaOf(previewPage(p, (f) => files.includes(f)).html).get('og:image')
    const all = [placeImage(hawa), districtImage('walled-city'), DEFAULT_IMAGE]
    expect(image(hawa, all)).toBe(`${SITE_URL}/og/walled-city-hawa-mahal.jpg`)
    expect(image(hawa, all.slice(1))).toBe(`${SITE_URL}/og/walled-city.jpg`)
    expect(image(hawa, all.slice(2))).toBe(`${SITE_URL}/og/default.jpg`)
    expect(image(hawa, [])).toBe(`${SITE_URL}/og.png`)
    expect(metaOf(previewPage(hawa, () => false).html).get('og:image:type')).toBe('image/png')
    // a bench is never pictured on its own (it may have someone on it): its district's street
    expect(image(bench, [...all, placeImage(bench)])).toBe(`${SITE_URL}/og/walled-city.jpg`)
  })

  it('allows its one script by hash, and nothing else to load but its own pictures', () => {
    for (const { html } of pages.slice(0, 5)) {
      const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, s]) => s!)
      expect(scripts).toHaveLength(1)
      const hash = createHash('sha256').update(scripts[0]!).digest('base64')
      expect(policy).toContain(`script-src 'sha256-${hash}';`)
      expect(policy).toContain("default-src 'none'")
      expect(html).not.toMatch(/<script[^>]*\ssrc=/)
    }
  })
})

describe('the pictures in public/og', () => {
  /** A JPEG's width and height, from its first start-of-frame marker. */
  function jpegSize(bytes: Buffer): { width: number; height: number } {
    expect(bytes.readUInt16BE(0)).toBe(0xffd8)
    let at = 2
    while (at < bytes.length) {
      const marker = bytes.readUInt16BE(at)
      if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker))
        return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) }
      at += 2 + bytes.readUInt16BE(at + 2)
    }
    throw new Error('no frame header')
  }

  it('are 1200x630 JPEGs, small enough for every scraper, and a few MB at most together', () => {
    const dir = new URL('og/', PUBLIC)
    const files = readdirSync(dir).filter((f) => f.endsWith('.jpg'))
    expect(files).toContain('default.jpg')
    let total = 0
    for (const f of files) {
      const size = statSync(new URL(f, dir)).size
      total += size
      expect(size, f).toBeLessThan(150 * 1024)
      expect(jpegSize(readFileSync(new URL(f, dir))), f).toEqual({ width: 1200, height: 630 })
    }
    expect(total).toBeLessThan(3 * 1024 * 1024)
  })

  it('every one is a place, a district or the site’s: no stray picture ships', () => {
    const known = new Set([DEFAULT_IMAGE, ...DISTRICTS.map(districtImage), ...places.map(placeImage)])
    for (const f of readdirSync(new URL('og/', PUBLIC))) expect(known.has(`og/${f}`), f).toBe(true)
  })
})
