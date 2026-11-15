import { visibleAs } from './profiles'

/*
 * The SQL that both the poster walls (posters.ts) and "Main aaunga/aaungi" (meetups.ts) use for a poster's meet-up.
 * A leaf: it imports neither, so neither imports the other through it.
 */

/** An attendee others can see, over `users ru` and `profiles rp` (see `VISIBLE`). */
export const SEEN = visibleAs('ru', 'rp')

/**
 * How many are coming to poster `po`, as SQL: only people others can see, and none blocked either way with its
 * owner (a block deletes those rows anyway). The same number for every viewer.
 */
export const GOING_OF = `(SELECT COUNT(*) FROM rsvps r JOIN users ru ON ru.id = r.user_id
  JOIN profiles rp ON rp.user_id = r.user_id WHERE r.poster_id = po.id AND ${SEEN}
    AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.a = po.owner AND b.b = r.user_id)
      OR (b.a = r.user_id AND b.b = po.owner)))`

/** Whether the viewer (`?3`) is coming to poster `po`, as SQL. */
export const COMING_OF = 'EXISTS (SELECT 1 FROM rsvps r WHERE r.poster_id = po.id AND r.user_id = ?3)'
