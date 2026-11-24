import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { t, type Lang, type StringKey } from '../i18n/strings'
import { DUPATTAS, HAIRS, HATS, OUTFITS as WIRE_OUTFITS, type Dress } from '../net/protocol'
import { dressLook, dressOfLook, OUTFITS, TONES } from '../player/avatar'
import { useDialog } from '../ui/useDialog'
import { PALETTE, type PaletteKey } from '../world/palette'
import type { AvatarLook } from '../world/types'
import { FlatFigure } from './FlatFigure'
import { createLookPreview, type LookPreview } from './lookPreview'

const HAT_LABEL: Record<(typeof HATS)[number], StringKey> = {
  none: 'lookHatNone',
  safa: 'lookHatSafa',
  pagdi: 'lookHatPagdi',
  cap: 'lookHatCap',
}
const DUP_LABEL: Record<(typeof DUPATTAS)[number], StringKey> = {
  off: 'lookDupOff',
  head: 'lookDupHead',
  shoulders: 'lookDupShoulders',
}
const HAIR_LABEL: Record<(typeof HAIRS)[number], StringKey> = {
  crop: 'lookHairCrop',
  bun: 'lookHairBun',
  short: 'lookHairShort',
  long: 'lookHairLong',
  plait: 'lookHairPlait',
}
const COLOUR_LABEL: Record<PaletteKey, StringKey> = {
  pink: 'colourPink',
  terracotta: 'colourTerracotta',
  sandstone: 'colourSandstone',
  ochre: 'colourOchre',
  white: 'colourWhite',
  teal: 'colourTeal',
  marigold: 'colourMarigold',
  road: 'colourRoad',
  grass: 'colourGrass',
  glass: 'colourGlass',
}

/**
 * `save`: a resident's look, saved to their profile now. `apply`: a profile not yet made, so the look goes into
 * the form and is saved with it. `local`: a ghost's, kept on this device only.
 */
export type LookEditorMode = 'save' | 'apply' | 'local'

interface Props {
  look: AvatarLook
  lang: Lang
  mode: LookEditorMode
  /** Keeps the look; true when it was kept (the editor then closes), false to say it could not be. */
  onSave: (look: AvatarLook) => Promise<boolean> | boolean
  onCancel: () => void
}

/** A radio group: a fieldset whose legend names it, its options in one wrapping row. */
function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="look-group">
      <legend>{legend}</legend>
      <div className="look-row">{children}</div>
    </fieldset>
  )
}

/** One colour of a group: the radio itself is the swatch, named by its colour (never by its look). */
function Swatch(props: { name: string; hex: string; label: string; checked: boolean; onPick: () => void }) {
  return (
    <input
      type="radio"
      className="look-swatch"
      name={props.name}
      aria-label={props.label}
      checked={props.checked}
      onChange={props.onPick}
      style={{ background: props.hex }}
    />
  )
}

/** One worded option of a group. */
function Chip(props: { name: string; label: string; checked: boolean; onPick: () => void }) {
  return (
    <label className="look-chip">
      <input type="radio" name={props.name} checked={props.checked} onChange={props.onPick} />
      <span>{props.label}</span>
    </label>
  )
}

const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The dressing room: skin tone, kurta colour, headwear and its colour, a dupatta or stole and its colour, hair.
 * Every choice is a native radio in a labelled group, so the keyboard (Tab between groups, arrows within) and a
 * screen reader work as they do anywhere. The figure turns live above the choices; Cancel (or Escape) changes
 * nothing.
 */
