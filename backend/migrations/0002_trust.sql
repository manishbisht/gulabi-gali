-- Phase 3 (safety). One migration, extended task by task until it is first deployed; after that it is never
-- edited, and anything new goes in 0003. Additive only: CI applies it before the Worker that needs it ships.

-- Trust on each person. `hidden` takes them off the map and out of everyone's lists (an admin, or auto-hide);
-- `muted_until` (ms) stops bench lines and status changes until then; `verified` lets them reach strangers.
ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN verified_by TEXT;
ALTER TABLE users ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN muted_until INTEGER;

-- `a` blocked `b`. A block works both ways: neither ever sees the other.
-- `name` is `b`'s first name as it was when `a` blocked them: the block list shows only that, never live profile data.
CREATE TABLE blocks (
  a TEXT NOT NULL, b TEXT NOT NULL, created_at INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (a, b));
CREATE INDEX blocks_b ON blocks(b);

-- Per-account counters for rate limits: `n` uses of `bucket` in the window that began at `window_start` (ms).
CREATE TABLE counters (
  user_id TEXT NOT NULL, bucket TEXT NOT NULL, window_start INTEGER NOT NULL, n INTEGER NOT NULL,
  PRIMARY KEY (user_id, bucket, window_start));

-- A chat's last 30 messages, kept when the match ends (an unmatch, a block, a deletion) so either person can
-- still report it. `owner` ended it, `other` is the other side; `messages` is a JSON array of
-- {from, body, at}. Admins only, and the cron deletes it 30 days on.
CREATE TABLE held_evidence (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, other TEXT NOT NULL, match_id TEXT NOT NULL,
  messages TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX held_evidence_match ON held_evidence(match_id);
CREATE INDEX held_evidence_created ON held_evidence(created_at);

-- Carried over from the phase 2 review: the lists and the match lookups by the second member.
CREATE INDEX requests_to_state ON requests(to_id, state, created_at);
CREATE INDEX requests_from_to_state ON requests(from_id, to_id, state);
CREATE INDEX matches_b ON matches(b);

-- Invite codes: a verified member's gift to one person. `code` is 8 characters of Crockford base32. `used_by`
-- is set by one conditional UPDATE (`WHERE used_by IS NULL`), so a code can only be won once.
CREATE TABLE invites (
  code TEXT PRIMARY KEY, owner TEXT NOT NULL, used_by TEXT, used_at INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX invites_owner ON invites(owner);
