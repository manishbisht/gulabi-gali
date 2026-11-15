import { useEffect, useState, type CSSProperties } from 'react'
import { t, type Lang } from '../i18n/strings'
import { footprint } from '../world/kit'
import { mapItems, targetDistance, type MapItem, type MapItemKind, type MapTarget } from '../world/cityMap'
import { PALETTE } from '../world/palette'
import type { DistrictDef, Vec2 } from '../world/types'
import { PlaceInvite } from './PlaceInvite'
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
/** In the page, landmarks first (a screen reader meets them before the benches); CSS stacks them on top. */
const ORDER: MapItemKind[] = ['landmark', 'metro', 'tapri', 'bench', 'poster']
/** Seats (benches and tapris) listed with the landmarks; the rest fold away under "more". */
const NEAR_SEATS = 3

/**
 * The district from above (north up), drawn from its definition: paving, buildings, landmarks, the metro,
 * benches and tapris, poster walls, you with your heading, and the people the street shows as plain dots.
 * Every place is a button: picking one makes it the compass's target. Every place also has a thumb-sized row in
 * the list under the map, nearest first: the landmarks, the metro and the nearest seats, then the other seats
 * and the poster walls folded away. A 22 px dot among its neighbours is no target for a thumb. Each row has
 * "Bulao" beside it: a link to that place to send someone.
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
  const away = (i: MapItem) => (view ? targetDistance(view.you, i) : 0)
  const byDistance = items
    .map((i) => ({ i, d: away(i) }))
    .sort((a, b) => a.d - b.d)
    .map(({ i }) => i)
  const seat = (i: MapItem) => i.kind === 'bench' || i.kind === 'tapri'
  const nearSeats = byDistance.filter(seat).slice(0, NEAR_SEATS)
  const listed = byDistance.filter(
    (i) => i.kind === 'landmark' || i.kind === 'metro' || nearSeats.includes(i),
  )
  const more = byDistance.filter((i) => !listed.includes(i))
  const row = (i: MapItem) => (
    <li key={i.id}>
      <button
        type="button"
        data-id={i.id}
        data-kind={i.kind}
        data-target={i.id === target || undefined}
        onClick={() => onPick(i)}
      >
        {view ? t('mapAway', lang, { name: label(i), m: Math.round(away(i)) }) : label(i)}
      </button>
      <PlaceInvite district={def.id} place={i} lang={lang} className="map-invite" />
    </li>
  )
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
                  data-id={i.id}
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
        <ul className="map-list">{listed.map(row)}</ul>
        {more.length > 0 && (
          <details className="map-more">
            <summary>{t('mapMore', lang, { n: more.length })}</summary>
            <ul className="map-list map-more-list">{more.map(row)}</ul>
          </details>
        )}
        <button type="button" className="auth-close" onClick={onClose}>
          {t('mapClose', lang)}
        </button>
      </section>
    </div>
  )
}
