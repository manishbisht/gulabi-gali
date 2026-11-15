import { useEffect, useState, type CSSProperties } from 'react'
import { t, type Lang } from '../i18n/strings'
import { footprint } from '../world/kit'
import { mapItems, targetDistance, type MapItem, type MapItemKind, type MapTarget } from '../world/cityMap'
import { PALETTE } from '../world/palette'
import type { DistrictDef, Vec2 } from '../world/types'
import { useDialog } from './useDialog'

/** What the map reads of the street while it is open: where you are and face, and who is drawn there. */
export interface MapView {
  you: Vec2
  /** The player's heading, radians about y (0 faces +z, south). */
  heading: number
  /** Only the people drawn on the street now (see `mapPeople`): plain points. */
  people: Vec2[]
}

interface Props {
  def: DistrictDef
  /** The landmark ids this visitor holds stamps for. */
  stamped: readonly string[]
  /** Read when the map opens and every `REFRESH_MS` while it is open. */
  read: () => MapView | null
  /** The current target, if any: marked on the map. */
  target?: string | null
  lang: Lang
  onPick: (t: MapTarget) => void
  onClose: () => void
}

/** How often an open map moves you and the people on it. */
const REFRESH_MS = 500

const GLYPH: Record<MapItemKind, string> = { landmark: '★', metro: 'M', bench: '▬', tapri: '☕', poster: '▤' }
/** Drawn first to last, so the landmarks sit on top of anything near them. */
const ORDER: MapItemKind[] = ['poster', 'bench', 'tapri', 'metro', 'landmark']

/**
 * The district from above (north up), drawn from its definition: paving, buildings, landmarks, the metro,
 * benches and tapris, poster walls, you with your heading, and the people the street shows as plain dots.
 * Every place is a button: picking one makes it the compass's target. A list under the map names the landmarks
 * and the metro with their distance, for anyone who would rather read than tap a dot.
 */
export function CityMap({ def, stamped, read, target, lang, onPick, onClose }: Props) {
  const ref = useDialog<HTMLElement>(onClose)
  const [view, setView] = useState(read)
  useEffect(() => {
    const timer = setInterval(() => setView(read()), REFRESH_MS)
    return () => clearInterval(timer)
  }, [read])
  const items = mapItems(def, stamped)
  const half = def.size / 2
  /** A point's place in the frame, as percentages. */
  const spot = (p: Vec2): CSSProperties => ({
    left: `${((p.x + half) / def.size) * 100}%`,
    top: `${((p.z + half) / def.size) * 100}%`,
  })
  const label = (i: MapItem) => (i.stamped ? t('mapStamped', lang, { name: i.name[lang] }) : i.name[lang])
  const listed = items.filter((i) => i.kind === 'landmark' || i.kind === 'metro')
  const title = t('mapTitle', lang, { place: def.name[lang] })
  return (
    <div className="auth-scrim">
      <section ref={ref} className="auth-sheet map-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <p className="map-help">{t('mapHelp', lang)}</p>
        <div className="map-frame">
          <svg className="map-svg" viewBox={`${-half} ${-half} ${def.size} ${def.size}`} aria-hidden="true">
            <rect x={-half} y={-half} width={def.size} height={def.size} fill={PALETTE[def.ground]} />
            {def.paving.map((p, i) => (
              <rect
                key={i}
                className="map-paving"
                x={p.minX}
                y={p.minZ}
                width={p.maxX - p.minX}
                height={p.maxZ - p.minZ}
                fill={PALETTE[p.color]}
              />
            ))}
            {def.buildings.map((b, i) => {
              const f = footprint(b)
              return (
                <rect
                  key={i}
                  className="map-block"
                  x={f.minX}
                  y={f.minZ}
                  width={f.maxX - f.minX}
                  height={f.maxZ - f.minZ}
                  fill={PALETTE[b.tint ?? 'pink']}
                />
              )
            })}
            {def.landmarks.map((l) => (
              <rect
                key={l.id}
                className="map-landmark"
                x={l.footprint.minX}
                y={l.footprint.minZ}
                width={l.footprint.maxX - l.footprint.minX}
                height={l.footprint.maxZ - l.footprint.minZ}
              />
            ))}
          </svg>
          {ORDER.flatMap((kind) =>
            items
              .filter((i) => i.kind === kind)
              .map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className="map-item"
                  data-kind={i.kind}
                  data-stamped={i.stamped || undefined}
                  data-target={i.id === target || undefined}
                  style={spot(i.at)}
                  aria-label={label(i)}
                  onClick={() => onPick(i)}
                >
                  <span aria-hidden="true">{i.stamped ? '✓' : GLYPH[i.kind]}</span>
                </button>
              )),
          )}
          {view && (
            // over the places, so a bench never hides you or the people; taps go through to the places
            <svg
              className="map-svg map-over"
              viewBox={`${-half} ${-half} ${def.size} ${def.size}`}
              aria-hidden="true"
            >
              <g className="map-people">
                {view.people.map((p, i) => (
                  <circle key={i} className="map-person" cx={p.x} cy={p.z} r={def.size / 90} />
                ))}
              </g>
              {/* an arrowhead drawn pointing north, turned to face where the player faces */}
              <g
                className="map-you"
                transform={`translate(${view.you.x} ${view.you.z}) rotate(${Math.round(180 - (view.heading * 180) / Math.PI)})`}
              >
                <path
                  d={`M0 ${-def.size / 28} L${def.size / 45} ${def.size / 45} L${-def.size / 45} ${def.size / 45} Z`}
                />
              </g>
            </svg>
          )}
        </div>
        <p className="map-legend">
          <span className="map-legend-you" aria-hidden="true">
            ▲
          </span>{' '}
          {t('mapYou', lang)} ·{' '}
          <span className="map-legend-people" aria-hidden="true">
            ●
          </span>{' '}
          {t('mapPeople', lang, { n: view?.people.length ?? 0 })}
        </p>
        <h3 className="map-places">{t('mapPlaces', lang)}</h3>
        <ul className="map-list">
          {listed.map((i) => (
            <li key={i.id}>
              <button type="button" data-target={i.id === target || undefined} onClick={() => onPick(i)}>
                {view
                  ? t('mapAway', lang, { name: label(i), m: Math.round(targetDistance(view.you, i)) })
                  : label(i)}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="auth-close" onClick={onClose}>
          {t('mapClose', lang)}
        </button>
      </section>
    </div>
  )
}
