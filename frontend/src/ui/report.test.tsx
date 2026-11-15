// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { LivePerson, Me } from '../net/protocol'
import { ProfileSheet } from '../profile/ProfileSheet'
import type { BenchSeat } from '../world/benches'
import { BenchChat } from './BenchChat'
import { ChatView } from './ChatView'
import { PersonCard } from './PersonCard'
import { ReportSheet } from './ReportSheet'
import { useDialog } from './useDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ravi: LivePerson = {
  id: 'p2',
  name: 'Ravi',
  look: { skin: 2, outfit: 'sandstone', head: 'none' },
  status: 'chai',
  x: 0,
  z: 0,
  ry: 0,
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === label)
const click = (host: HTMLElement, label: string) =>
  act(async () => {
    const b = button(host, label)
    expect(b, `a '${label}' button`).toBeDefined()
    b!.click()
  })
const typeIn = (el: HTMLTextAreaElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })

/** Answers `/api/reports` with `answer`, everything else with `other`; records report bodies. */
function stubFetch(answer: () => Response, other: () => Response = () => json({}, 404)) {
  const sent: Record<string, unknown>[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/reports') && init?.method === 'POST') {
        sent.push(JSON.parse(init.body as string))
        return answer()
      }
      return other()
    }),
  )
  vi.stubGlobal('confirm', vi.fn())
  return sent
}

async function render(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(node))
  await settle()
  return host
}

it('ReportSheet: a reason is needed, the note goes with it, and the thanks follow', async () => {
  const sent = stubFetch(() => json({ autoHidden: false }, 201))
  const onBlock = vi.fn(async () => true)
  const onClose = vi.fn()
  const host = await render(
    <ReportSheet
      kind="person"
      targetId="p2"
      name="Ravi"
      lang="en"
      token={async () => 'tok'}
      onBlock={onBlock}
      onClose={onClose}
    />,
  )
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Report Ravi')
  const send = button(host, 'Send report')!
  expect(send.disabled).toBe(true)
  for (const chip of ['Harassing me', 'Hate or abuse', 'Spam', 'Looks under 18', 'Something else'])
    expect(button(host, chip), chip).toBeDefined()
  await click(host, 'Looks under 18')
  expect(button(host, 'Looks under 18')!.getAttribute('aria-pressed')).toBe('true')
  await typeIn(host.querySelector('textarea')!, '  Said they are 15  ')
  expect(host.querySelector('textarea')!.maxLength).toBe(300)
  await click(host, 'Send report')
  await settle()
  expect(sent).toEqual([{ kind: 'person', targetId: 'p2', reason: 'underage', note: 'Said they are 15' }])
  expect(host.textContent).toContain('Thank you. The moderator will take a look.')
  // Not asked to block, so nobody is blocked.
  expect(onBlock).not.toHaveBeenCalled()
  await click(host, 'OK')
  expect(onClose).toHaveBeenCalled()
  expect(window.confirm).not.toHaveBeenCalled()
})

it('ReportSheet: "Also block?" blocks after the report goes, and only then', async () => {
  let ok = false
  const sent = stubFetch(() => (ok ? json({ autoHidden: true }, 201) : json({ error: 'rate' }, 429)))
  const onBlock = vi.fn(async () => true)
  const host = await render(
    <ReportSheet
      kind="bench"
      targetId="p2"
      bench="walled-city:4"
      name="Ravi"
      lang="hi"
      token={async () => 'tok'}
      onBlock={onBlock}
      onClose={() => {}}
    />,
  )
  await click(host, 'Pareshan kar raha/rahi hai')
  const box = [...host.querySelectorAll('label')].find((l) => l.textContent?.includes('Block bhi karein?'))!
  await act(async () => box.querySelector('input')!.click())
  await click(host, 'Report bhejo')
  await settle()
  // Refused: nothing blocked yet, and the sheet says why.
  expect(onBlock).not.toHaveBeenCalled()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Aaj ki reports')
  ok = true
  await click(host, 'Report bhejo')
  await settle()
  expect(sent.at(-1)).toEqual({ kind: 'bench', targetId: 'p2', bench: 'walled-city:4', reason: 'harassment' })
  expect(onBlock).toHaveBeenCalledTimes(1)
})

