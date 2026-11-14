import { buildList, check } from './index'
import { WORDS } from './words'

/** The list as a `Set`, built on first use and kept for the life of the isolate: every bench line checks it. */
let list: Set<string> | undefined
const serverList = () => (list ??= buildList(WORDS))

/** Whether `text` (already cleaned) is fit to show other people. The server's one answer. */
export const wordsOk = (text: string): boolean => check(text, serverList()).ok

const sha1 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

let hashes: Promise<string[]> | undefined
/** SHA-1 of every entry of the list (see `buildList`), for the page's instant hints. Built once per isolate. */
export const hashedList = (): Promise<string[]> =>
  (hashes ??= Promise.all([...serverList()].map(sha1)).then((all) => all.sort()))
