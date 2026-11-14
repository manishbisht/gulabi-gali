import { t, type Lang, type StringKey } from '../i18n/strings'
import { HEADS, OUTFITS, SKINS } from '../player/avatar'
import { PALETTE } from '../world/palette'
import type { AvatarLook } from '../world/types'

const HEAD_LABEL: Record<AvatarLook['head'], StringKey> = {
  none: 'headNone',
  safa: 'headSafa',
  cap: 'headCap',
  dupatta: 'headDupatta',
  bun: 'headBun',
}

interface Props {
  look: AvatarLook
  lang: Lang
  onChange: (look: AvatarLook) => void
}

/**
 * Skin, outfit and head pickers over a flat 2D swatch of the figure. The preview is deliberately not a
 * second WebGL canvas: phones inside Instagram's browser can lose the one context they have.
 */
export function AvatarBuilder({ look, lang, onChange }: Props) {
  return (
    <fieldset className="avatar-builder">
      <legend>{t('profileLook', lang)}</legend>
      <div className="avatar-swatch" aria-hidden="true">
        <span className="swatch-head" style={{ background: SKINS[look.skin] }} data-head={look.head}>
          {look.head !== 'none' && (
            <i
              style={{
                background:
                  look.head === 'bun'
                    ? PALETTE.road
                    : look.head === 'dupatta'
                      ? PALETTE[look.outfit]
                      : look.head === 'cap'
                        ? PALETTE.white
                        : PALETTE.marigold,
              }}
            />
          )}
        </span>
        <span className="swatch-body" style={{ background: PALETTE[look.outfit] }} />
        <span className="swatch-legs" style={{ background: PALETTE.road }} />
      </div>
      <div className="pick-row" role="group" aria-label={t('profileSkin', lang)}>
        {SKINS.map((hex, i) => (
          <button
            key={hex}
            type="button"
            className="pick"
            style={{ background: hex }}
            aria-label={`${t('profileSkin', lang)} ${i + 1}`}
            aria-pressed={look.skin === i}
            onClick={() => onChange({ ...look, skin: i as AvatarLook['skin'] })}
          />
        ))}
      </div>
      <div className="pick-row" role="group" aria-label={t('profileOutfit', lang)}>
        {OUTFITS.map((key) => (
          <button
            key={key}
            type="button"
            className="pick"
            style={{ background: PALETTE[key] }}
            aria-label={`${t('profileOutfit', lang)}: ${key}`}
            aria-pressed={look.outfit === key}
            onClick={() => onChange({ ...look, outfit: key })}
          />
        ))}
      </div>
      <div className="pick-row" role="group" aria-label={t('profileHead', lang)}>
        {HEADS.map((head) => (
          <button
            key={head}
            type="button"
            className="pick pick-text"
            aria-pressed={look.head === head}
            onClick={() => onChange({ ...look, head })}
          >
            {t(HEAD_LABEL[head], lang)}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
