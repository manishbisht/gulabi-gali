import { Component, type ReactNode } from 'react'
import { useLang } from '../i18n/lang'
import { t } from '../i18n/strings'
import { reportError } from '../net/errorBeacon'

function Crashed() {
  const [lang] = useLang()
  return (
    <div className="intro" role="alert">
      <h1 className="intro-title">Gulabi Gali</h1>
      <p className="intro-tagline">{t('crashed', lang)}</p>
      <button type="button" className="enter" onClick={() => location.reload()}>
        {t('reload', lang)}
      </button>
    </div>
  )
}

/** Last resort: if rendering throws, show a reload screen rather than an empty page, and tell the error beacon. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false }
  static getDerivedStateFromError() {
    return { crashed: true }
  }
  componentDidCatch(error: unknown) {
    reportError('react', error)
  }
  render() {
    return this.state.crashed ? <Crashed /> : this.props.children
  }
}