it('ReportSheet: a bench report filed without its record says so, honestly', async () => {
  stubFetch(() => json({ autoHidden: false, evidence: 'missing' }, 201))
  const host = await render(
    <ReportSheet
      kind="bench"
      targetId="p2"
      bench="walled-city:4"
      name="Ravi"
      lang="hi"
      token={async () => 'tok'}
      onClose={() => {}}
    />,
  )
  await click(host, 'Kuch aur')
  await click(host, 'Report bhejo')
  await settle()
  const said = host.querySelector('[role="status"]')?.textContent
  expect(said).toBe('Report mil gayi. Us baat-cheet ka record ab nahi raha, phir bhi moderator dekhenge.')
})

it("ReportSheet: someone who wasn't at the bench is told so, apart from other refusals", async () => {
  let error = 'not-there'
  stubFetch(() => json({ error }, 404))
  const host = await render(
    <ReportSheet
      kind="bench"
      targetId="p2"
      bench="walled-city:4"
      name="Ravi"
      lang="en"
      token={async () => 'tok'}
      onClose={() => {}}
    />,
  )
  await click(host, 'Spam')
  await click(host, 'Send report')
  await settle()
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "You weren't on this bench in the last 10 minutes, so you can't report from it.",
  )
  error = 'not-found'
  await click(host, 'Send report')
  await settle()
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "This can't be reported now: there's nothing left to send with it.",
  )
})

it('ReportSheet: a note with words the server refuses keeps the sheet open', async () => {
  stubFetch(() => json({ error: 'words', field: 'note' }, 400))
  const host = await render(
    <ReportSheet
      kind="chat"
      targetId="p2"
      name="Ravi"
      lang="en"
      token={async () => 'tok'}
      onClose={() => {}}
    />,
  )
  // No block offered when there is no block flow.
  expect(host.textContent).not.toContain('Also block?')
  await click(host, 'Spam')
  await typeIn(host.querySelector('textarea')!, 'something rude')
  await click(host, 'Send report')
  await settle()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Some of these words aren't okay")
  expect(button(host, 'Send report')).toBeDefined()
})

it('PersonCard: Report opens the form in the card', async () => {
  const sent = stubFetch(
    () => json({ autoHidden: false }, 201),
    () => json({ ...ravi, homeArea: 'Raja Park', about: '', pauseRequests: false }),
  )
  const host = await render(
    <PersonCard
      person={ravi}
      gone={false}
      viewer="resident"
      lang="en"
      token={async () => 'tok'}
      onVisible={() => {}}
      onGetVerified={() => {}}
      onRequest={() => {}}
      onBlock={async () => true}
      onClose={() => {}}
    />,
  )
  await click(host, 'Report')
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Report Ravi')
  await click(host, 'Spam')
  await click(host, 'Send report')
  await settle()
  expect(sent).toEqual([{ kind: 'person', targetId: 'p2', reason: 'spam' }])
})

it('ChatView: the header menu holds Unmatch, Block and Report; Report is a chat report', async () => {
  const sent = stubFetch(
    () => json({ autoHidden: false }, 201),
    () => json({ messages: [], before: null }),
  )
  const host = await render(
    <ChatView
      matchId="m"
      person={ravi}
      lang="en"
      token={async () => 'tok'}
      tick={0}
      onRead={() => {}}
      onBack={() => {}}
      onUnmatch={async () => true}
      onBlock={async () => true}
    />,
  )
  expect(button(host, 'Report')).toBeUndefined()
  const more = host.querySelector<HTMLButtonElement>('.chat-head button[aria-expanded]')!
  expect(more.getAttribute('aria-expanded')).toBe('false')
  await act(async () => more.click())
  expect(more.getAttribute('aria-expanded')).toBe('true')
  for (const label of ['Unmatch', 'Block', 'Report']) expect(button(host, label), label).toBeDefined()
  await click(host, 'Report')
  // The menu gives way to the form.
  expect(more.isConnected).toBe(false)
  await click(host, 'Hate or abuse')
  await click(host, 'Send report')
  await settle()
  expect(sent).toEqual([{ kind: 'chat', targetId: 'p2', reason: 'hate' }])
})

