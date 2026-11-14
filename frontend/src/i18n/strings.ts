export type Lang = 'hi' | 'en'

export const STRINGS = {
  enter: { hi: 'Padharo!', en: 'Come in' },
  tagline: { hi: 'Jaipur ki gali, aapke phone mein', en: "Jaipur's lanes, on your phone" },
  stampGot: { hi: 'Jaipur Darshan · stamp mila: {place}', en: 'Stamp collected: {place}' },
  loading: { hi: 'Ruko zara, gali khul rahi hai…', en: 'One moment, the lane is opening…' },
  noWebgl: {
    hi: 'Hukum, is phone par 3D nahi chal raha. Dusra browser try karo.',
    en: "Sorry, 3D isn't working on this phone. Try another browser.",
  },
  weatherUnknown: { hi: 'Mausam ka pata nahi', en: 'Weather unavailable' },
  langToggle: { hi: 'English', en: 'हिन्दी' },
  langToggleLabel: { hi: 'Bhasha badlo: English', en: 'Switch language: Hinglish' },
} as const satisfies Record<string, Record<Lang, string>>

export type StringKey = keyof typeof STRINGS

export function t(key: StringKey, lang: Lang, vars?: Record<string, string | number>): string {
  const template: string = STRINGS[key][lang]
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}
