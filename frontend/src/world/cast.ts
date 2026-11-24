import type { NpcDef } from './types'

type Character = Omit<NpcDef, 'route' | 'speed'>

/*
 * The thirteen seed characters: fictional, every line original. Each district gives its own a route and a
 * speed; the words and faces live here. `hi` is the Hinglish line, `en` its English.
 */
export const CAST = {
  kavya: {
    id: 'kavya',
    name: 'Kavya',
    role: { hi: 'RAS aspirant', en: 'RAS aspirant' },
    status: {
      hi: 'RAS mains ki tayyari. Study partner chahiye.',
      en: 'Preparing for RAS mains. Looking for a study partner.',
    },
    look: { skin: 1, outfit: 'teal', head: 'bun' },
  },
  imran: {
    id: 'imran',
    name: 'Imran',
    role: { hi: 'Blue pottery kaarigar', en: 'Blue-pottery artisan' },
    status: { hi: 'Neela rang, Jaipur ka dil.', en: "Blue is the colour of Jaipur's heart." },
    look: { skin: 2, outfit: 'teal', head: 'cap' },
  },
  sunita: {
    id: 'sunita',
    name: 'Sunita ji',
    role: { hi: 'Bapu Bazaar ki dukaandaar', en: 'Bapu Bazaar shopkeeper' },
    status: { hi: 'Mojri le lo, ekdum fit aayegi.', en: 'Take these mojris, they will fit you perfectly.' },
    look: { skin: 2, outfit: 'marigold', head: 'dupatta' },
  },
  aarav: {
    id: 'aarav',
    name: 'Aarav',
    role: { hi: 'RU mein first year', en: 'First year at RU' },
    status: { hi: 'Pehla saal, sab naya.', en: 'First year, everything is new.' },
    look: { skin: 3, outfit: 'ochre', head: 'none' },
  },
  meera: {
    id: 'meera',
    name: 'Meera',
    role: { hi: 'Kavyitri', en: 'Poet' },
    status: { hi: 'Thursday open mic, JKK. Aaoge?', en: 'Thursday open mic at JKK. Coming?' },
    look: { skin: 1, outfit: 'terracotta', head: 'dupatta' },
  },
  raju: {
    id: 'raju',
    name: 'Raju',
    role: { hi: 'Auto driver', en: 'Auto driver' },
    status: { hi: 'Kahan chalna hai, Hukum?', en: 'Where to, boss?' },
    look: { skin: 3, outfit: 'sandstone', head: 'none' },
  },
  farhan: {
    id: 'farhan',
    name: 'Farhan',
    role: { hi: 'Gully cricket ka captain', en: 'Gully cricket captain' },
    status: { hi: 'Sunday gully cricket — 8 log chahiye.', en: 'Sunday gully cricket: we need 8 players.' },
    look: { skin: 2, outfit: 'grass', head: 'cap' },
  },
  neha: {
    id: 'neha',
    name: 'Neha',
    role: { hi: 'Developer', en: 'Developer' },
    status: { hi: 'Code likhti hoon, chai peeti hoon.', en: 'I write code and drink chai.' },
    look: { skin: 1, outfit: 'pink', head: 'bun' },
  },
  ramesh: {
    id: 'ramesh',
    name: 'Ramesh ji',
    role: { hi: 'Lassiwala', en: 'Lassi seller' },
    status: {
      hi: 'Ek lassi, aur saari thakaan gayab.',
      en: 'One lassi and all your tiredness vanishes.',
    },
    look: { skin: 3, outfit: 'white', head: 'safa' },
  },
  gopal: {
    id: 'gopal',
    name: 'Gopal ji',
    role: { hi: 'Purane guide', en: 'Old-hand guide' },
    status: {
      hi: 'Chadhai dheere karo, kahaniyan upar tak saath chalengi.',
      en: 'Take the climb slowly; the stories walk up with you.',
    },
    look: { skin: 3, outfit: 'ochre', head: 'safa' },
  },
  shabnam: {
    id: 'shabnam',
    name: 'Shabnam',
    role: { hi: 'Lakh ki chudiyon wali', en: 'Lac-bangle maker' },
    status: {
      hi: 'Garam lakh, thanda haath. Ek jodi pehen ke dekho?',
      en: 'Warm lac, steady hands. Try a pair on?',
    },
    look: { skin: 2, outfit: 'pink', head: 'dupatta' },
  },
  bhanwar: {
    id: 'bhanwar',
    name: 'Bhanwar ji',
    role: { hi: 'Bhutte wale', en: 'Roasted-corn seller' },
    status: {
      hi: 'Garam bhutta, thandi hawa. Suraj dhalne tak yahin hoon.',
      en: "Hot corn, a cool wind. I'm here till the sun goes down.",
    },
    look: { skin: 3, outfit: 'terracotta', head: 'safa' },
  },
  tara: {
    id: 'tara',
    name: 'Tara',
    role: { hi: 'Photography ki student', en: 'Photography student' },
    status: {
      hi: 'Golden hour ka intezaar hai. Tripod pakdoge?',
      en: 'Waiting for the golden hour. Hold my tripod?',
    },
    look: { skin: 1, outfit: 'teal', head: 'bun' },
  },
} as const satisfies Record<string, Character>
