-- "Aaj ka Darshan", the small goal of the day (src/today.ts). Additive only, like 0002 to 0010. Apply it by hand
-- with `wrangler d1 migrations apply gulabi-gali --remote` before deploying the Worker (see docs/deployment.md).
-- It depends on nothing after 0008.

-- One row per resident who has done a day's goal: `last_day` the last IST day (YYYY-MM-DD) they did it on,
-- `streak` the run of consecutive IST days ending on `last_day`, `best` the longest run so far. Only the server
-- works these out: `PUT /api/me/today` takes no number from the page, only "today's is done", and only for
-- today's IST day. Deleting the account deletes the row.
CREATE TABLE user_today (
  user_id TEXT PRIMARY KEY, last_day TEXT NOT NULL, streak INTEGER NOT NULL, best INTEGER NOT NULL);
