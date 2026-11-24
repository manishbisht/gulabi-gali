export type DistrictId = 'walled-city' | 'mi-road' | 'university' | 'malviya-nagar' | 'amer' | 'nahargarh'

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

/**
 * `GET /api/count` (public): how many people others can see in the city now. 0 means fewer than three (never
 * told apart); three to nine as they are; from ten a multiple of five, rounded down. No names or districts.
 */
export interface CityCount {
  people: number
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

/**
 * Mirrors the frontend `AvatarLook`, with plain string unions. `skin`, `outfit` and `head` are the look every
 * client knows; the rest is the dressing room's (see `dressOf`), small indices, each optional. A look without
 * them is drawn as it always was. When any is present the server stores them all, and sets `skin` and `head` to
 * the nearest older look (`compactLook`), which is what a client from before the dressing room draws.
 */
export interface AvatarLookWire {
  skin: 0 | 1 | 2 | 3 | 4
  outfit: OutfitKey
  head: HeadKey
  /** Skin tone, 0 to `TONE_COUNT - 1`. */
  tone?: number
  /** Headwear: an index into `HATS`. */
  hat?: number
  /** The headwear's colour: an index into `OUTFITS`. Left out when there is no headwear. */
  hatC?: number
  /** Dupatta or stole: an index into `DUPATTAS`. */
  dup?: number
  /** Its colour: an index into `OUTFITS`. Left out when it is off. */
  dupC?: number
  /** Hair: an index into `HAIRS`. */
  hair?: number
}

/*
 * The dressing room's options. Every list is append-only: a look names an option by its index, so an index
 * never changes meaning. Every option is for everyone; each is named by garment and colour only.
 */
/** Skin tones, light to deep (the frontend's `TONES` holds their colours); a range, never a ranking. */
export const TONE_COUNT = 8
/** The tone each of the older five skins is: they are tones 1, 2, 3, 5 and 6, so nobody's colour changes. */
export const TONE_OF_SKIN = [1, 2, 3, 5, 6] as const
/** The nearest older skin to each tone: what a client from before tones draws. */
export const SKIN_OF_TONE = [0, 0, 1, 2, 3, 3, 4, 4] as const
/** Headwear. The safa and the pagdi are two ties of the Rajasthani turban. */
export const HATS = ['none', 'safa', 'pagdi', 'cap'] as const
/** A dupatta or stole: off, over the head (drawn round the shoulders under headwear), or round the shoulders. */
export const DUPATTAS = ['off', 'head', 'shoulders'] as const
/** `crop` is the close crop every figure had before hair was a choice; `bun` is the older `head: 'bun'`. */
export const HAIRS = ['crop', 'bun', 'short', 'long', 'plait'] as const

/** A look's dressing-room choices, every one filled in. */
export interface Dress {
  tone: number
  hat: number
  hatC: number
  dup: number
  dupC: number
  hair: number
}

/** The dressing-room fields of a look, and how many options each has. */
export const DRESS_LIMITS: Readonly<Record<keyof Dress, number>> = {
  tone: TONE_COUNT,
  hat: HATS.length,
  hatC: OUTFITS.length,
  dup: DUPATTAS.length,
  dupC: OUTFITS.length,
  hair: HAIRS.length,
}

/**
 * Every choice of a look, each field it leaves out read from its older fields as they were always drawn: a safa
 * in marigold, a white cap, a dupatta over the head in the outfit's colour, a bun.
 */
export function dressOf(look: AvatarLookWire): Dress {
  const hat = look.hat ?? (look.head === 'safa' ? 1 : look.head === 'cap' ? 3 : 0)
  return {
    tone: look.tone ?? TONE_OF_SKIN[look.skin],
    hat,
    hatC: look.hatC ?? OUTFITS.indexOf(hat === 3 ? 'white' : 'marigold'),
    dup: look.dup ?? (look.head === 'dupatta' ? 1 : 0),
    dupC: look.dupC ?? OUTFITS.indexOf(look.outfit),
    hair: look.hair ?? (look.head === 'bun' ? 1 : 0),
  }
}

/** The older `head` nearest a dress: headwear first, then a dupatta over the head, then a bun. */
export function legacyHead(d: Dress): HeadKey {
  if (d.hat === 1 || d.hat === 2) return 'safa'
  if (d.hat === 3) return 'cap'
  if (d.dup === 1) return 'dupatta'
  return d.hair === 1 ? 'bun' : 'none'
}

/** A dress as it goes on the wire: every choice, the older fields to match, no colour for what is not worn. */
export function compactLook(outfit: OutfitKey, d: Dress): AvatarLookWire {
  return {
    skin: SKIN_OF_TONE[d.tone] ?? 0,
    outfit,
    head: legacyHead(d),
    tone: d.tone,
    hat: d.hat,
    ...(d.hat ? { hatC: d.hatC } : {}),
    dup: d.dup,
    ...(d.dup ? { dupC: d.dupC } : {}),
    hair: d.hair,
  }
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
  /**
   * Their Jaipur Darshan stamps: landmark ids from `stamps.json`, in its order. Never on a `PublicPerson`. A
   * resident adds their own with `PUT /api/me/stamps {stamps: string[]}`, which only ever adds (at most one of
   * each id; an unknown one is 400 `invalid`, a ghost 403 `ghost`) and answers `{stamps}`, the whole set.
   */
  stamps: string[]
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

/** How fast the client jogs on foot (Shift held, or the stick pushed to its rim), in m/s: 1.8x its 4 m/s walk. */
export const JOG_SPEED = 7.2
/**
 * A move that claims `pace: 'jog'` may go this fast (m/s), with this burst (m): two seconds of jogging, rounded
 * up, so a jogger's frames stalled for 2 s are not pulled back, as a walker's are not. A client can claim a jog
 * it is not making; the cost is one 16 m hop after standing still, which is accepted.
 */
export const JOG_MAX_SPEED = 8
export const JOG_BURST_M = 16
/** How a person on foot says they are moving, when faster than a walk. Absent means walking. */
export type Pace = 'jog'

export type ClientMsg =
  /**
   * `v: 'auto'` says the sender is driving one: they may then go 12 m/s (a 24 m burst, two seconds' worth)
   * instead of walking pace, and the others draw an auto under them. Absent means on foot; any other value
   * is a bad frame. A client can claim an auto it is not in; the cost is a 1.5x pace and a 3x burst, which
   * is accepted. `pace: 'jog'` says the sender is jogging on foot (see `JOG_BURST_M`); it is never relayed,
   * and any other value is ignored, as an unknown field is (an older server ignores it too).
   */
  | { t: 'move'; x: number; z: number; ry: number; v?: Vehicle; pace?: Pace }
  /**
   * The auto-taxi ("Le chalo"): a ride from beside a parked auto at one of this district's stands to landmark
   * `to` of the same district (both in `taxi.json`). `x`, `z` is where the sender stands as they get in, which
   * must be a walk on from their last accepted point. The server then puts them at that landmark's drop point
   * itself (its own figure, never the client's) and takes them off the street until their next move there; a
   * ride it will not give is refused with `no-ride`, and their point stays where it was.
   */
  | { t: 'ride'; to: string; x: number; z: number }
  | { t: 'sit'; bench: string | null }
  | { t: 'say'; text: string }
  | { t: 'status'; text: string }
  /** A greeting to the resident `to`, with no chat (see `REACTIONS`). Any other `kind` is a bad frame. */
  | { t: 'react'; to: string; kind: Reaction }
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
   * `status` the word filter refused (never a strike). `no-ride`: a `ride` the server would not give (see there).
   */
  | { t: 'error'; code: 'ghost' | 'invalid' | 'full' | 'rate' | 'far' | 'muted' | 'words' | 'no-ride' }
  /** A refused step carries the last point the server accepted: the client goes back there. */
  | { t: 'error'; code: 'too-fast'; x: number; z: number; ry: number }
  | { t: 'pong' }
  /**
   * A poster went up on one of this district's walls (never one whose owner is blocked either way with this
   * socket's person), or came down (taken down, hidden, replaced, expired, or its owner banned or gone). Its
   * owner's own sockets hear a hidden one as an `add` marked `hidden` instead of a `remove`.
   */
  | { t: 'poster'; op: 'add'; poster: PosterView }
  | { t: 'poster'; op: 'remove'; id: string }
  /** This person's blocks changed: what the walls may show them did too, so fetch them again. */
  | { t: 'posters' }
  /**
   * `from` greeted `to` (see `REACTIONS`): sent to both, and to everyone else here who stands within 60 m
   * of `from` and is blocked either way with neither. Draw it over both; never stored. Past six a minute to one
   * person (from everyone together) it goes to its sender alone, so a crowd cannot flood anyone.
   */
  | { t: 'react'; from: string; to: string; kind: Reaction }
  /** A `react` this socket sent was not passed on, and why (see `ReactRefusal`). */
  | { t: 'react-no'; to: string; why: ReactRefusal }

/** A line said at a bench, as each sitter hears it (and as the district keeps it, in memory only). */
export type BenchLine = Omit<Extract<ServerMsg, { t: 'bench' }>, 't' | 'bench'>
/** A bench line is at most this many characters (code points), once cleaned. */
export const MAX_BENCH_LINE = 200
/** Seats at a bench or tapri: any more sitters are told `full`. */
export const BENCH_SEATS = 4

/**
 * Reactions: a namaste or a wave from one resident to another standing near them, with no chat. Nothing of one
 * is ever stored. Only a resident others can see sends one (not a muted one), only to another listed resident
 * within `REACT_RANGE_M` of the sender's last accepted point and blocked neither way, at most once per
 * `REACT_PAIR_MS` to the same person and `REACT_PER_MINUTE` a minute in all.
 */
export const REACTIONS = ['namaste', 'wave'] as const
export type Reaction = (typeof REACTIONS)[number]
export const REACT_RANGE_M = 8
export const REACT_PAIR_MS = 30_000
export const REACT_PER_MINUTE = 10
/**
 * Why a reaction was not passed on. `far`: further than `REACT_RANGE_M`, or the sender not on the street yet;
 * `wait`: too soon after the last one to them, or too many this minute; `gone`: nobody by that id the sender
 * may greet here now (left, a ghost, hidden or blocked either way, never told apart); `ghost`, `muted`: as for a
 * bench line.
 */
export type ReactRefusal = 'far' | 'wait' | 'gone' | 'ghost' | 'muted'

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
/**
 * A match, with the other person's public face and the last thing said, if anything has been. `last.id` is that
 * message's id: a page compares it with the last one it read to tell an unread chat without fetching it.
 */
export interface MatchView {
  id: string
  person: PublicPerson
  last?: ChatMessage
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
  /** A friend list changed for you: someone asked you to be friends, or accepted your ask. Nothing more. */
  | { t: 'friend' }
  /** A friend invited you for chai: fetch `GET /api/chai`. It names nobody. */
  | { t: 'chai' }
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
  /**
   * For `person` only: `targetId` is a handle from your block list (see `BlockListEntry`), not an id: the report
   * is about whomever that block is, and their id never reaches the page.
   */
  blocked?: true
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

/**
 * One entry of `GET /api/blocks`: an opaque handle for the block (random, per block, the only thing `DELETE
 * /api/blocks/:handle` takes), and the first name saved when it was made (null: none was). Never the blocked
 * person's id: a block made from a poster must not tell the blocker whose poster it was.
 */
export interface BlockListEntry {
  handle: string
  name: string | null
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
  amer: 1,
  nahargarh: 1,
}
/** A `when` may be at most this far ahead (inclusive), and must be in the future. */
export const POSTER_AHEAD_MS = 30 * 24 * 3600 * 1000
/** A poster comes down this long after its `when`, or `POSTER_TTL_MS` after pinning when it has none. */
export const POSTER_AFTER_MS = 6 * 3600 * 1000
export const POSTER_TTL_MS = 7 * 24 * 3600 * 1000

/**
 * A poster as anyone sees it: the text, its time (ms) if it has one, where it hangs, and its owner's first
 * name. Never the owner's id: a poster owner's id is never sent to anyone, by any route (a block made from a
 * poster names the poster, and the block list carries only an opaque handle). `mine`: the viewer pinned it (and
 * may take it down). `hidden`: only ever on the viewer's own (`mine`): reports have it off every wall (or its
 * owner is hidden) until an admin looks; it still counts toward their two, and they may still take it down.
 * `going`: how many said "Main aaunga/aaungi" (see `GoingView`), left out at none. `coming`: the viewer is one of them.
 */
export interface PosterView {
  id: string
  wall: number
  slot: number
  text: string
  when: number | null
  name: string
  mine?: true
  hidden?: true
  going?: number
  coming?: true
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
 * Milte hain: "Main aaunga/aaungi" on a poster (`PUT`, `DELETE` and `GET /api/posters/:id/going`). Only a verified
 * resident others can see may say it, never on their own poster nor across a block either way.
 */

/**
 * Where a poster's meet-up stands for the viewer. `going`: how many are coming, counting only people others can
 * see now (the same number for everyone). `coming`: the viewer is one of them. `names`: only ever sent to the
 * poster's owner: the first names of those coming whom they may see (never anyone hidden, banned or blocked
 * either way), first come first.
 */
export interface GoingView {
  going: number
  coming: boolean
  names?: string[]
}
/**
 * Why "Main aaunga/aaungi" was refused. `ghost`: not a resident others can see; `not-verified`: residents cannot;
 * `mine`: your own poster; `not found`: the poster is not up for you (gone, hidden, or across a block); `past`:
 * its plan's time is more than half an hour gone.
 */
export type GoingError = 'ghost' | 'not-verified' | 'muted' | 'mine' | 'not found' | 'past' | 'rate'
/** The most first names the owner is sent: the first who said they are coming. */
export const MAX_GOING_NAMES = 50

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
  /**
   * For a poster report: how its poster stands now. `hidden`: off every wall by reports (dismissing the last
   * open report on it, with none actioned, puts it back up); `gone`: taken down or expired.
   */
  posterState?: 'up' | 'hidden' | 'gone'
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

/** Where a client error was caught: a window error, an unhandled rejection, the WebGL context lost, or React. */
export type ClientErrorWhere = 'error' | 'rejection' | 'webgl-lost' | 'react'

/** The kind of browser a client error came from: never the user agent itself. */
export type UaDevice = 'mobile' | 'desktop'
/** In-app browsers by name (`other`: anything else, a plain browser included). */
export type UaApp = 'instagram' | 'facebook' | 'other'

/**
 * `POST /api/errors`, unauthenticated, at most 4 kB: one error the page caught. No account id, no names, no
 * text anyone typed; URLs carry no query string. `stack` is its first 1 kB. `build` is the bundle's git short
 * sha. The answer is always an empty 204 (or a 400/429), never anything from the body.
 */
export interface ClientErrorReport {
  msg: string
  stack: string | null
  where: ClientErrorWhere
  ua: { device: UaDevice; app: UaApp }
  build: string
  district: DistrictId | null
}

/**
 * `GET /api/admin/errors`: the most frequent client errors of the last 14 days, by fingerprint (where + the
 * message with its numbers taken out). `sample` is the latest one's; `ua` counts each `device/app`.
 */
export interface AdminErrorGroup {
  fingerprint: string
  where: ClientErrorWhere
  msg: string
  count: number
  lastSeen: number
  sample: { stack: string | null; build: string; district: DistrictId | null }
  ua: Record<string, number>
}

/*
 * Friends ("Dost banao") and "Chai pe bulao" (backend/src/friends.ts, migration 0010). Friends are two matched
 * residents who both agreed. Nothing here ever carries anyone hidden, banned, blocked either way, or a ghost.
 */

/**
 * A friend as the other sees them: an id (to remove them, or invite them for chai), their first name, and `here`,
 * the district they are in, only while they are on the street as someone others can see and have "dosto ko
 * dikhao" on. Never where in it. Left out otherwise, whatever the reason: off, away, or waiting for room.
 */
export interface FriendView {
  id: string
  name: string
  here?: DistrictId
}
/** An ask to be friends, either way: the other person's id and first name. A declined one reads as pending. */
export interface FriendAsk {
  id: string
  name: string
}
/** A person's two switches, both on unless they turned them off. */
export interface FriendSettings {
  /** "Dosto ko dikhao ki main gali mein hoon". */
  showPresence: boolean
  /** "Chai ke bulaave lo". */
  chaiInvites: boolean
}
/** `GET /api/friends`. */
export interface FriendLists {
  friends: FriendView[]
  incoming: FriendAsk[]
  sent: FriendAsk[]
  settings: FriendSettings
}
/** Where an ask stands after `POST /api/friends` or an accept: friends now, or asked (and waiting). */
export type FriendState = 'friends' | 'asked'
/** A place to sit: the kind of prop a server bench id stands for. */
export type BenchKind = 'bench' | 'tapri'
/**
 * `GET /api/chai`: a friend's invite to the bench they sit at. `name` is their first name; `bench` the server's
 * bench id (`<district>:<n>`), in `district`; `at` when it was sent (ms). Shown for `CHAI_TTL_MS`.
 */
export interface ChaiInviteView {
  id: string
  name: string
  bench: string
  kind: BenchKind
  district: DistrictId
  at: number
}
/** How long an invite for chai stands. */
export const CHAI_TTL_MS = 15 * 60_000
