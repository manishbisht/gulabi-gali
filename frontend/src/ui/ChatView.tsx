import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { t, type Lang, type StringKey } from '../i18n/strings'
import { getMessages, sendMessage } from '../net/api'
import { BlockConfirm } from './BlockConfirm'
import { MAX_MESSAGE, type ChatMessage, type PublicPerson } from '../net/protocol'

interface Props {
  matchId: string
  person: PublicPerson
  lang: Lang
  token(): Promise<string | null>
  /** Moves when a `message` notice arrives for this chat: the newest page is fetched again. */
  tick: number
  /** The other person ended the match: what was said stays on screen, but nothing more can be sent. */
  ended?: boolean
  /** The newest message id this view has shown, so the chat counts as read. */
  onRead(messageId: string): void
  onBack(): void
  /** True once the match is gone. */
  onUnmatch(): Promise<boolean>
  /** Blocks them; true once done (the parent then closes the chat). */
  onBlock?(): Promise<boolean>
}

/** A message the server has not confirmed yet. */
type Line = ChatMessage & { pending?: boolean }
type Note = 'rate' | 'failed' | 'load' | 'unmatch' | 'words' | null

const byTime = (a: Line, b: Line) =>
  a.pending !== b.pending ? (a.pending ? 1 : -1) : a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Merges by id, so a message the send reply and a refetch both bring shows once. */
function merge(was: Line[], more: ChatMessage[]): Line[] {
  const byId = new Map(was.map((m) => [m.id, m]))
  for (const m of more) byId.set(m.id, m)
  return [...byId.values()].sort(byTime)
}

const NOTE_TEXT: Record<Exclude<Note, null>, StringKey> = {
  rate: 'chatRate',
  failed: 'chatFailed',
  load: 'chatLoadFailed',
  unmatch: 'chatUnmatchFailed',
  words: 'wordsHint',
}

/**
 * One match's chat: the newest 50 messages (older ones on request), a composer that sends at once and
 * confirms after, and Unmatch behind a confirm in the sheet. Bodies are text, never markup.
 */