it('BenchChat: each line of someone else has Report beside Block, and the footer says what a report shows', async () => {
  const sent = stubFetch(() => json({ autoHidden: false }, 201))
  const seat: BenchSeat = {
    bench: { id: 'walled-city:4', kind: 'bench' } as BenchSeat['bench'],
    seat: 0,
    with: ['Ravi'],
  }
  const host = await render(
    <BenchChat
      seat={seat}
      lines={[
        { from: 'p2', name: 'Ravi', text: 'oye', at: 1 },
        { from: 'me', name: 'Asha', text: 'haan', at: 2 },
      ]}
      me="me"
      notice={null}
      lang="en"
      token={async () => 'tok'}
      onSay={() => true}
      onStand={() => {}}
      onBlock={async () => true}
    />,
  )
  expect(host.querySelector('.bench-footer')?.textContent).toBe(
    "Only people on this bench can read this. If it's reported, the moderator can see recent messages.",
  )
  const reports = host.querySelectorAll('button[aria-label^="Report"]')
  expect(reports).toHaveLength(1)
  await act(async () => (reports[0] as HTMLButtonElement).click())
  await click(host, 'Something else')
  await click(host, 'Send report')
  await settle()
  expect(sent).toEqual([{ kind: 'bench', targetId: 'p2', bench: 'walled-city:4', reason: 'other' }])
})

it('ProfileSheet: the privacy line sits by the pledge, and a block with no saved name reads "Koi"', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json([{ id: 'p9', name: null }])),
  )
  const me: Me = {
    id: 'u',
    complete: true,
    verified: false,
    profile: {
      id: 'u',
      name: 'Asha',
      look: ravi.look,
      status: '',
      homeArea: 'Raja Park',
      hereFor: null,
      about: '',
      pauseRequests: false,
      stamps: [],
    },
  }
  const host = await render(
    <ProfileSheet
      me={me}
      lang="hi"
      token={async () => 'tok'}
      onSave={async () => ({ ok: true })}
      onClose={() => {}}
      onSignOut={() => {}}
    />,
  )
  expect(host.textContent).toContain(
    'Agar koi baat-cheet report hoti hai, toh moderator uske haal ke messages padh sakta hai.',
  )
  expect(host.querySelector('.blocked-list li span')?.textContent).toBe('Koi')
})

function SheetHost({ onSheet, onReport }: { onSheet: () => void; onReport: () => void }) {
  const ref = useDialog<HTMLElement>(onSheet)
  return (
    <section ref={ref} role="dialog" aria-modal="true">
      <ReportSheet
        kind="person"
        targetId="h"
        name="Ravi"
        lang="en"
        token={async () => 'tok'}
        onClose={onReport}
      />
    </section>
  )
}

it('Escape inside a report sheet closes the report, not the sheet it sits in', async () => {
  const onSheet = vi.fn()
  const onReport = vi.fn()
  const host = await render(<SheetHost onSheet={onSheet} onReport={onReport} />)
  const inside = host.querySelector<HTMLElement>('.report-sheet button')!
  inside.focus()
  await act(
    async () => void inside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
  expect(onReport).toHaveBeenCalledTimes(1)
  expect(onSheet).not.toHaveBeenCalled()
  // and with focus on the sheet itself the sheet still answers its own Escape
  const sheet = host.querySelector<HTMLElement>('section')!
  await act(
    async () => void sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
  expect(onSheet).toHaveBeenCalledTimes(1)
})
