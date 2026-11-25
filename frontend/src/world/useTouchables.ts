import { useCallback, useMemo, useRef, useState } from 'react'
import type { StringKey } from '../i18n/strings'
import type { TouchableHooks, TouchableInfo, TouchKind } from './touchables'

/** What each kind's button says. */
export const TOUCH_KEYS: Record<TouchKind, StringKey> = {
  bell: 'touchBell',
  pump: 'touchPump',
  diyas: 'touchDiya',
}

/** What the touchables' UI asks of the city session. */
export interface TouchActions {
  touch(): void
}

/**
 * The touchables' UI state: the bell, pump or diya stand in reach, if it can be touched now. `hooks` goes to
 * the session; App binds the session's action once it is up.
 */
export function useTouchables() {
  const [near, setNear] = useState<TouchableInfo | null>(null)
  const actions = useRef<TouchActions | null>(null)
  const hooks = useMemo<TouchableHooks>(() => ({ near: setNear }), [])
  const bind = useCallback((a: TouchActions | null) => void (actions.current = a), [])
  const touch = useCallback(() => actions.current?.touch(), [])
  return { near, hooks, bind, touch }
}
