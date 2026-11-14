import { useEffect, useRef, useState } from 'react'
import { onRateLimited } from './rateNotice'

const SHOW_MS = 4000

/** True for a few seconds after any call was told to slow down. */
export function useRateNotice(): boolean {
  const [shown, setShown] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    const off = onRateLimited(() => {
      setShown(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setShown(false), SHOW_MS)
    })
    return () => {
      off()
      clearTimeout(timer.current)
    }
  }, [])
  return shown
}
