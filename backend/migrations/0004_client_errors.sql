-- Launch readiness. Additive only, like 0002 and 0003: CI applies it before the Worker that needs it ships.

-- One error a page caught and sent to `POST /api/errors` (unauthenticated, rate-limited per address). Nothing
-- in it names a person: no account id, no names, no typed text, no query strings. `fingerprint` groups the same
-- error (where it was caught + the message with its numbers taken out); `place` is where it was caught
-- (`error`, `rejection`, `webgl-lost`, `react`); `ua` is `device/app` (`mobile/instagram`, `desktop/other`, ...);
-- `build` the bundle's git short sha. `created_at` is ms. The cron deletes rows after 14 days.
CREATE TABLE client_errors (
  id INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL, place TEXT NOT NULL, msg TEXT NOT NULL, stack TEXT,
  ua TEXT NOT NULL, build TEXT NOT NULL, district TEXT, created_at INTEGER NOT NULL);
-- The admin page's top fingerprints, each with its latest sample and its ua breakdown.
CREATE INDEX client_errors_fingerprint ON client_errors(fingerprint, created_at);
-- The cron's sweep of rows past 14 days.
CREATE INDEX client_errors_created ON client_errors(created_at);
