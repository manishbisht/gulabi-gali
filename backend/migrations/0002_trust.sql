-- Phase 3 (safety). One migration, extended task by task until it is first deployed; after that it is never
-- edited, and anything new goes in 0003. Additive only: CI applies it before the Worker that needs it ships.

-- Trust on each person. `hidden` takes them off the map and out of everyone's lists (an admin, or auto-hide);
-- `muted_until` (ms) stops bench lines and status changes until then; `verified` lets them reach strangers.
ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN verified_by TEXT;
ALTER TABLE users ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN muted_until INTEGER;
-- The admin page's "hidden" list and count, without a scan of everyone.
CREATE INDEX users_hidden ON users(created_at) WHERE hidden = 1;

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
-- "Redeemed one in the last 24 hours?", asked on every resident's district connect (it skips the line for room).
CREATE INDEX invites_used_by ON invites(used_by, used_at) WHERE used_by IS NOT NULL;

-- A report: `reporter` says `target_id` (always a person's id; for a bench or a chat, whoever it is about)
-- did wrong, in a `target_kind` place. `evidence` is JSON the server put together itself (a profile
-- snapshot without the link, a bench's last 10 minutes, a chat's last 30 messages), at most 64 KB, for
-- admins only. The cron sets it to NULL once the report is closed, or 30 days after it was filed.
-- `unconfirmed` = 1: the server could not confirm the person was there (a bench whose district had slept, or
-- could not be reached), so the report rests on the reporter's word: it is queued, but never counts toward
-- auto-hide.
CREATE TABLE reports (
  id TEXT PRIMARY KEY, reporter TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('person','bench','chat','poster')), target_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('harassment','hate','spam','underage','other')),
  note TEXT NOT NULL DEFAULT '', evidence TEXT, created_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','actioned','dismissed')), closed_at INTEGER,
  unconfirmed INTEGER NOT NULL DEFAULT 0);
CREATE INDEX reports_target ON reports(target_kind, target_id, created_at);
CREATE INDEX reports_state ON reports(state, created_at);
-- The cron's two sweeps, each over only the reports still holding evidence.
CREATE INDEX reports_closed_evidence ON reports(state) WHERE evidence IS NOT NULL;
CREATE INDEX reports_evidence_age ON reports(created_at) WHERE evidence IS NOT NULL;

-- People who left an email while the city was full (Task 7 fills it; the admin page exports it as CSV now).
-- Stored only to tell them there is room; no email is sent from here.
CREATE TABLE waitlist (email TEXT PRIMARY KEY, created_at INTEGER);
