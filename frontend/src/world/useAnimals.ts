import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StringKey } from '../i18n/strings'
import type { AnimalHooks, AnimalInfo } from './animals'
import { emitDeed } from './deeds'

const NOTICE_MS = 3500

/** The cow's lines, by `line`: she answers a different one each time. */
const COW_KEYS: StringKey[] = ['animalCow1', 'animalCow2', 'animalCow3', 'animalCow4']

/** What the animal UI asks of the city session. */
export interface AnimalActions {
  callAnimal(): void
  animalHome(): void
}

/** A passing line: which string, and what goes in it. */
export interface AnimalNotice {
  key: StringKey
  vars?: Record<string, string>
}

/**
 * The street animals' UI state: the one in reach, the one following, and the passing line (a cow's remark, or
 * "waiting at the station"). `hooks` goes to the session; App binds the session's actions once it is up.
 */
export function useAnimals() {
  const [near, setNear] = useState<AnimalInfo | null>(null)
  const [following, setFollowing] = useState<AnimalInfo | null>(null)
  const [notice, setNotice] = useState<AnimalNotice | null>(null)
  const actions = useRef<AnimalActions | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const hooks = useMemo<AnimalHooks>(
    () => ({
      near: setNear,
      following(animal) {
        setFollowing(animal)
        if (animal) emitDeed({ kind: 'animal' })
      },
      notice(n) {
        if (n.kind === 'cow') emitDeed({ kind: 'animal' })
        clearTimeout(timer.current)
        setNotice(
          n.kind === 'cow' ? { key: COW_KEYS[n.line]! } : { key: 'animalWaiting', vars: { name: n.name } },
        )
        timer.current = setTimeout(() => setNotice(null), NOTICE_MS)
      },
    }),
    [],
  )

  const bind = useCallback((a: AnimalActions | null) => void (actions.current = a), [])
  const call = useCallback(() => actions.current?.callAnimal(), [])
  const home = useCallback(() => actions.current?.animalHome(), [])

  return { near, following, notice, hooks, bind, call, home }
}
