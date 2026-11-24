// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Lang } from '../i18n/strings'
import type { ProfileInput } from '../net/api'
import { dressOfLook } from '../player/avatar'
import type { AvatarLook } from '../world/types'
import LookEditor, { type LookEditorMode } from './LookEditor'
import { ProfileSheet } from './ProfileSheet'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const LOOK: AvatarLook = { skin: 2, outfit: 'teal', head: 'safa' }

async function open(
  {
    lang = 'en',
    mode = 'local',
    look = LOOK,
  }: { lang?: Lang; mode?: LookEditorMode; look?: AvatarLook } = {},
  onSave: (l: AvatarLook) => Promise<boolean> | boolean = vi.fn(() => true),
  onCancel = vi.fn(),
) {
  await act(async () =>
    root.render(<LookEditor look={look} lang={lang} mode={mode} onSave={onSave} onCancel={onCancel} />),
  )
  return { onSave, onCancel }
}

const dialog = () => host.querySelector('[role="dialog"]') as HTMLElement
/** The radio groups, each by its legend: what a screen reader announces on entering it. */
const groups = () =>
  [...host.querySelectorAll('fieldset.look-group')].map((f) => ({
    legend: f.querySelector('legend')!.textContent,
    radios: [...f.querySelectorAll<HTMLInputElement>('input[type="radio"]')],
  }))
const group = (legend: string) => groups().find((g) => g.legend === legend)!
/** A radio's accessible name: its aria-label, or the text of the label around it. */
const nameOf = (r: HTMLInputElement) => r.getAttribute('aria-label') ?? r.closest('label')!.textContent
const radio = (legend: string, name: string) => group(legend).radios.find((r) => nameOf(r) === name)!
const pick = (r: HTMLInputElement) => act(async () => r.click())
/** A button by its text, in the dressing room when it is open (the profile sheet has a Save of its own). */
const button = (text: string) =>
  [...(host.querySelector('.look-editor') ?? host).querySelectorAll('button')].find(
    (b) => b.textContent === text,
  ) as HTMLButtonElement

describe('the dressing room', () => {
  it('is a labelled modal dialog of labelled radio groups, every option named by garment or colour', async () => {
    await open()
    expect(dialog().getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog().getAttribute('aria-labelledby')!)!.textContent).toBe('Your look')
    expect(groups().map((g) => g.legend)).toEqual([
      'Skin tone',
      'Kurta or shirt colour',
      'On the head',
      'Colour of the safa, pagdi or cap',
      'Dupatta or stole',
      'Hair',
    ])
    expect(group('Skin tone').radios.map(nameOf)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Tone ${n}`))
    expect(group('On the head').radios.map(nameOf)).toEqual(['Nothing', 'Safa', 'Pagdi', 'Cap'])
    expect(group('Dupatta or stole').radios.map(nameOf)).toEqual([
      'None',
      'Over the head',
      'On the shoulders',
    ])
    expect(group('Hair').radios.map(nameOf)).toEqual(['Close crop', 'Bun', 'Short', 'Long', 'Plait'])
    expect(group('Kurta or shirt colour').radios.map(nameOf)).toContain('Marigold')
    for (const g of groups()) {
      // one name per group, so arrow keys move within it and Tab moves between groups
      expect(new Set(g.radios.map((r) => r.name)).size, g.legend!).toBe(1)
      for (const r of g.radios) expect(nameOf(r), g.legend!).toBeTruthy()
    }
    // no word anywhere ties a garment to who wears it
    expect(dialog().textContent!.toLowerCase()).not.toMatch(
      /\b(men|women|male|female|boy|girl|hindu|muslim|sikh)\b/,
    )
  })

  it('in Hinglish too: tones are "Rang 1" to "Rang 8", never light or dark', async () => {
    await open({ lang: 'hi' })
    expect(group('Rang').radios.map(nameOf)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Rang ${n}`))
    expect(dialog().textContent).toContain('Apna roop')
    expect(dialog().textContent!.toLowerCase()).not.toMatch(/gora|kaala rang|saanwla|fair|light|dark/)
  })

  it('starts on the look as it is: an older safa is a marigold safa, its tone the same skin', async () => {
    await open()
    expect(radio('Skin tone', 'Tone 4').checked).toBe(true) // skin 2 is tone 3, the fourth
    expect(radio('On the head', 'Safa').checked).toBe(true)
    expect(radio('Colour of the safa, pagdi or cap', 'Marigold').checked).toBe(true)
    expect(radio('Kurta or shirt colour', 'Teal').checked).toBe(true)
    expect(radio('Dupatta or stole', 'None').checked).toBe(true)
    expect(radio('Hair', 'Close crop').checked).toBe(true)
  })

  it('shows a headwear or dupatta colour only while one is worn; headwear moves a dupatta to the shoulders', async () => {
    await open()
    await pick(radio('On the head', 'Nothing'))
    expect(groups().map((g) => g.legend)).not.toContain('Colour of the safa, pagdi or cap')
    await pick(radio('Dupatta or stole', 'Over the head'))
    expect(groups().map((g) => g.legend)).toContain('Dupatta colour')
    await pick(radio('On the head', 'Pagdi'))
    expect(radio('Dupatta or stole', 'On the shoulders').checked).toBe(true)
    await pick(radio('Dupatta or stole', 'Over the head'))
    expect(radio('On the head', 'Nothing').checked).toBe(true)
  })

  it('headwear put on fresh starts in its old colour: a white cap, a marigold safa; a change of style keeps the colour', async () => {
    await open({ look: { skin: 1, outfit: 'teal', head: 'none' } })
    const colour = 'Colour of the safa, pagdi or cap'
    await pick(radio('On the head', 'Cap'))
    expect(radio(colour, 'White').checked).toBe(true)
    await pick(radio(colour, 'Blue'))
    await pick(radio('On the head', 'Safa'))
    expect(radio(colour, 'Blue').checked).toBe(true)
    await pick(radio('On the head', 'Nothing'))
    await pick(radio('On the head', 'Pagdi'))
    expect(radio(colour, 'Marigold').checked).toBe(true)
  })

  it('Save hands over every choice; Cancel and Escape change nothing', async () => {
    const { onSave, onCancel } = await open()
    await pick(radio('Skin tone', 'Tone 8'))
    await pick(radio('On the head', 'Pagdi'))
    await pick(radio('Colour of the safa, pagdi or cap', 'Pink'))
    await pick(radio('Dupatta or stole', 'On the shoulders'))
    await pick(radio('Dupatta colour', 'Green'))
    await pick(radio('Kurta or shirt colour', 'White'))
    await pick(radio('Hair', 'Plait'))
    await act(async () => button('Save').click())
    expect(onSave).toHaveBeenCalledTimes(1)
    const saved = vi.mocked(onSave).mock.calls[0]![0]
    expect(saved.outfit).toBe('white')
    expect(dressOfLook(saved)).toEqual({ tone: 7, hat: 2, hatC: 0, dup: 2, dupC: 8, hair: 4 })
    // and the older fields an older client draws
    expect(saved).toMatchObject({ skin: 4, head: 'safa' })
    expect(onCancel).not.toHaveBeenCalled()

    await act(async () => button('Cancel').click())
    expect(onCancel).toHaveBeenCalledTimes(1)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('says when a save did not go through, and stays open', async () => {
    const onSave = vi.fn(async () => false)
    await open({ mode: 'save' }, onSave)
    await act(async () => button('Save').click())
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Couldn't save. Try again.")
    expect(dialog()).not.toBeNull()
  })

  it('tells a guest the look stays on this phone; without WebGL it shows the flat figure', async () => {
    await open({ mode: 'local' })
    expect(dialog().textContent).toContain('This look stays on this phone')
    // happy-dom has no WebGL: the turning figure gives way to the flat one
    expect(host.querySelector('canvas.look-preview')).toBeNull()
    expect(host.querySelector('.look-canvas')!.hasAttribute('hidden')).toBe(true)
    expect(host.querySelector('.avatar-swatch')).not.toBeNull()
  })

  it('Tab stays inside it, and focus starts on it', async () => {
    await open()
    expect(document.activeElement).toBe(dialog())
    const last = button('Save')
    last.focus()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(dialog().contains(document.activeElement)).toBe(true)
  })
})