export function ChatView({
  matchId,
  person,
  lang,
  token,
  tick,
  ended,
  onRead,
  onBack,
  onUnmatch,
  onBlock,
}: Props) {
  const [blocking, setBlocking] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [older, setOlder] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note>(null)
  const [confirming, setConfirming] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const list = useRef<HTMLOListElement>(null)
  /** Whether the reader is at the bottom: only then does a new line pull the view down. */
  const stick = useRef(true)
  const alive = useRef(true)
  const tmp = useRef(0)
  const onReadRef = useRef(onRead)
  useEffect(() => {
    onReadRef.current = onRead
  }, [onRead])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /** The newest page, merged in; the cursor to older ones is kept only from the first page. */
  const fetchNewest = useCallback(
    async (first: boolean) => {
      try {
        const tok = await token()
        const page = tok ? await getMessages(tok, matchId) : null
        if (!alive.current || !page) return
        setLines((was) => merge(was, page.messages))
        if (first) setOlder(page.before)
        setLoaded(true)
        setNote((n) => (n === 'load' ? null : n))
        const last = page.messages.at(-1)
        if (last) onReadRef.current(last.id)
      } catch {
        if (alive.current && first) setNote('load')
      }
    },
    [token, matchId],
  )
  useEffect(() => {
    // the fetch's setState runs after an await, not synchronously
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchNewest(true)
  }, [fetchNewest])
  const firstTick = useRef(tick)
  useEffect(() => {
    if (tick !== firstTick.current) void fetchNewest(false)
  }, [tick, fetchNewest])

  const showOlder = async () => {
    if (!older) return
    try {
      const tok = await token()
      const page = tok ? await getMessages(tok, matchId, older) : null
      if (!alive.current || !page) return
      setLines((was) => merge(was, page.messages))
      setOlder(page.before)
    } catch {
      if (alive.current) setNote('load')
    }
  }

  // the newest line in view, when one is added at the end (not when older ones are put on top)
  const newest = lines.at(-1)?.id
  useLayoutEffect(() => {
    const el = list.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [newest])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const body = text.trim()
    if (!body || busy) return
    const id = `pending-${tmp.current++}`
    setBusy(true)
    setNote(null)
    setText('')
    stick.current = true
    setLines((was) => merge(was, [{ id, body, at: Date.now(), mine: true, pending: true } as Line]))
    const tok = await token().catch(() => null)
    const out = tok ? await sendMessage(tok, matchId, body) : null
    if (!alive.current) return
    setBusy(false)
    setLines((was) => was.filter((m) => m.id !== id))
    if (out?.ok) {
      setLines((was) => merge(was, [out.message]))
      onRead(out.message.id)
    } else {
      // keep what they wrote, unless they have started something new meanwhile
      setText((now) => now || body)
      setNote(out && !out.ok && (out.error === 'rate' || out.error === 'words') ? out.error : 'failed')
    }
  }

  const leave = async () => {
    setLeaving(true)
    setNote(null)
    const gone = await onUnmatch()
    if (!alive.current) return
    setLeaving(false)
    if (!gone) setNote('unmatch')
  }

  return (
    <div className="chat-view">
      <div className="chat-head">
        <button type="button" className="person-close" onClick={onBack}>
          {t('chatBack', lang)}
        </button>
        <h3>{person.name}</h3>
        {!confirming && !blocking && !ended && (
          <button type="button" className="person-close" onClick={() => setConfirming(true)}>
            {t('chatUnmatch', lang)}
          </button>
        )}
        {!confirming && !blocking && onBlock && (
          <button type="button" className="person-close" onClick={() => setBlocking(true)}>
            {t('blockButton', lang)}
          </button>
        )}
      </div>
      {blocking && onBlock && (
        <BlockConfirm
          name={person.name}
          lang={lang}
          onConfirm={onBlock}
          onCancel={() => setBlocking(false)}
        />
      )}
      {confirming && !ended && (
        <div className="chat-confirm" role="alertdialog" aria-label={t('chatUnmatch', lang)}>
          <p>{t('chatUnmatchAsk', lang, { name: person.name })}</p>
          <div className="person-actions">
            <button type="button" className="landmark-stamp" disabled={leaving} onClick={() => void leave()}>
              {t('chatUnmatchYes', lang)}
            </button>
            <button type="button" className="person-close" onClick={() => setConfirming(false)}>
              {t('chatUnmatchNo', lang)}
            </button>
          </div>
        </div>
      )}
      <ol
        className="chat-lines"
        ref={list}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
      >
        {older && (
          <li className="chat-older">
            <button type="button" className="person-close" onClick={() => void showOlder()}>
              {t('chatOlder', lang)}
            </button>
          </li>
        )}
        {loaded && lines.length === 0 && <li className="chat-empty">{t('connNoMessages', lang)}</li>}
        {lines.map((m) => (
          <li
            key={m.id}
            className="chat-line"
            data-mine={m.mine ? '' : undefined}
            data-pending={m.pending ? '' : undefined}
          >
            {m.body}
          </li>
        ))}
      </ol>
      {ended ? (
        <p className="chat-note" role="status">
          {t('chatEnded', lang)}
        </p>
      ) : (
        note && (
          <p className="chat-note" role="status">
            {t(NOTE_TEXT[note], lang)}
          </p>
        )
      )}
      {!ended && (
        <form className="bench-say" onSubmit={(e) => void submit(e)}>
          <input
            aria-label={t('chatLabel', lang)}
            placeholder={t('chatHint', lang)}
            value={text}
            maxLength={MAX_MESSAGE}
            enterKeyHint="send"
            autoComplete="off"
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="landmark-stamp" disabled={busy}>
            {t(busy ? 'chatSending' : 'chatSend', lang)}
          </button>
        </form>
      )}
    </div>
  )
}
