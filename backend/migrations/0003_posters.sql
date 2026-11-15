-- Phase 4 (deewar). Additive only, like 0002: CI applies it before the Worker that needs it ships.

-- A plan pinned on a poster wall: `wall` is the n-th `poster-wall` prop of `district`, `slot` one of its six
-- places. `at_when` (ms) is the plan's own time, if it has one; `expires_at` (ms) is `at_when` + 6 h, or 7 days
-- after `created_at`. `hidden` = 1: auto-hidden by reports, off every wall until an admin acts (it still holds
-- its slot, and is the first to go when the wall is full).
CREATE TABLE posters (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, district TEXT NOT NULL, wall INTEGER NOT NULL,
  slot INTEGER NOT NULL, text TEXT NOT NULL, at_when INTEGER, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0);
-- `GET /api/districts/:id/posters`.
CREATE INDEX posters_district ON posters(district, hidden, expires_at);
-- One poster per slot: two pins racing for the same slot cannot both land.
CREATE UNIQUE INDEX posters_slot ON posters(district, wall, slot);
-- A person's live posters (at most 2), and a ban or deletion taking them all down.
CREATE INDEX posters_owner ON posters(owner, expires_at);
-- The cron's sweep of expired posters, without a scan of every poster.
CREATE INDEX posters_expires ON posters(expires_at);

-- A poster report's poster: its `target_id` is the poster's owner (so the queue groups it with the other
-- reports about them), and this says which poster. NULL for every other kind.
ALTER TABLE reports ADD COLUMN poster_id TEXT;
-- Poster auto-hide counts the open reports on one poster.
CREATE INDEX reports_poster ON reports(poster_id, state) WHERE poster_id IS NOT NULL;

-- Who pinned a poster that has come down, for 7 days after (the cron then deletes the row): a block made from a
-- poster that went in the meantime still finds whom it means. Written by the trigger below on every delete from
-- `posters` (taken down, replaced on a full wall, expired, an admin, a ban), so no way a poster leaves can miss
-- it. `removed_at` is ms. Deleting an account deletes its rows (after its posters, so the trigger's are too).
CREATE TABLE poster_owners (poster_id TEXT PRIMARY KEY, owner TEXT NOT NULL, removed_at INTEGER NOT NULL);
-- An account deletion wiping its own rows.
CREATE INDEX poster_owners_owner ON poster_owners(owner);
-- The cron's sweep of rows past 7 days.
CREATE INDEX poster_owners_removed ON poster_owners(removed_at);
CREATE TRIGGER posters_tombstone AFTER DELETE ON posters
BEGIN
  INSERT OR REPLACE INTO poster_owners (poster_id, owner, removed_at)
  VALUES (old.id, old.owner, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
END;

-- The block list's handle for each block: random, per row, and all `GET /api/blocks` and `DELETE
-- /api/blocks/:handle` ever use, so the list never carries the blocked person's id (a block made from a poster
-- must never tell the blocker whose it was). Rows made before this get one here.
ALTER TABLE blocks ADD COLUMN handle TEXT;
UPDATE blocks SET handle = lower(hex(randomblob(16))) WHERE handle IS NULL;
CREATE UNIQUE INDEX blocks_handle ON blocks(a, handle);
