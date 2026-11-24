import { useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { WordsHint } from '../filter/WordsHint'
import { t, type Lang } from '../i18n/strings'
import { MAX_BENCH_LINE, type BenchLine } from '../net/protocol'
import type { BenchSeat } from '../world/benches'
import type { BenchNotice } from '../world/useBench'
import { BlockConfirm } from './BlockConfirm'
import { ReportSheet } from './ReportSheet'
import { useKeyboard } from './useKeyboard'

interface Props {
  seat: BenchSeat
  lines: BenchLine[]
  /** The viewer's id, so their own lines read "You". */
  me: string | null
  notice: BenchNotice | null
  lang: Lang
  /** Lets a line be reported (the server takes what was said here from its own memory). */
  token?(): Promise<string | null>
  /** Sends a line; false keeps what was typed (too soon, or nowhere to send it). */
  onSay(text: string): boolean
  onStand(): void
  /** Blocks the sitter who said a line; true once done. */
  onBlock?(id: string, name: string): Promise<boolean>
  /** "Bulao": a link to this bench or tapri to send someone (see `PlaceInvite`). */
  invite?: ReactNode
  /** "Chai pe bulao": invite a friend to this bench (see `ChaiInvite`); residents only. */
  chai?: ReactNode
}

/**
 * The panel for whoever sits at one tapri or bench: who else is there, what has been said since you sat, a
 * line to say, and Utho. It sits beside the joystick; while the phone keyboard is up it spans the screen just
 * above the keyboard instead (the joystick is under the keyboard then anyway).
 */
export function BenchChat({
  seat,
  lines,
  me,
  notice,
  lang,
  token,
  onSay,
  onStand,
  onBlock,
  invite,
  chai,
}: Props) {
  const [text, setText] = useState('')
  const [blocking, setBlocking] = useState<{ id: string; name: string } | null>(null)
  /** Who is being reported; `blocked` when they were just blocked from the block question's "Also report?". */
  const [reporting, setReporting] = useState<{ id: string; name: string; blocked?: boolean } | null>(null)
  const list = useRef<HTMLOListElement>(null)
  const { keyboard, height } = useKeyboard()
  // the newest line in view, as in any chat
  useLayoutEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length, keyboard])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (text.trim() && onSay(text)) setText('')
  }
  const title = t(seat.bench.kind === 'tapri' ? 'benchAtTapri' : 'benchAtBench', lang)
  const style = keyboard ? ({ '--kb': `${keyboard}px`, '--vvh': `${height}px` } as CSSProperties) : undefined

  return (
    <section
      className="landmark-card bench-chat"
      data-kb={keyboard ? '' : undefined}
      style={style}
      aria-label={title}
    >
      <div className="bench-head">
        <h2>{title}</h2>
        {invite}
        <button type="button" className="person-close" onClick={onStand}>
          {t('benchStand', lang)}
        </button>
      </div>
      <div className="bench-with-row">
        <p className="bench-with">
          {seat.with.length ? t('benchWith', lang, { names: seat.with.join(', ') }) : t('benchAlone', lang)}
        </p>
        {chai}
      </div>
      {blocking && onBlock && (
        <BlockConfirm
          name={blocking.name}
          lang={lang}
          onConfirm={async () => {
            const done = await onBlock(blocking.id, blocking.name)
            if (done) setBlocking(null)
            return done
          }}
          onCancel={() => setBlocking(null)}
          onReport={
            token
              ? () => {
                  setBlocking(null)
                  setReporting({ ...blocking, blocked: true })
                }
              : undefined
          }
        />
      )}
      {reporting && token && (
        <ReportSheet
          key={`${reporting.id}:${reporting.blocked ? 'blocked' : ''}`}
          kind="bench"
          targetId={reporting.id}
          bench={seat.bench.id}
          name={reporting.name}
          lang={lang}
          token={token}
          onBlock={reporting.blocked ? undefined : onBlock && (() => onBlock(reporting.id, reporting.name))}
          onClose={() => setReporting(null)}
        />
      )}
      <ol className="bench-lines" ref={list} aria-live="polite">
        {lines.length === 0 ? (
          <li className="bench-empty">{t('benchEmpty', lang)}</li>
        ) : (
          lines.map((l, i) => (
            <li key={i}>
              <b>{l.from === me ? t('benchYou', lang) : l.name}</b> {l.text}
              {onBlock && me && l.from !== me && (
                <button
                  type="button"
                  className="line-block"
                  aria-label={`${t('blockButton', lang)}: ${l.name}`}
                  onClick={() => {
                    setReporting(null)
                    setBlocking({ id: l.from, name: l.name })
                  }}
                >
                  {t('blockButton', lang)}
                </button>
              )}
              {token && me && l.from !== me && (
                <button
                  type="button"
                  className="line-block"
                  aria-label={`${t('reportButton', lang)}: ${l.name}`}
                  onClick={() => {
                    setBlocking(null)
                    setReporting({ id: l.from, name: l.name })
                  }}
                >
                  {t('reportButton', lang)}
                </button>
              )}
            </li>
          ))
        )}
      </ol>
      {notice === 'rate' && <p className="bench-note">{t('benchRate', lang)}</p>}
      {notice === 'words' && <p className="bench-note">{t('wordsHint', lang)}</p>}
      {notice === 'muted' && <p className="bench-note">{t('benchMuted', lang)}</p>}
      <WordsHint text={text} lang={lang} />
      <form className="bench-say" onSubmit={submit}>
        <input
          aria-label={t('benchSay', lang)}
          placeholder={t('benchSayHint', lang)}
          value={text}
          maxLength={MAX_BENCH_LINE}
          enterKeyHint="send"
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="landmark-stamp">
          {t('benchSend', lang)}
        </button>
      </form>
      <p className="bench-footer">{t('benchFooter', lang)}</p>
    </section>
  )
}

/** The "be seen first" card, for a ghost who tried to sit. */
export function BenchGhost({
  lang,
  cta,
  onVisible,
  onClose,
}: {
  lang: Lang
  cta: string
  onVisible(): void
  onClose(): void
}) {
  return (
    <section className="landmark-card" role="status">
      <p>{t('benchGhost', lang)}</p>
      <div className="person-actions">
        <button type="button" className="landmark-stamp" onClick={onVisible}>
          {cta}
        </button>
        <button type="button" className="person-close" onClick={onClose}>
          {t('benchNoticeClose', lang)}
        </button>
      </div>
    </section>
  )
}
