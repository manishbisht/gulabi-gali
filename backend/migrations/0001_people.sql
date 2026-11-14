CREATE TABLE users (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, banned INTEGER NOT NULL DEFAULT 0);
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, look TEXT NOT NULL, home_area TEXT NOT NULL, status TEXT NOT NULL DEFAULT '',
  here_for TEXT, about TEXT NOT NULL DEFAULT '', link TEXT, adult INTEGER NOT NULL, pledge INTEGER NOT NULL,
  pause_requests INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE TABLE requests (
  id TEXT PRIMARY KEY, from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, reason TEXT NOT NULL,
  created_at INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending','accepted','ignored')));
CREATE UNIQUE INDEX requests_pair ON requests(from_id, to_id) WHERE state = 'pending';
CREATE TABLE matches (id TEXT PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE (a, b)); -- a < b
CREATE TABLE messages (id TEXT PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX messages_match ON messages(match_id, created_at);