export default function LookEditor({ look, lang, mode, onSave, onCancel }: Props) {
  const ref = useDialog<HTMLElement>(onCancel)
  const id = useId()
  const [draft, setDraft] = useState<AvatarLook>(() => dressLook(look, {}))
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [has3d, setHas3d] = useState(true)
  const canvas = useRef<HTMLCanvasElement>(null)
  const preview = useRef<LookPreview | null>(null)
  const drag = useRef<{ pointer: number; x: number } | null>(null)
  const d = dressOfLook(draft)

  useEffect(() => {
    if (!canvas.current) return
    const p = createLookPreview(canvas.current, draft, reduced())
    preview.current = p
    if (!p) setHas3d(false)
    return () => {
      p?.dispose()
      preview.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- made once; `show` follows the draft below
  }, [])
  useEffect(() => preview.current?.show(draft), [draft])

  const change = (next: Partial<Dress>, outfit?: PaletteKey) => {
    setFailed(false)
    setDraft((was) => dressLook(was, next, outfit))
  }
  // a dupatta over the head and headwear do not go together: picking one moves the dupatta to the shoulders
  const pickHat = (hat: number) => change(hat && d.dup === 1 ? { hat, dup: 2 } : { hat })
  const pickDup = (dup: number) => change(dup === 1 && d.hat ? { dup, hat: 0 } : { dup })

  const save = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    const kept = await onSave(draft)
    setBusy(false)
    if (!kept) setFailed(true)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    drag.current = { pointer: e.pointerId, x: e.clientX }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const at = drag.current
    if (!at || at.pointer !== e.pointerId) return
    preview.current?.turn((e.clientX - at.x) * 0.012)
    at.x = e.clientX
  }
  const onPointerUp = () => void (drag.current = null)

  const name = (group: string) => `${id}-${group}`
  const colours = (group: string, current: number, pick: (i: number) => void) =>
    OUTFITS.map((key) => {
      const i = WIRE_OUTFITS.indexOf(key)
      return (
        <Swatch
          key={key}
          name={name(group)}
          hex={PALETTE[key]}
          label={t(COLOUR_LABEL[key], lang)}
          checked={current === i}
          onPick={() => pick(i)}
        />
      )
    })

  return (
    <div className="auth-scrim look-scrim">
      <section
        ref={ref}
        className="auth-sheet look-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={name('title')}
      >
        <h2 id={name('title')}>{t('lookTitle', lang)}</h2>
        <div className="look-stage">
          <canvas
            ref={canvas}
            className="look-preview"
            aria-hidden="true"
            hidden={!has3d}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {has3d ? <small className="look-drag">{t('lookDrag', lang)}</small> : <FlatFigure look={draft} />}
        </div>
        <div className="look-options">
          <Group legend={t('lookTone', lang)}>
            {TONES.map((hex, i) => (
              <Swatch
                key={hex}
                name={name('tone')}
                hex={hex}
                label={t('lookToneN', lang, { n: i + 1 })}
                checked={d.tone === i}
                onPick={() => change({ tone: i })}
              />
            ))}
          </Group>
          <Group legend={t('lookTop', lang)}>
            {OUTFITS.map((key) => (
              <Swatch
                key={key}
                name={name('top')}
                hex={PALETTE[key]}
                label={t(COLOUR_LABEL[key], lang)}
                checked={draft.outfit === key}
                onPick={() => change({}, key)}
              />
            ))}
          </Group>
          <Group legend={t('lookHead', lang)}>
            {HATS.map((hat, i) => (
              <Chip
                key={hat}
                name={name('hat')}
                label={t(HAT_LABEL[hat], lang)}
                checked={d.hat === i}
                onPick={() => pickHat(i)}
              />
            ))}
          </Group>
          {d.hat > 0 && (
            <Group legend={t('lookHatColour', lang)}>
              {colours('hatC', d.hatC, (hatC) => change({ hatC }))}
            </Group>
          )}
          <Group legend={t('lookDupatta', lang)}>
            {DUPATTAS.map((dup, i) => (
              <Chip
                key={dup}
                name={name('dup')}
                label={t(DUP_LABEL[dup], lang)}
                checked={d.dup === i}
                onPick={() => pickDup(i)}
              />
            ))}
          </Group>
          {d.dup > 0 && (
            <Group legend={t('lookDupColour', lang)}>
              {colours('dupC', d.dupC, (dupC) => change({ dupC }))}
            </Group>
          )}
          <Group legend={t('lookHair', lang)}>
            {HAIRS.map((hair, i) => (
              <Chip
                key={hair}
                name={name('hair')}
                label={t(HAIR_LABEL[hair], lang)}
                checked={d.hair === i}
                onPick={() => change({ hair: i })}
              />
            ))}
          </Group>
        </div>
        {mode !== 'save' && (
          <p className="look-note">{t(mode === 'local' ? 'lookLocal' : 'lookApplyNote', lang)}</p>
        )}
        {failed && <p role="alert">{t('lookSaveFailed', lang)}</p>}
        <div className="look-actions">
          <button type="button" onClick={onCancel}>
            {t('lookCancel', lang)}
          </button>
          <button type="button" className="look-save" disabled={busy} onClick={() => void save()}>
            {t(busy ? 'lookSaving' : mode === 'apply' ? 'lookApply' : 'lookSave', lang)}
          </button>
        </div>
      </section>
    </div>
  )
}
