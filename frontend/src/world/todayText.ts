import { t, type Lang, type StringKey } from '../i18n/strings'
import type { DistrictId } from '../net/protocol'
import { STAMP_DISTRICT } from './darshan'
import { DISTRICT_NAMES, DISTRICT_SHORT_NAMES } from './districtNames'
import { stampName } from './stamps'
import type { Goal, GoalKind } from './today'

const GOAL: Record<GoalKind, [StringKey, StringKey]> = {
  darshan: ['todayGoalDarshan', 'todayHintDarshan'],
  tapri: ['todayGoalTapri', 'todayHintTapri'],
  ride: ['todayGoalRide', 'todayHintRide'],
  auto: ['todayGoalAuto', 'todayHintAuto'],
  photo: ['todayGoalPhoto', 'todayHintPhoto'],
  roof: ['todayGoalRoof', 'todayHintRoof'],
  map: ['todayGoalMap', 'todayHintMap'],
  animal: ['todayGoalAnimal', 'todayHintAnimal'],
  cricket: ['todayGoalCricket', 'todayHintCricket'],
  touch: ['todayGoalTouch', 'todayHintTouch'],
  swaad: ['todayGoalSwaad', 'todayHintSwaad'],
  show: ['todayGoalShow', 'todayHintShow'],
  emote: ['todayGoalEmote', 'todayHintEmote'],
}

/**
 * Where the goals that are not in every district can be done, so the goal says where: the districts with a
 * cricket pitch, and those with a show that is out at any hour (never the evening's dancers). Kept here, out of
 * the district chunks, as `STAMP_DISTRICT` is; the test holds both to the districts' own definitions.
 */
export const CRICKET_DISTRICTS: readonly DistrictId[] = ['walled-city', 'mi-road', 'malviya-nagar']
export const SHOW_DISTRICTS: Record<'kathputli' | 'ravanhatta', readonly DistrictId[]> = {
  kathputli: ['walled-city', 'amer'],
  ravanhatta: ['mi-road', 'nahargarh'],
}

/** Districts by their short names, as a phrase: "A, B ya C" for a choice, "A aur B" for all of them. */
function places(ids: readonly DistrictId[], lang: Lang, join: 'todayOr' | 'todayAnd'): string {
  const names = ids.map((id) => DISTRICT_SHORT_NAMES[id][lang])
  if (names.length < 2) return names.join('')
  return `${names.slice(0, -1).join(', ')} ${t(join, lang)} ${names[names.length - 1]}`
}

/** What a goal that is only in some districts fills its words with. */
function where(kind: GoalKind, lang: Lang): Record<string, string> {
  if (kind === 'cricket') return { places: places(CRICKET_DISTRICTS, lang, 'todayOr') }
  if (kind !== 'show') return {}
  const { kathputli, ravanhatta } = SHOW_DISTRICTS
  return {
    places: places([...kathputli, ...ravanhatta], lang, 'todayOr'),
    kathputli: places(kathputli, lang, 'todayAnd'),
    ravanhatta: places(ravanhatta, lang, 'todayAnd'),
  }
}

/** What the day's goal asks, and a hint for how, in `lang`. */
export function goalText(goal: Goal, lang: Lang): { goal: string; hint: string } {
  const [g, h] = GOAL[goal.kind]
  const district = goal.stamp ? STAMP_DISTRICT[goal.stamp] : undefined
  const vars = {
    place: goal.stamp ? stampName(goal.stamp, lang) : '',
    district: district ? DISTRICT_NAMES[district][lang] : '',
    ...where(goal.kind, lang),
  }
  return { goal: t(g, lang, vars), hint: t(h, lang, vars) }
}

/** The run, as the sheet says it. */
export function streakText(streak: number, best: number, lang: Lang): string {
  if (streak <= 0 && best <= 0) return t('todayStreakNone', lang)
  if (streak === 1) return t('todayStreakOne', lang, { best })
  return t('todayStreak', lang, { n: streak, best })
}