describe('from the profile sheet', () => {
  const profile = {
    id: 'u',
    name: 'Asha Sharma',
    look: { skin: 1, outfit: 'pink', head: 'none' } as const,
    status: 'chai pe',
    homeArea: 'Raja Park' as const,
    hereFor: 'art' as const,
    about: 'Painter',
    pauseRequests: false,
    stamps: [],
  }

  async function sheet(
    complete: boolean,
    onSave = vi.fn<(p: ProfileInput) => Promise<{ ok: true }>>(async () => ({ ok: true })),
  ) {
    await act(async () =>
      root.render(
        <ProfileSheet
          me={{ id: 'u', profile: complete ? profile : null, complete, verified: false }}
          lang="en"
          onSave={onSave}
          onClose={() => {}}
          onSignOut={() => {}}
        />,
      ),
    )
    await act(async () => button('Dress up').click())
    // the editor is fetched on first use
    await vi.waitFor(() => expect(host.querySelector('.look-editor')).not.toBeNull())
    return onSave
  }

  it("a resident's Save saves the look alone, with the rest of the profile as stored", async () => {
    const onSave = await sheet(true)
    // an unsaved edit in the form waits for the form's own Save
    await pick(radio('Hair', 'Long'))
    await act(async () => button('Save').click())
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]![0]).toEqual({
      name: 'Asha Sharma',
      look: expect.objectContaining({ hair: 3, outfit: 'pink' }),
      status: 'chai pe',
      homeArea: 'Raja Park',
      hereFor: 'art',
      about: 'Painter',
      adult: true,
      pledge: true,
      pauseRequests: false,
    })
    expect(host.querySelector('.look-editor')).toBeNull()
  })

  it('a profile not yet made takes the look into the form, saved with it', async () => {
    const onSave = await sheet(false)
    expect(host.querySelector('.look-editor')!.textContent).toContain(
      'Everyone sees it once you save your profile',
    )
    await pick(radio('Hair', 'Bun'))
    await act(async () => button('Done').click())
    expect(onSave).not.toHaveBeenCalled()
    expect(host.querySelector('.look-editor')).toBeNull()
  })
})
