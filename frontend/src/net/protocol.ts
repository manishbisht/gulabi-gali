export type DistrictId = 'walled-city' | 'mi-road' | 'university' | 'malviya-nagar'

export type FestivalId = 'sankranti' | 'holi' | 'gangaur' | 'teej' | 'diwali' | 'jlf'
export type Condition = 'clear' | 'cloudy' | 'fog' | 'rain' | 'storm' | 'dust'
export type AqiBand = 'good' | 'moderate' | 'poor' | 'unhealthy' | 'severe'
export interface CitySnapshot {
  fetchedAt: string // ISO instant
  tempC: number | null
  condition: Condition
  aqi: number | null // US AQI
  aqiBand: AqiBand
  sunrise: string // ISO instant, today in IST
  sunset: string
  festival: FestivalId | null
  stale: boolean // true when this is the built-in default, not live data
}

/** Keep in step with `PALETTE` in frontend/src/world/palette.ts. */
export const OUTFITS = [
  'pink',
  'terracotta',
  'sandstone',
  'ochre',
  'white',
  'teal',
  'marigold',
  'road',
  'grass',
  'glass',
] as const
export type OutfitKey = (typeof OUTFITS)[number]

export const HEADS = ['none', 'safa', 'cap', 'dupatta', 'bun'] as const
export type HeadKey = (typeof HEADS)[number]

/** Mirrors the frontend `AvatarLook`, with plain string unions. */
export interface AvatarLookWire {
  skin: 0 | 1 | 2 | 3 | 4
  outfit: OutfitKey
  head: HeadKey
}

/** Neighbourhoods only, never precise locations. */
export const HOME_AREAS = [
  'Walled City',
  'C-Scheme',
  'Raja Park',
  'Bani Park',
  'Civil Lines',
  'Vaishali Nagar',
  'Mansarovar',
  'Malviya Nagar',
  'Jagatpura',
  'Tonk Road',
  'Sanganer',
  'Sodala',
  'Shyam Nagar',
  'Jhotwara',
  'Vidhyadhar Nagar',
  'Adarsh Nagar',
  'Pratap Nagar',
  'Sitapura',
  'Amer',
  'JLN Marg',
  'Durgapura',
  'Outside Jaipur',
] as const
export type HomeArea = (typeof HOME_AREAS)[number]

export type HereFor = 'friends' | 'study' | 'work' | 'art'
export const HERE_FOR: readonly HereFor[] = ['friends', 'study', 'work', 'art']

/** All anyone but the owner may learn about a person on the map. Never add private fields here. */
export interface PublicPerson {
  id: string
  name: string
  look: AvatarLookWire
  status: string
}

export type FullProfile = PublicPerson & {
  homeArea: HomeArea
  hereFor: HereFor | null
  about: string
  pauseRequests: boolean
}

export interface Me {
  id: string
  profile: FullProfile | null
  complete: boolean
}
