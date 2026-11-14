import { useEffect, useState } from 'react'
import { useLang } from './i18n/lang'
import { fetchCity } from './net/api'
import type { CitySnapshot } from './net/protocol'
import { Hud } from './ui/Hud'
import { Intro } from './ui/Intro'

export default function App() {
  const [lang, setLang] = useLang()
  const [entered, setEntered] = useState(false)
  const [snapshot, setSnapshot] = useState<CitySnapshot | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetchCity(controller.signal).then((s) => {
      if (!controller.signal.aborted) setSnapshot(s)
    })
    return () => controller.abort()
  }, [])

  if (!entered) return <Intro lang={lang} onLang={setLang} onEnter={() => setEntered(true)} />
  return (
    <>
      <canvas className="stage" />
      <Hud district="walled-city" snapshot={snapshot} lang={lang} onLang={setLang} />
    </>
  )
}
