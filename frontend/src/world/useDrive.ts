import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DriveHooks } from './driving'

const NOTICE_MS = 3500

/** What the drive UI asks of the city session. */
export interface DriveActions {
  mount(): void
  exitAuto(): void
  honk(): void
}

/**
 * The driving UI state: a parked auto in reach, whether the player is at the wheel, and the passing notice
 * for "no room to get out". `hooks` goes to the session; App binds the session's actions once it is up.
 */
export function useDrive() {
  const [near, setNear] = useState(false)
  const [driving, setDriving] = useState(false)
  const [stuck, setStuck] = useState(false)
  const [rescued, setRescued] = useState(false)
  const actions = useRef<DriveActions | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const hooks = useMemo<DriveHooks>(
    () => ({
      near: setNear,
      driving(on) {
        setDriving(on)
        if (!on) setStuck(false)
        if (on) setRescued(false)
      },
      rescued() {
        clearTimeout(timer.current)
        setRescued(true)
        timer.current = setTimeout(() => setRescued(false), NOTICE_MS)
      },
      blocked() {
        clearTimeout(timer.current)
        setStuck(true)
        timer.current = setTimeout(() => setStuck(false), NOTICE_MS)
      },
    }),
    [],
  )

  const bind = useCallback((a: DriveActions | null) => void (actions.current = a), [])
  const mount = useCallback(() => actions.current?.mount(), [])
  const exit = useCallback(() => actions.current?.exitAuto(), [])
  const honk = useCallback(() => actions.current?.honk(), [])

  return { near, driving, stuck, rescued, hooks, bind, mount, exit, honk }
}
