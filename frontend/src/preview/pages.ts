/// <reference types="node" />
import { createHash } from 'node:crypto'
import { SITE_URL } from '../ui/inviteShare'
import { DISTRICT_NAMES } from '../world/districtNames'
import { placeForward, placePath, placeUrl } from '../world/placeLink'
import { sharedPlaces, type SharedPlace } from './places'

/*
 * The link previews: one small static page per place (`/p/<district>/<place>/index.html`), made when the site is
 * built (vite.config.ts) and never part of the app. WhatsApp, Instagram and X read its Open Graph and Twitter
 * tags (crawlers run no script) and draw a card: the place's name, a line about it and a picture of it. A person
 * who opens it is sent on at once to the app at that place (`/?at=`, see placeLink.ts), or taps the link on it.
 *
 * Privacy: a page names a place and nothing else, and its picture has no one in it (scripts/og-images.mjs).
 *
 * The forward is a script, not a `<meta http-equiv="refresh">`: some crawlers follow a refresh and would draw
 * the home page's card instead of the place's.
 */

/** One English line per landmark, a fact about the real place; a landmark with none gets `landmarkLine`. */
const LANDMARK_LINES: Record<string, string> = {
  'hawa-mahal':
    "953 little windows over Jaipur's bazaar, built in 1799 so the royal women could watch unseen.",
  'jantar-mantar': "Sawai Jai Singh II's stone observatory, with a sundial 27 m tall.",
  'tripolia-gate': "The 'three gates' into the City Palace, kept for the royal family.",
  'badi-chaupar': "The great square at the heart of Jaipur's grid, painted pink in 1876.",
  'city-palace': 'The palace at the heart of the city Sawai Jai Singh II founded in 1727.',
  'albert-hall': "Rajasthan's oldest museum, opened in 1887 in Ram Niwas Bagh.",
  'ram-niwas-gate': 'The garden Sawai Ram Singh II laid out in 1868, with Albert Hall inside.',
  'university-gate': 'The University of Rajasthan, on JLN Marg since 1947.',
  jkk: "Charles Correa's arts centre of nine squares, after Jaipur's own plan.",
  wtp: 'The mall on JLN Marg: two blocks with a bridge between them.',
  'amer-fort': 'The Kachhwaha capital on an Aravalli hill, above Maota Lake.',
  'jal-mahal': 'The palace in Man Sagar lake, most of it under water when the lake is full.',
  'nahargarh-fort': 'The fort on the Aravalli ridge, with all of the Pink City spread out below.',
  'galta-ji': 'The temples and sacred kunds of Galta, in a gorge in the hills east of Jaipur.',
}

/** The Hinglish half of every description, echoing the line "Bulao" sends with the link. */
const TAG = 'Aao, yahin milte hain!'

const landmarkLine = (name: string) => `${name}, in Gulabi Gali: a walkable, low-poly Jaipur.`

/** A line about a place that is not a landmark, by kind (English; the Hinglish tag follows). */
function kindLine(p: SharedPlace, district: string): string {
  switch (p.kind) {
    case 'metro':
      return `The ${p.name.en.toLowerCase()} for ${district} in Gulabi Gali, a walkable, low-poly Jaipur.`
    case 'viewpoint':
      return `Climb to the ${p.name.en.toLowerCase()} in ${district}, Gulabi Gali, and look out over Jaipur.`
    case 'bench':
      return `A bench in ${district}, Gulabi Gali: sit down and chat with whoever sits by.`
    case 'tapri':
      return `A chai stall in ${district}, Gulabi Gali: have a chai and chat at the counter.`
    case 'poster':
      return `A poster wall in ${district}, Gulabi Gali: read the plans people pinned up, add yours.`
    case 'landmark':
      return LANDMARK_LINES[p.place] ?? landmarkLine(p.name.en)
  }
}

/**
 * The name a card shows: a landmark's in Hinglish, with the English after it where it differs (Amer ka Qila
 * (Amer Fort)); a small place's in Hinglish with its district's, the line under it saying it in English.
 */
export function placeTitle(p: SharedPlace): string {
  if (p.kind !== 'landmark') return `${p.name.hi}, ${DISTRICT_NAMES[p.district].hi}`
  return p.name.hi === p.name.en ? p.name.hi : `${p.name.hi} (${p.name.en})`
}

/** One line about the place, English and then the Hinglish tag: at most 160 characters. */
export const placeDescription = (p: SharedPlace) => `${kindLine(p, DISTRICT_NAMES[p.district].en)} ${TAG}`

/** The picture files, as under `frontend/public`: the place's own, its district's, the site's. */
export const placeImage = (p: Pick<SharedPlace, 'district' | 'place'>) => `og/${p.district}-${p.place}.jpg`
export const districtImage = (district: SharedPlace['district']) => `og/${district}.jpg`
export const DEFAULT_IMAGE = 'og/default.jpg'
/** The old site-wide picture, always there: the last resort before the images are made. */
const LAST_IMAGE = 'og.png'

