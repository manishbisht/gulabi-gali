import { t, type Lang, type StringKey } from '../i18n/strings'
import { STAMP_DISTRICT } from './darshan'
import { DISTRICT_NAMES } from './districtNames'
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
}

/** What the day's goal asks, and a hint for how, in `lang`. */
export function goalText(goal: Goal, lang: Lang): { goal: string; hint: string } {
  const [g, h] = GOAL[goal.kind]
  const district = goal.stamp ? STAMP_DISTRICT[goal.stamp] : undefined
  const vars = {
    place: goal.stamp ? stampName(goal.stamp, lang) : '',
    district: district ? DISTRICT_NAMES[district][lang] : '',
  }
  return { goal: t(g, lang, vars), hint: t(h, lang, vars) }
}

/** The run, as the sheet says it. */
export function streakText(streak: number, best: number, lang: Lang): string {
  if (streak <= 0 && best <= 0) return t('todayStreakNone', lang)
  if (streak === 1) return t('todayStreakOne', lang, { best })
  return t('todayStreak', lang, { n: streak, best })
}
