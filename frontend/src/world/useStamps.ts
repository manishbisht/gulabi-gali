import { useCallback, useEffect, useRef, useState } from 'react'
import type { Controls } from '../player/controls'
import type { Lang } from '../i18n/strings'
import { t } from '../i18n/strings'
import type { LandmarkDef, Vec2 } from './types'
import { collect, collected, nearestLandmark } from './stamps'

const TOAST_MS = 3500

/** Landmark proximity, stamp collection and the toast, so App stays thin. */
export function useStamps(lang: Lang) {
  const [near, setNear] = useState<LandmarkDef | null>(null)
  const [have, setHave] = useState(collected)
  const [toast, setToast] = useState<string | null>(null)
  const nearRef = useRef<LandmarkDef | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const langRef = useRef(lang)
  useEffect(() => {
    langRef.current = lang
  }, [lang])
  useEffect(() => () => clearTimeout(timer.current), [])

  const collectHere = useCallback(() => {
    const landmark = nearRef.current
    if (!landmark || !collect(landmark.id)) return
    setHave(collected())
    setToast(t('stampGot', langRef.current, { place: landmark.name[langRef.current] }))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  /** Call every frame; re-renders only when the nearby landmark changes. */
  const track = useCallback(
    (pos: Vec2, landmarks: LandmarkDef[], controls: Controls) => {
      const found = nearestLandmark(pos, landmarks)
      if (found?.id !== nearRef.current?.id) {
        nearRef.current = found
        setNear(found)
      }
      if (controls.interact()) collectHere()
    },
    [collectHere],
  )

  return { near, have, toast, collectHere, track }
}
