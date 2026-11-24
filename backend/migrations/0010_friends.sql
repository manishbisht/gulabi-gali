-- Friends ("Dost banao") and "Chai pe bulao" (src/friends.ts). Additive only, like 0002 to 0008. Apply it by hand
-- with `wrangler d1 migrations apply gulabi-gali --remote` before deploying the Worker (see docs/deployment.md).
-- It depends on nothing after 0008.

-- Two people who both agreed to be friends: `a` < `b`, as `matches` orders them. Only a matched pair can be
-- friends, and the friendship lives and dies with that: the triggers below take it when the match ends (an
-- unmatch, a block, a deletion), when either blocks the other, and when either is hidden or banned. Nothing
-- brings it back: they ask again. `created_at` is ms.
CREATE TABLE friends (a TEXT NOT NULL, b TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (a, b));
-- A person's friends when they are the second of the pair (the primary key finds the first).
CREATE INDEX friends_b ON friends(b);

-- "Dost banao": `from_id` asked `to_id`. `declined` is kept (and still reads as pending to the one who asked, who
-- is never told) until the cron deletes it 14 days after `created_at`, so one ask per pair stands for that long.
-- Accepting deletes both directions' rows and writes `friends`.
CREATE TABLE friend_requests (
  from_id TEXT NOT NULL, to_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'declined')), PRIMARY KEY (from_id, to_id));
-- The asked person's list.
CREATE INDEX friend_requests_to ON friend_requests(to_id, state, created_at);
-- The cron's sweep of asks past their 14 days.
CREATE INDEX friend_requests_created ON friend_requests(created_at);

-- A person's two switches, both on unless a row says otherwise: `show_presence` = 1 lets their friends see
-- "gali mein hai · <district>" while they are on the street; `chai_invites` = 1 lets friends invite them for chai.
CREATE TABLE friend_settings (
  user_id TEXT PRIMARY KEY, show_presence INTEGER NOT NULL DEFAULT 1, chai_invites INTEGER NOT NULL DEFAULT 1);

-- "Chai pe bulao": `from_id`, seated at `bench` (a server bench id, `<district>:<n>`; `kind` is what the sender's
-- page says it is, for the words and the place link only), invited their friend `to_id`. Shown to `to_id` for
-- 15 minutes, until they dismiss it (`dismissed` = 1); the cron deletes it after that. At most one live row per
-- pair: a new invite replaces the last. `created_at` is ms.
CREATE TABLE chai_invites (
  id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, bench TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bench', 'tapri')), created_at INTEGER NOT NULL,
  dismissed INTEGER NOT NULL DEFAULT 0);
-- The invited person's list.
CREATE INDEX chai_invites_to ON chai_invites(to_id, created_at);
-- A new invite replacing the pair's last one, and a deletion finding the sender's rows.
CREATE INDEX chai_invites_from ON chai_invites(from_id, to_id);
-- The cron's sweep of invites past their 15 minutes.
CREATE INDEX chai_invites_created ON chai_invites(created_at);

-- The match is what makes two people able to be friends: when it goes, so does the friendship and any ask.
CREATE TRIGGER friends_match_gone AFTER DELETE ON matches
BEGIN
  DELETE FROM friends WHERE a = old.a AND b = old.b;
  DELETE FROM friend_requests
    WHERE (from_id = old.a AND to_id = old.b) OR (from_id = old.b AND to_id = old.a);
END;

-- A friendship that ends takes the pair's invites with it, either way round.
CREATE TRIGGER friends_gone AFTER DELETE ON friends
BEGIN
  DELETE FROM chai_invites
    WHERE (from_id = old.a AND to_id = old.b) OR (from_id = old.b AND to_id = old.a);
END;

-- A block either way ends everything between the two at once (the match goes too, in src/chat.ts).
CREATE TRIGGER friends_block AFTER INSERT ON blocks
BEGIN
  DELETE FROM friends WHERE (a = new.a AND b = new.b) OR (a = new.b AND b = new.a);
  DELETE FROM friend_requests
    WHERE (from_id = new.a AND to_id = new.b) OR (from_id = new.b AND to_id = new.a);
  DELETE FROM chai_invites
    WHERE (from_id = new.a AND to_id = new.b) OR (from_id = new.b AND to_id = new.a);
END;

-- A hidden or banned person has no friends left: nobody sees them, asks them or invites them, and they reach
-- nobody. An unhide or an unban brings none of it back.
CREATE TRIGGER friends_user_out AFTER UPDATE OF hidden, banned ON users WHEN new.hidden = 1 OR new.banned = 1
BEGIN
  DELETE FROM friends WHERE a = new.id OR b = new.id;
  DELETE FROM friend_requests WHERE from_id = new.id OR to_id = new.id;
  DELETE FROM chai_invites WHERE from_id = new.id OR to_id = new.id;
END;
