-- Jaipur Darshan stamps on the server, so a resident's second device shows them too. Additive only, like 0002
-- to 0004: CI applies it before the Worker that needs it ships.

-- One landmark stamp a resident has collected. `stamp` is an id from src/stamps.json (the server refuses any
-- other); `at` (ms) is when the server first heard of it. `PUT /api/me/stamps` only ever adds rows; deleting the
-- account deletes them. The primary key is also the lookup of one person's stamps.
CREATE TABLE user_stamps (
  user_id TEXT NOT NULL, stamp TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (user_id, stamp));
