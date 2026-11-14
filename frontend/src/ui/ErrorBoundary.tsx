import { Component, type ReactNode } from 'react'
import { useLang } from '../i18n/lang'
import { t } from '../i18n/strings'

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

/** Last resort: if rendering throws, show a reload screen rather than an empty page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false }
  static getDerivedStateFromError() {
    return { crashed: true }
  }
  render() {
    return this.state.crashed ? <Crashed /> : this.props.children
  }
}
