import type { Lang } from '../i18n/strings'
import type { DistrictId } from '../net/protocol'
import { STAMPS } from './stamps'

/** Which district each Jaipur Darshan landmark stands in. */
export const STAMP_DISTRICT: Record<string, DistrictId> = {
  'hawa-mahal': 'walled-city',
  'jantar-mantar': 'walled-city',
  'tripolia-gate': 'walled-city',
  'badi-chaupar': 'walled-city',
  'albert-hall': 'mi-road',
  'ram-niwas-gate': 'mi-road',
  'university-gate': 'university',
  jkk: 'university',
  wtp: 'malviya-nagar',
  'amer-fort': 'amer',
  'nahargarh-fort': 'nahargarh',
}

/** A one-line riddle per landmark, for the stamps not collected yet: it never says the name. */
export const STAMP_RIDDLE: Record<string, { hi: string; en: string }> = {
  'hawa-mahal': {
    hi: 'Gulabi deewar, hazaar ke kareeb jharokhe: andar thandak aati hai, nazar bahar jaati hai.',
    en: 'A pink wall of nearly a thousand tiny windows: the breeze walks in, a gaze walks out.',
  },
  'jantar-mantar': {
    hi: 'Patthar ke bade yantra, jahan parchhai se waqt padha jaata hai.',
    en: 'Giant stone instruments that read the hour from a shadow.',
  },
  'tripolia-gate': {
    hi: 'Teen darwaze, ek naam; bazaar iske kadmon se shuru hota hai.',
    en: 'Three arches under one name; the bazaar begins at its feet.',
  },
  'badi-chaupar': {
    hi: 'Jahan bazaar ke raaste milte hain aur poora shahar ek khuli jagah mein saans leta hai.',
    en: "Where the bazaar's roads meet and the whole city catches its breath in one open square.",
  },
  'albert-hall': {
    hi: 'Hariyali ke beech purani shaan ka ghar, jahan shahar ka khazana kaanch ke peeche rehta hai.',
    en: "An old-world museum in a garden, keeping the city's treasures behind glass.",
  },
  'ram-niwas-gate': {
    hi: 'Shahar ke sabse bade hare maidan ka darwaza: chhaanv, sair aur subah ki daud.',
    en: "The gate to the city's big green garden: shade, strolls and morning jogs.",
  },
  'university-gate': {
    hi: 'Kitabon aur jaldi mein cycles ka phatak; yahin se sapne class ki taraf chalte hain.',
    en: 'A gate of books and hurried bikes, where dreams set off for class.',
  },
  jkk: {
    hi: 'Rangon aur hunar ka ghar, nau khaanon ke naksha mein bana.',
    en: 'A house of art and colour, laid out in nine squares.',
  },
  wtp: {
    hi: 'Kaanch ka bada mall, jahan shaam ko Malviya Nagar chakkar lagane nikalta hai.',
    en: 'A big glass mall where Malviya Nagar goes window-shopping in the evening.',
  },
  'amer-fort': {
    hi: 'Pahadi pe shahi mahal, jo neeche jheel mein apni parchhai dekhta hai.',
    en: 'A palace up on the hill that watches its own reflection in the lake below.',
  },
  'nahargarh-fort': {
    hi: 'Pahadi ki dhaar pe lambi deewarein; shaam ko yahan se poora shahar suraj ko vida karta hai.',
    en: 'Long walls along a ridge; at dusk, the whole city below waves the sun goodbye from here.',
  },
}

export interface DarshanEntry {
  id: string
  name: string
  district: DistrictId
  /** The stamp is collected: its name shows; otherwise its riddle does. */
  got: boolean
  riddle: string
}

/** All the landmarks in stamp order, each marked collected or not. */
export function darshanEntries(ids: readonly string[], lang: Lang): DarshanEntry[] {
  return STAMPS.map((s) => ({
    id: s.id,
    name: s[lang],
    district: STAMP_DISTRICT[s.id],
    got: ids.includes(s.id),
    riddle: STAMP_RIDDLE[s.id]?.[lang] ?? '',
  }))
}

/** The "Jaipur Darshan poora" badge: every landmark stamped. Derived from the stamps, never stored. */
export const darshanComplete = (ids: readonly string[]): boolean => STAMPS.every((s) => ids.includes(s.id))
