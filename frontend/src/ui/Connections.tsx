import { useEffect, useState, type CSSProperties } from 'react'
import type { Connections as ConnectionsState } from '../connections/useConnections'
import { t, type Lang } from '../i18n/strings'
import { ChatView } from './ChatView'
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
  onClose(): void
}

/**
 * The Connections sheet: requests that came in (Haan / Abhi nahi), requests sent, and the chats. It exists
 * only while open, so closed it leaves the joystick alone; with the phone keyboard up it sits just above it.
 */
export function Connections({ conn, lang, token, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('incoming')
  const [chat, setChat] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const { keyboard, height } = useKeyboard()
  const { seeIncoming, incoming } = conn

  // looking at the incoming tab is what reads those requests
  useEffect(() => {
    if (tab === 'incoming' && !chat) seeIncoming()
  }, [tab, chat, seeIncoming, incoming])

  const open = chat ? conn.matches.find((m) => m.id === chat) : undefined
  // the chat went (unmatched, here or from the other side): back to the list
  const showing = chat && open ? open : null
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
          onRead={(id) => conn.markRead(showing.id, id)}
          onBack={() => setChat(null)}
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
            {tab === 'chats' &&
              (conn.matches.length === 0 ? (
                <p className="chat-empty">{t('connNoChats', lang)}</p>
              ) : (
                <ul className="conn-list">
                  {conn.matches.map((m) => (
                    <li key={m.id}>
                      <button type="button" className="conn-chat" onClick={() => setChat(m.id)}>
                        <b>{m.person.name}</b>
                        {conn.chatUnread(m.id) && (
                          <span className="conn-dot" aria-label={t('connUnread', lang)} />
                        )}
                        {m.last && <span className="conn-last">{m.last.body}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        </>
      )}
    </section>
  )
}
