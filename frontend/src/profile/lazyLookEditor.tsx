import { Component, lazy, Suspense, useEffect, useRef, type ReactNode } from 'react'
import { t, type Lang } from '../i18n/strings'
import type { LookEditorProps } from './LookEditor'

/** How long the "could not open" line stays before the editor's place closes. */
const LOAD_FAILED_MS = 4000

/** The dressing room, fetched the first time someone opens it: most visits never do. */
const load = () => lazy(() => import('./LookEditor'))
let Editor = load()

/** Says the dressing room could not open, then closes its place. */
function LoadFailed({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const close = useRef(onClose)
  useEffect(() => void (close.current = onClose))
  useEffect(() => {
    const timer = setTimeout(() => close.current(), LOAD_FAILED_MS)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div className="toast look-failed" role="alert">
      {t('lookLoadFailed', lang)}
    </div>
  )
}

/**
 * Catches a dressing room that could not load (a tab open across a deploy, a flaky network): the city goes on,
 * a line says to try again, and the next open fetches it afresh (a failed `lazy` would only fail again).
 */
class LoadBoundary extends Component<{ lang: Lang; onClose: () => void; children: ReactNode }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    Editor = load()
  }
  render() {
    return this.state.failed ? (
      <LoadFailed lang={this.props.lang} onClose={this.props.onClose} />
    ) : (
      this.props.children
    )
  }
}

/** The dressing room, loaded on demand; a failed load closes it with a "try again" line, never the city. */
export function LookEditor(props: LookEditorProps) {
  return (
    <LoadBoundary lang={props.lang} onClose={props.onCancel}>
      <Suspense fallback={null}>
        <Editor {...props} />
      </Suspense>
    </LoadBoundary>
  )
}
