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
  /** An https link, only for a verified viewer (and for the owner, who sees their own). Never on a `PublicPerson`. */
  link?: string
}

export interface Me {
  id: string
  profile: FullProfile | null
  complete: boolean
  /** Can send requests and sees others' links: redeemed an invite code, or an admin marked them. */
  verified: boolean
}

/** One of a verified member's invite codes: 8 characters (the screen shows XXXX-XXXX). */
export interface InviteView {
  code: string
  used: boolean
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
export type LivePerson = PublicPerson & {
  x: number
  z: number
  ry: number
  /** Present only while driving an auto. */
  v?: Vehicle
}

/** What a person is riding, when they are riding anything. Absent means on foot. */
export type Vehicle = 'auto'

export type ClientMsg =
  /**
   * `v: 'auto'` says the sender is driving one: they may then go 12 m/s (a 12 m burst) instead of walking
   * pace, and the others draw an auto under them. Absent means on foot; any other value is a bad frame. A
   * client can claim an auto it is not in; the cost is a 1.5x speed allowance, which is accepted.
   */
  | { t: 'move'; x: number; z: number; ry: number; v?: Vehicle }
  | { t: 'sit'; bench: string | null }
  | { t: 'say'; text: string }
  | { t: 'status'; text: string }
  | { t: 'ping' }

export type ServerMsg =
  /**
   * `queued`: the city has as many residents as it may (`MAX_LIVE`), so this resident waits in line as a ghost,
   * at that position (1 is next). Sent again, with `visible` true, when they get in.
   */
  | { t: 'welcome'; you: { id: string | null; visible: boolean; queued?: number }; people: LivePerson[] }
  /** A waiting resident's new position in line. */
  | { t: 'queued'; position: number }
  /** Also sent again for someone already listed, when they come back on a new socket: treat it as an upsert. */
  | { t: 'join'; p: LivePerson }
  | { t: 'leave'; id: string }
  /** The fifth element is there only for someone driving an auto. */
  | { t: 'moves'; m: [id: string, x: number, z: number, ry: number, v?: Vehicle][] }
  | { t: 'status'; id: string; text: string }
  | { t: 'bench'; bench: string; from: string; name: string; text: string; at: number }
  /**
   * Where you sit, and the first names of the others on that bench by seat. Sent to a sitter when they sit or
   * stand, and again whenever someone else joins or leaves their bench. `seat` is null exactly when `bench` is.
   */
  | { t: 'seated'; bench: string | null; seat: number | null; with: string[] }
  /**
   * `far`: a sit from further than the server allows from the bench, by the last point it accepted. `full`: a
   * bench with every seat taken, or (followed by a close with `LIVE_CLOSE.full`) a district or an address with
   * as many sockets as it may hold. `muted`: a moderator has muted this person, so `say` and `status` are refused. `words`: a `say` or
   * `status` the word filter refused (never a strike).
   */
  | { t: 'error'; code: 'ghost' | 'invalid' | 'full' | 'rate' | 'far' | 'muted' | 'words' }
  /** A refused step carries the last point the server accepted: the client goes back there. */
  | { t: 'error'; code: 'too-fast'; x: number; z: number; ry: number }
  | { t: 'pong' }
  /**
   * A poster went up on one of this district's walls (never one whose owner is blocked either way with this
   * socket's person), or came down (taken down, hidden, replaced, expired, or its owner banned or gone).
   */
  | { t: 'poster'; op: 'add'; poster: PosterView }
  | { t: 'poster'; op: 'remove'; id: string }
  /** This person's blocks changed: what the walls may show them did too, so fetch them again. */
  | { t: 'posters' }

/** A line said at a bench, as each sitter hears it (and as the district keeps it, in memory only). */
export type BenchLine = Omit<Extract<ServerMsg, { t: 'bench' }>, 't' | 'bench'>
/** A bench line is at most this many characters (code points), once cleaned. */
export const MAX_BENCH_LINE = 200
/** Seats at a bench or tapri: any more sitters are told `full`. */
export const BENCH_SEATS = 4

/**
 * How the server may end a district socket. A replaced socket lost to a newer one for the same person (another
 * tab, a reconnect) and must not reconnect, or two tabs would take turns knocking each other off. `banned`: a
 * moderator banned this person (on the inbox, also hidden them): the inbox must not reconnect, and a district
 * socket that does comes back as a ghost. `full`: the district, or this address, holds as many sockets as it
 * may; try again later. `deleted`: this person deleted their account; they are signed out and the socket does
 * not come back as them.
 */
export const LIVE_CLOSE = {
  replaced: 4001,
  invalid: 4002,
  idle: 4003,
  banned: 4004,
  full: 4005,
  deleted: 4006,
} as const

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
export type ChatError = 'invalid' | 'rate' | 'not-found' | 'ghost' | 'words' | 'muted'

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
 * `GET /api/ended`: a chat that ended in the last 30 days (an unmatch, a block, a deletion), which either
 * member can still report. `person.name` is their first name when it ended, or null when they had none.
 */
export interface EndedChat {
  matchId: string
  person: { id: string; name: string | null }
  endedAt: number
}
/**
 * Everything the inbox socket sends. A client sends only `{"t":"ping"}`. The server may close it with
 * `LIVE_CLOSE.replaced` (more tabs than one person may keep open: this, the oldest, must not reconnect),
 * `LIVE_CLOSE.banned` (no longer a resident: banned or hidden; must not reconnect) or `LIVE_CLOSE.invalid`
 * (garbage or a flood).
 */
export type InboxMsg = InboxNotice | { t: 'pong' }

/**
 * What a report is about. `person`: their profile; `bench`: what they said at a bench (with its id);
 * `chat`: a 1:1 chat with them; `poster`: a poster they pinned. Every kind but `poster` names the person
 * (`targetId`); a poster report names the poster (its owner's id is never sent to anyone), and the report
 * is filed about its owner. The server assembles the evidence.
 */
export const REPORT_KINDS = ['person', 'bench', 'chat', 'poster'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]
export const REPORT_REASONS = ['harassment', 'hate', 'spam', 'underage', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]
/** A report's optional note is at most this many characters (code points), once cleaned. */
export const MAX_REPORT_NOTE = 300
/** `POST /api/reports` body. Anything else sent (evidence above all) is ignored. */
export interface ReportInput {
  kind: ReportKind
  targetId: string
  /** For `bench` only: the bench's id. */
  bench?: string
  reason: ReportReason
  note?: string
}
/**
 * The 201 answer: `autoHidden` when this report was the one that took the person off the map. `evidence:
 * 'missing'`: filed, but the bench's record had already gone (the moderator still looks).
 */
export interface ReportResult {
  autoHidden: boolean
  evidence?: 'missing'
}

/*
 * Deewar: the poster walls. Verified members pin plans; anyone, ghosts included, reads them.
 */

/** A poster's text is 10 to 140 characters (code points) once cleaned, on one line. */
export const MIN_POSTER = 10
export const MAX_POSTER = 140
/** Places on each wall. A full wall gives up its oldest poster (never the pinner's own) for a new one. */
export const POSTER_SLOTS = 6
/** Each district's poster walls: wall n is the n-th `poster-wall` prop in its `props`. */
export const POSTER_WALLS: Record<DistrictId, number> = {
  'walled-city': 3,
  'mi-road': 1,
  university: 1,
  'malviya-nagar': 5,
}
/** A `when` may be at most this far ahead (inclusive), and must be in the future. */
export const POSTER_AHEAD_MS = 30 * 24 * 3600 * 1000
/** A poster comes down this long after its `when`, or `POSTER_TTL_MS` after pinning when it has none. */
export const POSTER_AFTER_MS = 6 * 3600 * 1000
export const POSTER_TTL_MS = 7 * 24 * 3600 * 1000

/**
 * A poster as anyone sees it: the text, its time (ms) if it has one, where it hangs, and its owner's first
 * name. Never the owner's id. `mine`: the viewer pinned it (and may take it down).
 */
export interface PosterView {
  id: string
  wall: number
  slot: number
  text: string
  when: number | null
  name: string
  mine?: true
}
/** `POST /api/posters` body. */
export interface PosterInput {
  district: DistrictId
  wall: number
  text: string
  when?: number | null
}
/**
 * Why a pin was refused. `ghost`: not a resident others can see (hidden included); `not-verified`: residents
 * cannot pin; `limit`: two posters up already; `words`: the filter (field `text`); `invalid`: field `text`,
 * `when`, `district` or `wall`.
 */
export type PosterError = 'invalid' | 'words' | 'ghost' | 'not-verified' | 'muted' | 'limit' | 'rate'

/*
 * The owner's moderation console (`/api/admin/*`, admins only; everyone else gets a 404). Nothing here is
 * ever sent to anyone but an admin.
 */

/** A person as the moderator sees them: their account, their trust state and their profile as it is now. */
export interface AdminUser {
  id: string
  /** Null for an id with no account row (a deleted reporter). */
  createdAt: number | null
  verified: boolean
  /** Who vouched for them: the inviter's id, `admin`, or null. */
  verifiedBy: string | null
  banned: boolean
  hidden: boolean
  /** Muted until then (ms), or null. */
  mutedUntil: number | null
  /** Open reports about them. */
  openReports: number
  profile: { name: string; status: string; homeArea: string; about: string } | null
}

/** A bench line or chat message in a report: the sender's first name, the time (ms) and the exact text. */
export interface AdminLine {
  from: string
  name: string
  text: string
  at: number
}

/**
 * What a report carried, as the server put it together: a profile snapshot, or a bench's or chat's lines
 * (`missing`: the bench's record had gone by the time it was reported). Null once the cron has cleared it.
 */
export type AdminEvidence =
  | { kind: 'profile'; name: string; status: string; homeArea: string; about: string }
  | { kind: 'lines'; place: 'bench' | 'chat'; lines: AdminLine[]; missing: boolean }
  /** The poster as it was when reported (it may have come down since): its id, where it hung, and what it said. */
  | {
      kind: 'poster'
      posterId: string
      district: DistrictId
      wall: number
      text: string
      when: number | null
    }

export type ReportState = 'open' | 'actioned' | 'dismissed'

export interface AdminReport {
  id: string
  kind: ReportKind
  reason: ReportReason
  note: string
  createdAt: number
  state: ReportState
  closedAt: number | null
  /** The server could not confirm the person was there: the report rests on the reporter's word. */
  unconfirmed: boolean
  reporter: AdminUser
  target: AdminUser
  evidence: AdminEvidence | null
}

/** `GET /api/admin/reports`: 20 at a time; `next` is an opaque cursor for the page after, or null. */
export interface AdminReportPage {
  reports: AdminReport[]
  next: string | null
}

/** `POST /api/admin/reports/:id/{dismiss|action}`: the report's state, as it now is. */
export interface AdminReportClosed {
  id: string
  state: ReportState
  closedAt: number | null
}

/** Someone hidden (by auto-hide or an admin), with the reports about them and who filed them. No evidence. */
export interface AdminHidden {
  user: AdminUser
  reports: Omit<AdminReport, 'target' | 'evidence' | 'note'>[]
}

/**
 * `GET /api/admin/stats`. A district that could not be asked has null counts. `live` is everyone the city's cap
 * counts (residents across districts, one each), `queue` everyone waiting for room; both null when the gate
 * could not be asked.
 */
export interface AdminStats {
  districts: { id: DistrictId; residents: number | null; ghosts: number | null }[]
  live: number | null
  queue: number | null
  openReports: number
  hidden: number
}
