import { useState } from 'react'
import { storage } from '../storage'
import type { Lang } from './strings'

export type { Lang }

const KEY = 'gg-lang'

function initial(): Lang {
  return storage.get(KEY) === 'en' ? 'en' : 'hi'
}

export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>(initial)
  const setLang = (l: Lang) => {
    storage.set(KEY, l)
    setLangState(l)
  }
  return [lang, setLang]
}
