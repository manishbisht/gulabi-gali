import { Component, lazy, Suspense, useEffect, useRef, type ReactNode } from 'react'
import { t, type Lang } from '../i18n/strings'
import type { CricketProps } from './Cricket'

/** How long the "could not open" line stays before the game's place closes. */
const LOAD_FAILED_MS = 4000

/** Gali cricket, fetched the first time someone walks up to a pitch: most visits never do. */
const load = () => lazy(() => import('./Cricket'))
let Game = load()

/** Says the game could not open, then closes its place. */
function LoadFailed({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const close = useRef(onClose)
  useEffect(() => void (close.current = onClose))
  useEffect(() => {
    const timer = setTimeout(() => close.current(), LOAD_FAILED_MS)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div className="toast cricket-failed" role="alert">
      {t('cricketLoadFailed', lang)}
    </div>
  )
}

/**
 * Catches a game that could not load (a tab open across a deploy, a flaky network): the city goes on, a line
 * says to reload, and the next "Cricket khelo" fetches it afresh (a failed `lazy` would only fail again).
 */
class LoadBoundary extends Component<{ lang: Lang; onClose: () => void; children: ReactNode }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    Game = load()
  }
  render() {
    return this.state.failed ? (
      <LoadFailed lang={this.props.lang} onClose={this.props.onClose} />
    ) : (
      this.props.children
    )
  }
}

/** Gali cricket, loaded on demand; a failed load closes it with a "try again" line, never the city. */
export function Cricket(props: CricketProps) {
  return (
    <LoadBoundary lang={props.lang} onClose={props.onExit}>
      <Suspense fallback={null}>
        <Game {...props} />
      </Suspense>
    </LoadBoundary>
  )
}
