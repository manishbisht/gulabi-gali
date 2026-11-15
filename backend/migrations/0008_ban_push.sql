-- A ban forgets the person's push devices. Additive only, like 0002 to 0007. Apply it by hand with
-- `wrangler d1 migrations apply gulabi-gali --remote` before deploying the Worker (see docs/deployment.md).

-- `pushTo` already sends a banned person nothing (it checks `activeRow` first), but their subscriptions, each an
-- endpoint and the browser's keys, have no reason to be kept: a ban takes them, wherever it comes from (the admin
-- route, or by hand). An unban does not bring them back; the person switches push on again from their profile.
CREATE TRIGGER push_subs_banned AFTER UPDATE OF banned ON users WHEN new.banned = 1
BEGIN
  DELETE FROM push_subs WHERE user_id = new.id;
END;
