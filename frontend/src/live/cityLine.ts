import type { Lang } from '../i18n/lang'
import type { AqiBand, CitySnapshot } from '../net/protocol'
import { morningMist } from './winter'

const HEAT_C = 42

const LINES = {
  rain: { hi: 'Baarish! Pakode ka time.', en: "It's raining! Pakora time." },
  dust: { hi: 'Aandhi aa rahi hai — aankhein bachao.', en: 'Dust storm coming, shield your eyes.' },
  heat: { hi: 'Lu chal rahi hai, Hukum. Paani peete raho.', en: 'Heatwave out there. Keep drinking water.' },
  mist: { hi: 'Kohre wali subah — garam chai ka time.', en: 'A foggy winter morning. Hot chai weather.' },
} satisfies Record<string, Record<Lang, string>>

const AIR: Record<AqiBand, Record<Lang, string>> = {
  good: {
    hi: 'Hawa saaf hai — Nahargarh tak dikh raha hai.',
    en: 'Clear air — you can see Nahargarh.',
  },
  moderate: { hi: 'Hawa theek-thaak hai. Chai pe chalo?', en: "The air's okay. Chai?" },
  poor: { hi: 'Thodi dhundh hai aaj. Mask rakh lo.', en: 'A bit hazy today. Keep a mask handy.' },
  unhealthy: {
    hi: 'Hawa kharab hai, Hukum — ghar pe raho.',
    en: 'The air is bad today. Best to stay in.',
  },
  severe: { hi: 'Hawa kharab hai, Hukum — ghar pe raho.', en: 'The air is bad today. Best to stay in.' },
}

/** The winter morning's mist (`morningMist`, 0 to 1) from which the city line speaks of it. */
const MISTY = 0.5

/**
 * One line of Jaipur small talk about today: storm/rain, then dust, then heat, then a misty winter morning
 * (only over clean or middling air: hazy or bad air keeps its own advice), then the air.
 */
export function cityLine(s: CitySnapshot, lang: Lang, now?: Date): string {
  if (s.condition === 'rain' || s.condition === 'storm') return LINES.rain[lang]
  if (s.condition === 'dust') return LINES.dust[lang]
  if (typeof s.tempC === 'number' && s.tempC >= HEAT_C) return LINES.heat[lang]
  if (now && (s.aqiBand === 'good' || s.aqiBand === 'moderate') && morningMist(now) >= MISTY)
    return LINES.mist[lang]
  return AIR[s.aqiBand][lang]
}
