-- Push notifications for requests and messages. Additive only, like 0002 to 0005: CI applies it before the
-- Worker that needs it ships.

-- One device's Web Push subscription (`PUT /api/me/push`), opted into by a resident from their profile. The
-- endpoint is the push service's URL for that browser, and the key: a browser has one, so subscribing it again
-- (another resident signing in there) moves it to them. `p256dh` and `auth` are the browser's keys (base64url)
-- that the payload is encrypted to; `lang` (`hi` | `en`) picks the copy the service worker shows. A push names
-- nobody and quotes nothing: the payload is only `{t, lang}`. Rows go on sign-out (`DELETE /api/me/push`),
-- with the account, and when the push service answers 404 or 410. `created_at` is ms.
CREATE TABLE push_subs (
  endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  lang TEXT NOT NULL, created_at INTEGER NOT NULL);
-- One person's devices, newest first: whom a push goes to, and the cap on how many they keep.
CREATE INDEX push_subs_user ON push_subs(user_id, created_at);
