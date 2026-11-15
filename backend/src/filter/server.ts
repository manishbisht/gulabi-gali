import { buildList, check } from './index'
import { NAME_SAFE, PUBLIC_ONLY, STRONG, WORDS } from './words'

/**
 * Fields others read as who someone is: their profile (status too, also set live on the map), a poster and a
 * request note. These also refuse `PUBLIC_ONLY`; bench lines, 1:1 chat and report notes do not.
 */
const PUBLIC_FIELDS: readonly string[] = ['name', 'status', 'about', 'poster', 'reason']

type Scope = 'chat' | 'public' | 'name'
/** Each list as a `Set`, built on first use and kept for the life of the isolate: every bench line checks one. */
const lists: Partial<Record<Scope, Set<string>>> = {}
function listFor(scope: Scope): Set<string> {
  const cached = lists[scope]
  if (cached) return cached
  const all = scope === 'chat' ? WORDS : [...WORDS, ...PUBLIC_ONLY]
  // `NAME_SAFE` words are somebody's name: the name field alone lets them through.
  const words = scope === 'name' ? all.filter((w) => !NAME_SAFE.includes(w)) : all
  return (lists[scope] = buildList(
    words,
    words.filter((w) => STRONG.includes(w)),
  ))
}
const serverList = () => listFor('chat')

/**
 * Whether `text` (already cleaned) is fit to show other people in `field`. The server's one answer. A field in
 * `PUBLIC_FIELDS` also refuses `PUBLIC_ONLY`; `name` alone spares `NAME_SAFE`; anything else (a bench line, a
 * chat message, a report note) is checked against the plain list.
 */
export const wordsOk = (text: string, field?: string): boolean =>
  check(text, listFor(field === 'name' ? 'name' : field && PUBLIC_FIELDS.includes(field) ? 'public' : 'chat'))
    .ok

const sha1 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

let hashes: Promise<string[]> | undefined
/** SHA-1 of every entry of the list but the masked ones (see `buildList`), for the page's instant hints. Built once per isolate. */
export const hashedList = (): Promise<string[]> =>
  (hashes ??= Promise.all([...serverList()].filter((w) => !w.includes('*')).map(sha1)).then((all) =>
    all.sort(),
  ))
