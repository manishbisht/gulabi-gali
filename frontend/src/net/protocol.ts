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
  /** The first name only. A signed-in viewer's `FullProfile` carries the whole name. */
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

/** What a person's `Milna hai` request says: 10 to 140 characters (code points), once cleaned. */
export const MIN_REASON = 10
export const MAX_REASON = 140
/** A request nobody answered is gone from every list after this, and can no longer be accepted. */
export const REQUEST_TTL_MS = 14 * 24 * 3600 * 1000

/** `person` is the other side. A sender only ever sees `pending` or `accepted`: a decline is never revealed. */
export interface RequestView {
  id: string
  person: PublicPerson
  reason: string
  createdAt: number
  state: 'pending' | 'accepted'
}
export interface RequestLists {
  incoming: RequestView[]
  sent: RequestView[]
}
export type RequestError =
  'invalid' | 'ghost' | 'no-such-person' | 'already' | 'paused' | 'not-found' | 'expired'

/** A person on the live map: their public face and where they stand. */
export type LivePerson = PublicPerson & { x: number; z: number; ry: number }

export type ClientMsg =
  | { t: 'move'; x: number; z: number; ry: number }
  | { t: 'sit'; bench: string | null }
  | { t: 'say'; text: string }
  | { t: 'status'; text: string }
  | { t: 'ping' }

export type ServerMsg =
  | { t: 'welcome'; you: { id: string | null; visible: boolean }; people: LivePerson[] }
  /** Also sent again for someone already listed, when they come back on a new socket: treat it as an upsert. */
  | { t: 'join'; p: LivePerson }
  | { t: 'leave'; id: string }
  | { t: 'moves'; m: [id: string, x: number, z: number, ry: number][] }
  | { t: 'status'; id: string; text: string }
  | { t: 'bench'; bench: string; from: string; name: string; text: string; at: number }
  /**
   * Where you sit, and the first names of the others on that bench by seat. Sent to a sitter when they sit or
   * stand, and again whenever someone else joins or leaves their bench. `seat` is null exactly when `bench` is.
   */
  | { t: 'seated'; bench: string | null; seat: number | null; with: string[] }
  /** `far`: a sit from further than the server allows from the bench, by the last point it accepted. */
  | { t: 'error'; code: 'ghost' | 'invalid' | 'full' | 'rate' | 'far' }
  /** A refused step carries the last point the server accepted: the client goes back there. */
  | { t: 'error'; code: 'too-fast'; x: number; z: number; ry: number }
  | { t: 'pong' }

/** A line said at a bench, as each sitter hears it (and as the district keeps it, in memory only). */
export type BenchLine = Omit<Extract<ServerMsg, { t: 'bench' }>, 't' | 'bench'>
/** A bench line is at most this many characters (code points), once cleaned. */
export const MAX_BENCH_LINE = 200
/** Seats at a bench or tapri: any more sitters are told `full`. */
export const BENCH_SEATS = 4

/**
 * How the server may end a district socket. A replaced socket lost to a newer one for the same person (another
 * tab, a reconnect) and must not reconnect, or two tabs would take turns knocking each other off.
 */
export const LIVE_CLOSE = { replaced: 4001, invalid: 4002, idle: 4003 } as const

/** A chat message is 1 to 500 characters (code points) once cleaned, on at most this many lines. */
export const MAX_MESSAGE = 500
export const MAX_MESSAGE_LINES = 10

/** One message in a match's chat, as one member sees it. */
export interface ChatMessage {
  id: string
  body: string
  at: number
  /** Sent by the viewer. */
  mine: boolean
}
/**
 * A page of a chat, newest last. `before` is an opaque cursor for the page older than this one, or null when
 * this page reaches the start.
 */
export interface MessagePage {
  messages: ChatMessage[]
  before: string | null
}
/** A match, with the other person's public face and the last thing said, if anything has been. */
export interface MatchView {
  id: string
  person: PublicPerson
  last?: Omit<ChatMessage, 'id'>
}
/**
 * `not-found` covers a match that does not exist and one the asker is not (or no longer may be) in alike.
 * `ghost`: only a resident has a list of matches.
 */
export type ChatError = 'invalid' | 'rate' | 'not-found' | 'ghost'

/**
 * What a person's inbox socket hears: a nudge to refetch, never the content itself (a message notice names
 * only its id). `accepted` goes to whoever asked (to both, when two requests crossed); `unmatched` only to the
 * one who did not unmatch.
 */
export type InboxNotice =
  | { t: 'request'; id: string }
  | { t: 'accepted'; matchId: string; person: PublicPerson }
  | { t: 'message'; matchId: string; id: string }
  | { t: 'unmatched'; matchId: string }
/**
 * Everything the inbox socket sends. A client sends only `{"t":"ping"}`. The server may close it with
 * `LIVE_CLOSE.replaced` (more tabs than one person may keep open: this, the oldest, must not reconnect) or
 * `LIVE_CLOSE.invalid` (garbage or a flood).
 */
export type InboxMsg = InboxNotice | { t: 'pong' }
