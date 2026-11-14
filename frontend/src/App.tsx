import { useEffect, useRef, useState } from 'react'
import { createStage } from './engine/stage'
import { hasWebGL } from './engine/webgl'
import { useLang } from './i18n/lang'
import { fetchCity } from './net/api'
import type { CitySnapshot } from './net/protocol'
import { Hud } from './ui/Hud'
import { Intro } from './ui/Intro'
import { NoWebGL } from './ui/NoWebGL'
import { installTestHooks } from './testHooks'

export default function App() {
  const [lang, setLang] = useLang()
  const [entered, setEntered] = useState(false)
  const [snapshot, setSnapshot] = useState<CitySnapshot | null>(null)
  const [webgl] = useState(hasWebGL)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetchCity(controller.signal).then((s) => {
      if (!controller.signal.aborted) setSnapshot(s)
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!entered || !canvas) return
    const stage = createStage(canvas)
    installTestHooks({ quality: () => stage.quality, framesSinceRestore: stage.framesSinceRestore })
    return () => stage.dispose()
  }, [entered])

  if (!webgl) return <NoWebGL lang={lang} />
  if (!entered) return <Intro lang={lang} onLang={setLang} onEnter={() => setEntered(true)} />
  return (
    <>
      <canvas ref={canvasRef} className="stage" />
      <Hud district="walled-city" snapshot={snapshot} lang={lang} onLang={setLang} />
    </>
  )
}
