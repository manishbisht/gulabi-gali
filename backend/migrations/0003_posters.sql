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
