import { useEffect, useState } from 'react'
import { storage } from '../storage'
import type { Lang } from './strings'

export type { Lang }

const KEY = 'gg-lang'

function initial(): Lang {
  return storage.get(KEY) === 'en' ? 'en' : 'hi'
}

/** The page's own language, for screen readers and translators: the Hinglish copy is Latin-script Hindi. */
const htmlLang = (l: Lang) => (l === 'en' ? 'en' : 'hi-Latn')

export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>(initial)
  useEffect(() => {
    document.documentElement.lang = htmlLang(lang)
  }, [lang])
  const setLang = (l: Lang) => {
    storage.set(KEY, l)
    document.documentElement.lang = htmlLang(l) // at once, so another sheet that reads it sees the new one
    setLangState(l)
  }
  return [lang, setLang]
}
