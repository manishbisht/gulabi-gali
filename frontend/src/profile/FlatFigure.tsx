import { dressOfLook, TONES } from '../player/avatar'
import { OUTFITS } from '../net/protocol'
import { PALETTE, type PaletteKey } from '../world/palette'
import type { AvatarLook } from '../world/types'

const colour = (i: number) => PALETTE[(OUTFITS[i] ?? 'marigold') as PaletteKey]

/**
 * A flat 2D swatch of the figure: skin, headwear (or a dupatta over the head, or a bun), kurta and legs. Drawn
 * where a second WebGL canvas is not wanted (the profile sheet) or not to be had.
 */
export function FlatFigure({ look }: { look: AvatarLook }) {
  const d = dressOfLook(look)
  const top = d.hat ? colour(d.hatC) : d.dup === 1 ? colour(d.dupC) : d.hair >= 1 ? PALETTE.road : null
  return (
    <div className="avatar-swatch" aria-hidden="true">
      <span className="swatch-head" style={{ background: TONES[d.tone] }}>
        {top && <i style={{ background: top }} />}
      </span>
      <span
        className="swatch-body"
        style={{
          background: PALETTE[look.outfit],
          // a stole round the shoulders shows as a band across the top
          boxShadow: d.dup === 2 || (d.dup === 1 && d.hat) ? `inset 0 10px 0 ${colour(d.dupC)}` : undefined,
        }}
      />
      <span className="swatch-legs" style={{ background: PALETTE.road }} />
    </div>
  )
}
