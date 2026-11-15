-- Meet-ups ("Milte hain"): "Main aaunga" on a poster. Additive only, like 0002 to 0006: CI applies it before
-- the Worker that needs it ships.

-- One person saying they will come to poster `poster_id`'s plan. Only a verified resident others can see says it,
-- never on their own poster nor across a block (src/meetups.ts). Everyone sees how many, counting only people
-- others can see; only the poster's owner sees their first names. `created_at` is ms. `reminded` = 1 once the push
-- an hour before the plan's time went (or was not due: said inside that hour). A row lives and dies with its
-- poster: the triggers below take it when the poster goes (taken down, replaced, expired, an admin, a ban, a
-- deletion), when reports hide the poster or its owner, when either of the two blocks the other, and when the
-- person is hidden or banned. Deleting an account deletes its own rows.
CREATE TABLE rsvps (
  poster_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  reminded INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (poster_id, user_id));
-- A deletion, a ban or a block finding one person's rows.
CREATE INDEX rsvps_user ON rsvps(user_id);

CREATE TRIGGER rsvps_poster_gone AFTER DELETE ON posters
BEGIN
  DELETE FROM rsvps WHERE poster_id = old.id;
END;

CREATE TRIGGER rsvps_poster_hidden AFTER UPDATE OF hidden ON posters WHEN new.hidden = 1
BEGIN
  DELETE FROM rsvps WHERE poster_id = new.id;
END;

-- Either way round: the blocked person's word on the blocker's posters, and the blocker's on theirs.
CREATE TRIGGER rsvps_block AFTER INSERT ON blocks
BEGIN
  DELETE FROM rsvps WHERE user_id = new.b AND poster_id IN (SELECT id FROM posters WHERE owner = new.a);
  DELETE FROM rsvps WHERE user_id = new.a AND poster_id IN (SELECT id FROM posters WHERE owner = new.b);
END;

-- A hidden or banned owner's posters are off every wall: nobody is held to them. A hidden or banned person's own
-- word goes too: they are no longer counted, named or reminded.
CREATE TRIGGER rsvps_user_out AFTER UPDATE OF hidden, banned ON users WHEN new.hidden = 1 OR new.banned = 1
BEGIN
  DELETE FROM rsvps WHERE poster_id IN (SELECT id FROM posters WHERE owner = new.id);
  DELETE FROM rsvps WHERE user_id = new.id;
END;
