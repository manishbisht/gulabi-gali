# Deferred minors (D) report

Branch `deferred-minors` (from 7bca8bf on `owed-features`). Filter files (backend/src/filter/*, frontend/src/filter/*, backend/test/filter-words.test.ts) untouched. No push.

## Verification (final tree)

- `npm run lint`: clean. `npm test`: frontend 69 files / 612 tests (before the last additions; re-run listed below), backend 26 files / 358 tests, check:protocol ok.
- `VITE_API_URL=https://api.gulabi-gali.manishbisht.me npm run build -w frontend`: ok. `npm run check:test-hooks`: ok.
- `npx playwright test`: 45 passed, 1 skipped (device-perf, opt-in), 1 failed on the first full run: my new seated-at-360 spec measured the bench panel mid slide-in (card-up translateY 24 px, so bottom read 754 > 740). Fixed by waiting for the animation to finish; hud.spec + hint.spec re-run 9/9 green.
- TDD: RED was seen for useDialog, FirstHint Escape, deleteAccount stamps copy, useStamps (3 tests), errors race, scheme-less frame, bytes cap, avatar outfits, scrub parity, benches/auto guard was green-on-write (it is a guard). Some tests (lang, inertRest, storage refused write, api timeout, stamps collected(), banned stamps 403) were written together with the fix and not run red first.

## D2 CI-flake item: hud.spec "dog in tow" (was line 169)

Cause: `sideBySide` called `boundingBox()` right after `teleport()`, before the "Auto chalao" / "Ghar jao" buttons had rendered (they appear a frame after the player is in reach); a null box then threw. Fixed: `sideBySide` first `await expect(item).toBeVisible()` for every item. The new seated spec likewise waits for the card's slide-in animation. Not reproduced locally, so this is the diagnosed cause, not a confirmed repro.

## Row table

| id | result | note |
|---|---|---|
| 4.8c | ALREADY FIXED | hud.spec "signed in ... identity row" already checks signed-in HUD at 360 including the stamps chip (`common()` has `stamps`) |
| 5.B7 | FIXED (guard) | new hud.spec test: seated at a tapri at 360 (panel + joystick fit, no street button). Finding: seated + "Auto chalao" cannot co-occur: new benches.test.ts asserts every seat is farther than MOUNT_RANGE from every parked auto in all four districts |
| 5.C1 | FIXED | deleteWhat names Jaipur Darshan stamps, hi + en, test |
| 5.C5 | FIXED | `gg-stamps-owner` tags the set with the account that last signed in; `claim` wipes a set left by another account, `release` clears on sign-out (new `signedIn` arg of useStamps); a ghost's own set goes to whoever signs in first; 3 tests |
| 1.3e | FIXED | langToggleLabel now starts with the visible text ("English: bhasha badlo", "हिन्दी: switch language"); e2e names updated; test |
| 1.3f | FIXED | `<html lang>` = hi-Latn / en, set on load and on switch; test |
| 1.3h | FIXED | global `:focus-visible` ring (cream + plum edge), tabindex -1 script-focus targets exempt, toggles' dashed off edge overridden on focus; e2e asserts the ring on the pressed bandar chip |
| 2.3a | FIXED | `useDialog` hook (focus in, Tab trap, Escape, focus restore, stack-aware) on sign-in, profile, invite, privacy sheets; unit + signin e2e |
| 4.3c / 4.6a | FIXED | `inertRest` (MutationObserver) used by MetroRide and Patang: later-added siblings are inert too; tests |
| 4.8d | ALREADY FIXED | polish P5: dimmed + dashed outline on [aria-pressed] off state |
| 5.B4 | FIXED | root cause is the card-up fade (opacity 0 to 1, 220 ms) read by axe; `.first-hint` slides without fading; axe color-contrast spec in hint.spec |
| 5.C4 | FIXED (partly) | stamps.spec waits on the PUT /api/me/stamps response (200) instead of relying on timing; the 150 s timeout stays for the two walkers' hops and is commented. No RED possible for an e2e |
| 4.4a | NOT MOOT | "Ghar jao" still exists (`animalHome`, shown while a dog/cow follows). The overlap is covered by hud.spec "dog in tow" (on foot: joystick, mount, home side by side at 360). Triage was wrong |
| 5.B1 | FIXED | scrubParity.test.ts compares END/QUERY/EMAIL source in both copies |
| 5.B3 | FIXED | client trims stack then msg until the JSON body is under 3500 bytes, never splitting a surrogate pair; tests |
| 5.B5 | FIXED | FirstHint ignores Escape while any `[aria-modal=true]` is open; test |
| 5.B6 | FIXED | admin list drops a group whose sample the purge removed; proxy-DB race test |
| 5.B8 | FIXED | `reportError` renamed `beaconError` |
| 5.B11 | FIXED | EMAIL skips `x@name.js(:n)` shaped frames (script extensions), still scrubs real addresses incl. `a@b.in:25`; both copies, tests |
| 5.C2 | FIXED | backend test: viewer blocked the holder, also 404 and no stamps |
| 5.C3 | FIXED | PUT /api/me/stamps runs `bannedGate`: banned is 403 `banned`; test |
| 1.2a | FIXED | null precipitation reads as dry; test |
| 1.2f | FIXED | comment: first listed festival wins on overlap |
| 1.2g | FIXED | non-OK upstream test (both endpoints) |
| 1.3b | FIXED | fetchCity 8 s timeout combined with caller's signal; test |
| 1.3c | FIXED | test no longer does a real request before the stub |
| 1.3d | FIXED | `storage.get` answers from memory for keys whose write was refused; test |
| 1.4c | FIXED (clampDelta only) | non-finite ms gives 0; "hooks hold disposed stage" left |
| 1.6c | FIXED | `-webkit-touch-callout: none` on both drag surfaces |
| 1.6d / 1.12d | FIXED | randomLook skips road, sandstone, white, glass; builder still offers all |
| 1.8a | FIXED | `collected()` returns known ids once each; test |
| 4.1a | ALREADY FIXED | posters.ts has a client expiry interval (triage said open) |
| 4.7b | LEFT | `=== '1'` is documented design ("anything else is on") |
| 5.P1 | FIXED | useTravel test records every rendered ride and asserts the sequence |
| 5.P2 | FIXED | comment on the cache.put stale window (<= 30 s) |

## P3 rows left (not touched)

1.2b 1.2e 1.2i 1.3 (none) 1.4b 1.4d 1.5a 1.5c 1.5e 1.6a 1.6e 1.7b-f 1.8b 1.9b 1.9c 1.10a 1.11b 1.11c 1.12a 2.0a 2.0b 2.1b 2.2e 2.2f 2.3b 2.3c 2.3e 2.4a 2.4b 2.5c-e 2.6b 2.7a 2.8a 2.9 2.10 2.11a 2.12b 3.x P3 rows 4.1d 4.2b 4.3d 4.4b 4.5a 4.6b 4.7c 4.8b 4.8e 5.P3 5.B9 5.B10. Also P1 go-live checks 3.0h and 4.7d (by brief, no code).

## Concerns

- 5.C5: a ghost who collected stamps and then signs in as a different account than the previous owner on that device loses them (the owner tag wins). Also a ghost reloading after a sign-out that never ran `release` still sees the old set until the next claim.
- `useStamps` carries one `eslint-disable react-hooks/set-state-in-effect` (same pattern as ChatView).
- Playwright servers use fixed ports 8787/5173; another agent running e2e at once would collide.
- The 1.3e visible label for English mode is still Devanagari, which is only fixed in the accessible name.

## Rebase onto 25a3ceb and final gate

Rebased cleanly, no conflicts. New SHAs: 3c7df44, 6861e5a, 9ab36ef, 1cc4eb4, then a docs commit for this section.

Gate (lint, npm test, build, check:test-hooks), raw:

    Test Files  69 passed (69)
         Tests  612 passed (612)
    Test Files  26 passed (26)
         Tests  359 passed (359)
    built in 1.62s / 1.59s
    ok: no __gg in the production build

Playwright full run, raw tail:

    1 skipped
    46 passed (2.6m)

`npx playwright test hud.spec.ts --repeat-each=10`, raw tail:

    50 passed (2.1m)
