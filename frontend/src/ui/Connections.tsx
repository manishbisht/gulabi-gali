import { useEffect, useState, type CSSProperties } from 'react'
import type { Connections as ConnectionsState } from '../connections/useConnections'
import { t, type Lang } from '../i18n/strings'
import type { EndedChat, MatchView } from '../net/protocol'
import { ChatView } from './ChatView'
import { ReportSheet } from './ReportSheet'
import { useKeyboard } from './useKeyboard'

type Tab = 'incoming' | 'sent' | 'chats'
const TABS: { id: Tab; label: 'connIncoming' | 'connSent' | 'connChats' }[] = [
  { id: 'incoming', label: 'connIncoming' },
  { id: 'sent', label: 'connSent' },
  { id: 'chats', label: 'connChats' },
]

interface Props {
  conn: ConnectionsState
  lang: Lang
  token(): Promise<string | null>
  /** Blocks them; true once done. */
  onBlock?(id: string, name: string): Promise<boolean>
  onClose(): void
}

/**
 * The Connections sheet: requests that came in (Haan / Abhi nahi), requests sent, and the chats. It exists
 * only while open, so closed it leaves the joystick alone; with the phone keyboard up it sits just above it.
 */
export function Connections({ conn, lang, token, onBlock, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('incoming')
  /** The chat open, as it was when opened: kept to show it ended, once the other side unmatches. */
  const [chat, setChat] = useState<MatchView | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  /** A chat blocked from inside it with "Also report?": it stays open, ended, under the report form. */
  const [left, setLeft] = useState<string | null>(null)
  /** An ended chat being reported, from the "Ended chats" list. */
  const [reporting, setReporting] = useState<EndedChat | null>(null)
  const { keyboard, height } = useKeyboard()
  const { seeIncoming, incoming, refresh } = conn

  // Opening the sheet looks again: a block tells the blocked person nothing, so their chat list (and the
  // ended chats they can still report) may be out of date.
  useEffect(() => {
    void refresh()
  }, [refresh])

  // looking at the incoming tab is what reads those requests
  useEffect(() => {
    if (tab === 'incoming' && !chat) seeIncoming()
  }, [tab, chat, seeIncoming, incoming])

  const open = chat ? conn.matches.find((m) => m.id === chat.id) : undefined
  // The other side ended it (an unmatch, a block, a deletion): the chat stays, saying it has ended, with a
  // Report button. Unmatched or blocked from here: back to the list (see `onUnmatch`, `onBlock`).
  const ended =
    chat !== null &&
    !open &&
    (left === chat.id || conn.ended.has(chat.id) || conn.endedChats.some((e) => e.matchId === chat.id))
  const showing = open ?? (ended ? chat : null)
  const style = keyboard ? ({ '--kb': `${keyboard}px`, '--vvh': `${height}px` } as CSSProperties) : undefined

  const accept = async (id: string) => {
    setBusy(id)
    setFailed(false)
    const matchId = await conn.accept(id)
    setBusy(null)
    if (matchId) setTab('chats')
    else setFailed(true)
  }

  return (
    <section
      className="landmark-card conn-sheet"
      role="dialog"
      aria-label={t('connTitle', lang)}
      data-kb={keyboard ? '' : undefined}
      style={style}
    >
      <div className="bench-head">
        <h2>{t('connTitle', lang)}</h2>
        <button type="button" className="person-close" onClick={onClose}>
          {t('connClose', lang)}
        </button>
      </div>
      {showing ? (
        <ChatView
          key={showing.id}
          matchId={showing.id}
          person={showing.person}
          lang={lang}
          token={token}
          tick={(conn.messageTicks[showing.id] ?? 0) + conn.reconnects}
          ended={ended}
          onRead={(id) => conn.markRead(showing.id, id)}
          onBack={() => setChat(null)}
          onBlock={
            onBlock &&
            (async (stay?: boolean) => {
              const done = await onBlock(showing.person.id, showing.person.name)
              if (done && stay) setLeft(showing.id)
              else if (done) setChat(null)
              return done
            })
          }
          onUnmatch={async () => {
            const gone = await conn.unmatch(showing.id)
            if (gone) setChat(null)
            return gone
          }}
        />
      ) : (
        <>
          <div className="conn-tabs" role="tablist" aria-label={t('connTabs', lang)}>
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                data-on={tab === id ? '' : undefined}
                onClick={() => setTab(id)}
              >
                {t(label, lang)}
                {id === 'chats' && conn.matches.some((m) => conn.chatUnread(m.id)) && (
                  <span className="conn-dot" aria-label={t('connUnread', lang)} />
                )}
              </button>
            ))}
          </div>
          <div className="conn-body" role="tabpanel">
            {tab === 'incoming' && (
              <>
                {failed && (
                  <p className="chat-note" role="alert">
                    {t('connAcceptFailed', lang)}
                  </p>
                )}
                {conn.incoming.length === 0 ? (
                  <p className="chat-empty">{t('connNoIncoming', lang)}</p>
                ) : (
                  <ul className="conn-list">
                    {conn.incoming.map((r) => (
                      <li key={r.id}>
                        <b>{r.person.name}</b>
                        <p className="conn-reason">{r.reason}</p>
                        <div className="person-actions">
                          <button
                            type="button"
                            className="landmark-stamp"
                            disabled={busy === r.id}
                            onClick={() => void accept(r.id)}
                          >
                            {t('connAccept', lang)}
                          </button>
                          <button
                            type="button"
                            className="person-close"
                            disabled={busy === r.id}
                            onClick={() => void conn.ignore(r.id)}
                          >
                            {t('connIgnore', lang)}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {tab === 'sent' && (
              <>
                {conn.sent.length === 0 ? (
                  <p className="chat-empty">{t('connNoSent', lang)}</p>
                ) : (
                  <ul className="conn-list">
                    {conn.sent.map((r) => (
                      <li key={r.id}>
                        <b>{r.person.name}</b>
                        <p className="conn-reason">{r.reason}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="bench-footer">{t('connSentNote', lang)}</p>
              </>
            )}
            {tab === 'chats' && (
              <>
                {conn.matches.length === 0 ? (
                  <p className="chat-empty">{t('connNoChats', lang)}</p>
                ) : (
                  <ul className="conn-list">
                    {conn.matches.map((m) => (
                      <li key={m.id}>
                        <button type="button" className="conn-chat" onClick={() => setChat(m)}>
                          <b>{m.person.name}</b>
                          {conn.chatUnread(m.id) && (
                            <span className="conn-dot" aria-label={t('connUnread', lang)} />
                          )}
                          {m.last && <span className="conn-last">{m.last.body}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {conn.endedChats.length > 0 && (
                  <section className="conn-ended" aria-label={t('connEnded', lang)}>
                    <h3>{t('connEnded', lang)}</h3>
                    <p className="bench-footer">{t('connEndedHint', lang)}</p>
                    {reporting && (
                      <ReportSheet
                        key={reporting.matchId}
                        kind="chat"
                        targetId={reporting.person.id}
                        name={reporting.person.name ?? t('blockedSomeone', lang)}
                        lang={lang}
                        token={token}
                        onBlock={
                          onBlock &&
                          (() =>
                            onBlock(reporting.person.id, reporting.person.name ?? t('blockedSomeone', lang)))
                        }
                        onClose={() => setReporting(null)}
                      />
                    )}
                    <ul className="conn-list">
                      {conn.endedChats.map((e) => {
                        const name = e.person.name ?? t('blockedSomeone', lang)
                        return (
                          <li key={e.matchId}>
                            <b>{name}</b>
                            <button
                              type="button"
                              className="person-close"
                              aria-label={`${t('reportButton', lang)}: ${name}`}
                              disabled={reporting !== null}
                              onClick={() => setReporting(e)}
                            >
                              {t('reportButton', lang)}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  )
}
