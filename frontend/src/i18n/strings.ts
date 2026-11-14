export type Lang = 'hi' | 'en'

export const STRINGS = {
  enter: { hi: 'Padharo!', en: 'Come in' },
  tagline: { hi: 'Jaipur ki gali, aapke phone mein', en: "Jaipur's lanes, on your phone" },
  stampGot: { hi: 'Jaipur Darshan · stamp mila: {place}', en: 'Stamp collected: {place}' },
  loading: { hi: 'Ruko zara, gali khul rahi hai…', en: 'One moment, the lane is opening…' },
  noWebgl: {
    hi: 'Is phone/browser pe 3D nahi chal raha. Chrome mein kholo — wahan chalega.',
    en: "3D doesn't run on this phone/browser. Open in Chrome and it should work.",
  },
  weatherUnknown: { hi: 'Mausam ka pata nahi', en: 'Weather unavailable' },
  langToggle: { hi: 'English', en: 'हिन्दी' },
  langToggleLabel: { hi: 'Bhasha badlo: English', en: 'Switch language: Hinglish' },
  joystickLabel: { hi: 'Chalne ka joystick', en: 'Walking joystick' },
} as const satisfies Record<string, Record<Lang, string>>

export type StringKey = keyof typeof STRINGS

export function t(key: StringKey, lang: Lang, vars?: Record<string, string | number>): string {
  const template: string = STRINGS[key][lang]
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}
