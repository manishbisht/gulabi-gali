import { useEffect, useState } from 'react'

/** Below this, a shorter visual viewport is browser chrome, not a keyboard. */
const KEYBOARD_PX = 80

/**
 * How much of the layout viewport the on-screen keyboard covers (0 when it is down), and the height left
 * above it. Read from `visualViewport`, which shrinks for the keyboard where the page does not.
 */
export function useKeyboard(): { keyboard: number; height: number } {
  const [vp, setVp] = useState({ keyboard: 0, height: 0 })
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const measure = () => {
      const covered = Math.round(window.innerHeight - vv.height - vv.offsetTop)
      const keyboard = covered > KEYBOARD_PX ? covered : 0
      const height = Math.round(vv.height)
      setVp((was) => (was.keyboard === keyboard && was.height === height ? was : { keyboard, height }))
    }
    measure()
    vv.addEventListener('resize', measure)
    vv.addEventListener('scroll', measure)
    return () => {
      vv.removeEventListener('resize', measure)
      vv.removeEventListener('scroll', measure)
    }
  }, [])
  return vp
}
