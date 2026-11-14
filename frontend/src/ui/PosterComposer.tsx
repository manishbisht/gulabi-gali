import { useState, type FormEvent } from 'react'
import { WordsHint } from '../filter/WordsHint'
import { t, type Lang, type StringKey } from '../i18n/strings'
import { pinPoster, type PinOutcome } from '../net/api'
import { MAX_POSTER, MIN_POSTER, POSTER_AHEAD_MS, type DistrictId, type PosterView } from '../net/protocol'
import { cleanReason, points } from '../profile/reason'
import type { Viewer } from './PersonCard'

/** Jaipur is UTC+5:30 all year. */
const IST_MS = 5.5 * 3600_000

/** `at` as a `datetime-local` value on Jaipur's clock (minutes, no seconds). */
const istInput = (at: number) => new Date(at + IST_MS).toISOString().slice(0, 16)
/** A `datetime-local` value read as Jaipur time; NaN for anything that is not one. */
const fromIstInput = (value: string) => Date.parse(`${value}:00+05:30`)

interface Props {
  district: DistrictId
  wall: number
  viewer: Viewer
  /** The wall has nothing on it yet. */
  empty: boolean
  lang: Lang
  token(): Promise<string | null>
  onPinned(poster: PosterView): void
  /** A ghost or someone without a finished profile: sign in, or finish it. */
  onVisible(): void
  /** A resident: the invite code sheet. */
  onGetVerified(): void
  onClose(): void
}

type Problem = Extract<PinOutcome, { ok: false }>['error'] | 'when'

const ERROR_TEXT: Record<Problem, StringKey> = {
  when: 'posterWhenBad',
  invalid: 'posterFailed',
  words: 'wordsHint',
  limit: 'posterLimit',
  rate: 'posterRate',
  muted: 'benchMuted',
  ghost: 'posterVerifiedOnly',
  'not-verified': 'posterVerifiedOnly',
  failed: 'posterFailed',
}

/**
 * "Deewar pe chipkao": a plan of 10 to 140 characters and, if they like, when it is (Jaipur time, from now to
 * 30 days on). Only a verified member gets the form; anyone else is shown the way to become one.
 */
export function PosterComposer(props: Props) {
  const { viewer, lang, empty, onClose } = props
  const title = t('posterTitle', lang)
  return (
    <section className="landmark-card poster-composer" aria-label={title}>
      <h2>{title}</h2>
      {empty && <p className="person-note">{t('posterEmpty', lang)}</p>}
      {viewer === 'verified' ? (
        <PinForm {...props} />
      ) : (
        <>
          <p>{t('posterVerifiedOnly', lang)}</p>
          <div className="person-actions">
            {viewer === 'resident' ? (
              <button type="button" className="landmark-stamp" onClick={props.onGetVerified}>
                {t('posterGetCode', lang)}
              </button>
            ) : (
              <button type="button" className="landmark-stamp" onClick={props.onVisible}>
                {t(viewer === 'incomplete' ? 'visibilityFinish' : 'signInButton', lang)}
              </button>
            )}
            <button type="button" className="person-close" onClick={onClose}>
              {t('requestBack', lang)}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function PinForm({ district, wall, lang, token, onPinned, onClose }: Props) {
  const [text, setText] = useState('')
  const [when, setWhen] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  // The picker's bounds, fixed when the form opens: from now to 30 days on, on Jaipur's clock.
  const [now] = useState(Date.now)
  const n = points(text)
  const plan = cleanReason(text, MIN_POSTER, MAX_POSTER)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!plan || busy) return
    const at = when ? fromIstInput(when) : null
    const later = Date.now()
    if (at !== null && !(Number.isFinite(at) && at > later && at <= later + POSTER_AHEAD_MS))
      return setProblem('when')
    setBusy(true)
    setProblem(null)
    const tok = await token().catch(() => null)
    const out: PinOutcome = tok
      ? await pinPoster(tok, { district, wall, text: plan, when: at })
      : { ok: false, error: 'ghost' }
    setBusy(false)
    if (out.ok) return onPinned(out.poster)
    setProblem(out.error === 'invalid' && out.field === 'when' ? 'when' : out.error)
  }

  return (
    <form onSubmit={submit}>
      <p className="person-note">{t('posterHint', lang)}</p>
      <textarea
        aria-label={t('posterLabel', lang)}
        placeholder={t('posterPlaceholder', lang)}
        value={text}
        rows={3}
        maxLength={MAX_POSTER * 2}
        onChange={(e) => {
          setText(e.target.value)
          if (problem === 'words') setProblem(null)
        }}
      />
      <p className="request-count" data-over={n > MAX_POSTER ? '' : undefined}>
        <span aria-live="polite">{t('requestCount', lang, { n: String(n), max: String(MAX_POSTER) })}</span>
        {n > 0 && n < MIN_POSTER && ` · ${t('requestMin', lang, { n: String(MIN_POSTER) })}`}
      </p>
      <WordsHint text={text} lang={lang} />
      <label className="poster-when">
        {t('posterWhen', lang)}
        <input
          type="datetime-local"
          value={when}
          min={istInput(now)}
          max={istInput(now + POSTER_AHEAD_MS)}
          onChange={(e) => {
            setWhen(e.target.value)
            if (problem === 'when') setProblem(null)
          }}
        />
      </label>
      <p className="person-note">{t('posterLasts', lang)}</p>
      {problem && (
        <p className="person-note" role="alert">
          {t(ERROR_TEXT[problem], lang)}
        </p>
      )}
      <div className="person-actions">
        <button type="submit" className="landmark-stamp" disabled={!plan || busy}>
          {t(busy ? 'posterSending' : 'posterSend', lang)}
        </button>
        <button type="button" className="person-close" onClick={onClose}>
          {t('requestBack', lang)}
        </button>
      </div>
    </form>
  )
}