/**
 * The best picture there is for a place: a landmark's own, else its district's, else the site's. `has` says
 * whether a file (path under `public`) exists, so a new district or landmark previews with the site's picture
 * until scripts/og-images.mjs is run again.
 */
export function previewImage(p: SharedPlace, has: (file: string) => boolean): { url: string; alt: string } {
  const district = DISTRICT_NAMES[p.district].en
  const tries: [string, string][] = [
    ...(p.kind === 'landmark'
      ? [[placeImage(p), `${p.name.en} in Gulabi Gali, a low-poly Jaipur`] as [string, string]]
      : []),
    [districtImage(p.district), `A street in ${district}, in Gulabi Gali, a low-poly Jaipur`],
    [DEFAULT_IMAGE, "A pink sandstone bazaar street in Gulabi Gali's low-poly Jaipur, at golden hour"],
  ]
  const [file, alt] = tries.find(([f]) => has(f)) ?? [LAST_IMAGE, 'A pink sandstone bazaar street in Jaipur']
  return { url: `${SITE_URL}/${file}`, alt }
}

const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/**
 * Sends the visitor on to the link's `href`, keeping only the page's own `gg-` switches (the e2e build's), so
 * nothing else a link was dressed with (a click id) follows them in. The same on every page: one hash allows it.
 */
const FORWARD = `let q='';for(const[k,v]of new URLSearchParams(location.search))if(k.startsWith('gg-'))q+='&'+encodeURIComponent(k)+'='+encodeURIComponent(v);location.replace(document.getElementById('go').getAttribute('href')+q)`
const FORWARD_HASH = `sha256-${createHash('sha256').update(FORWARD).digest('base64')}`
/** A page with nothing to load but its picture's crawler: no fonts, no app, one hashed script. */
const POLICY = `default-src 'none'; script-src '${FORWARD_HASH}'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'`

const STYLE =
  'body{margin:0;min-height:100vh;display:grid;place-content:center;gap:12px;padding:16px;box-sizing:border-box;' +
  'background:#2a1d24;color:#f5e6d8;font:16px/1.5 system-ui,sans-serif;text-align:center}' +
  'h1{margin:0;font-size:24px}p{margin:0;max-width:32em}a{color:#f7b2c4;font-weight:700}'

export interface PreviewPage {
  /** Where it goes in the built site, e.g. `p/walled-city/hawa-mahal/index.html`. */
  file: string
  html: string
}

/** A place's preview page. `has`: whether a picture file exists (see `previewImage`). */
export function previewPage(p: SharedPlace, has: (file: string) => boolean): PreviewPage {
  const title = `${placeTitle(p)} · Gulabi Gali`
  const description = placeDescription(p)
  const image = previewImage(p, has)
  const url = placeUrl(p.district, p.place)
  const go = placeForward(p.district, p.place)
  const [h, d, i, a, u] = [title, description, image.url, image.alt, url].map(escape)
  const html = `<!doctype html>
<html lang="hi-Latn">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${POLICY}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#2a1d24" />
    <title>${h}</title>
    <meta name="description" content="${d}" />
    <link rel="canonical" href="${u}" />
    <link rel="icon" type="image/svg+xml" href="/icon.svg" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Gulabi Gali" />
    <meta property="og:url" content="${u}" />
    <meta property="og:title" content="${h}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:image" content="${i}" />
    <meta property="og:image:type" content="${i.endsWith('.png') ? 'image/png' : 'image/jpeg'}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${a}" />
    <meta property="og:locale" content="en_IN" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${h}" />
    <meta name="twitter:description" content="${d}" />
    <meta name="twitter:image" content="${i}" />
    <meta name="twitter:image:alt" content="${a}" />
    <style>${STYLE}</style>
  </head>
  <body>
    <h1>${escape(placeTitle(p))}</h1>
    <p>${d}</p>
    <p><a id="go" href="${escape(go)}">Chalo, Gulabi Gali mein · Go to Gulabi Gali</a></p>
    <script>${FORWARD}</script>
  </body>
</html>
`
  return { file: `${placePath(p.district, p.place).slice(1)}index.html`, html }
}

/** Every place's preview page. */
export const previewPages = (places: readonly SharedPlace[], has: (file: string) => boolean): PreviewPage[] =>
  places.map((p) => previewPage(p, has))

/** What the build emits (vite.config.ts): a page for every place in every district, as defined now. */
export const allPreviewPages = async (has: (file: string) => boolean): Promise<PreviewPage[]> =>
  previewPages(await sharedPlaces(), has)
