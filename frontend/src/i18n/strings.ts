export type Lang = 'hi' | 'en'

export const STRINGS = {
  enter: { hi: 'Padharo!', en: 'Come in' },
  tagline: { hi: 'Jaipur ki gali, aapke phone mein', en: "Jaipur's lanes, on your phone" },
  stampGot: { hi: 'Jaipur Darshan · stamp mila: {place}', en: 'Stamp collected: {place}' },
  stampButton: { hi: 'Stamp lo', en: 'Collect stamp' },
  stampHave: { hi: 'Stamp mil chuka hai', en: 'Stamp already collected' },
  stampCount: { hi: 'Jaipur Darshan stamps', en: 'Jaipur Darshan stamps' },
  loading: { hi: 'Ruko zara, gali khul rahi hai…', en: 'One moment, the lane is opening…' },
  noWebgl: {
    hi: 'Is phone/browser pe 3D nahi chal raha. Chrome mein kholo — wahan chalega.',
    en: "3D doesn't run on this phone/browser. Open in Chrome and it should work.",
  },
  loadFailed: {
    hi: 'Gali nahi khul payi. Page reload karo.',
    en: "Couldn't open the lane. Reload the page.",
  },
  weatherUnknown: { hi: '—', en: '—' },
  langToggle: { hi: 'English', en: 'हिन्दी' },
  langToggleLabel: { hi: 'Bhasha badlo: English', en: 'Switch language: Hinglish' },
  festivalSankranti: {
    hi: 'Makar Sankranti mubarak! Aasmaan dekho 🪁',
    en: 'Happy Makar Sankranti! Look up 🪁',
  },
  festivalHoli: { hi: 'Holi mubarak! Rang barse 🎨', en: 'Happy Holi! Colours in the air 🎨' },
  festivalGangaur: { hi: 'Gangaur ki shubhkamnayein! 🌸', en: 'Happy Gangaur! 🌸' },
  festivalTeej: { hi: 'Teej ki shubhkamnayein! 🌿', en: 'Happy Teej! 🌿' },
  festivalDiwali: { hi: 'Diwali mubarak! Diye jagmagaye 🪔', en: 'Happy Diwali! The diyas are lit 🪔' },
  festivalJlf: { hi: 'Jaipur Literature Festival ki dhoom! 📚', en: 'Jaipur Literature Festival is on! 📚' },
  npcNotReal: {
    hi: 'Ye ek kirdaar hai, asli insaan nahi — asli log jald aa rahe hain.',
    en: 'This is a character, not a real person. Real people are coming soon.',
  },
  npcClose: { hi: 'Band karo', en: 'Close' },
  npcBadge: { hi: 'Kirdaar', en: 'Character' },
  joystickLabel: { hi: 'Chalne ka joystick', en: 'Walking joystick' },
  metro: { hi: 'Metro', en: 'Metro' },
  metroTitle: { hi: 'Kahan chalein?', en: 'Where to?' },
  metroClose: { hi: 'Band karo', en: 'Close' },
} as const satisfies Record<string, Record<Lang, string>>

export type StringKey = keyof typeof STRINGS

export function t(key: StringKey, lang: Lang, vars?: Record<string, string | number>): string {
  const template: string = STRINGS[key][lang]
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}
