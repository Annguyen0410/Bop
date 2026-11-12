# Bop major update — audit and change log

October 23, 2026. Scope: this repository, both products (Android app, Windows Electron app).

Every finding below was reproduced or measured in this checkout before it was changed, and every
"verified" claim names the command or harness that produced it. Anything I could not verify is listed as
such in [Known limitations](#known-limitations).

## 1. Baseline, captured before any edit

| Check | Command | Result |
| --- | --- | --- |
| Desktop tests | `cd desktop && npm test` | **128 tests, 0 failures** (33.6 s) |
| Android JVM tests | `./gradlew :app:testDebugUnitTest` | **pass** |
| Desktop syntax | `node --check` on every `src/main` + `src/renderer` file | pass |
| Electron integration harness | `npx electron . --bop-monitor-smoke --bop-out <abs dir>` | **blocked** at first: a relative `--bop-out` aborted the run at `app.setPath` (finding D7). With an absolute path it ran and passed. |
| Android device tests | `adb devices` | no device attached — not run (unchanged from the previous audit) |

Architecture, as inspected (not assumed):

- **Android**: single `:app` module. The hub process owns `HubRepository` (encrypted `AtomicFile`
  settings), `HubNotificationListener` (installed-app notifications), and `HubNotifications` (one card per
  slot). Every account slot is its own activity **in its own OS process** (`:messenger_a` … `:messenger_p`,
  plus named WebView profiles beyond P) with its own cookie store; the web session reports an unread count
  to the hub process through `WebAlertReceiver`. Alert identity is `AlertKey(accountId, sourceKey)`.
- **Desktop**: one Electron main process. One `WebContentsView` and one `persist:bop-<id>` session per
  space; per-space `AccountMonitor` in memory; alerts and note state in one encrypted settings file;
  notifications delivered by the OS `Notification` **and** a self-drawn reminder card (a portable Windows
  build has no toast identity).

**There is no "region" concept in this repository.** `grep -ri region` over the whole tree returns zero
matches — no data model, no setting, no UI, no sync field. What the brief calls "region/context" is, in
this product, the **space/account identity** (`spaceId` on desktop, `AccountId` + `AccountBinding` on
Android) together with the app choice (`appId`) that decides which service a space opens. The audit below
therefore treats "correct region and account context" as "the account and app context attached to an event
at capture time, never re-read afterwards from a mutable global". Two consequences worth writing down:

- There is nothing to timezone-convert, because no region carries a locale or a clock.
- The dangerous shape the brief describes (a notification reading "the currently selected region" later)
  would be a mutable `openSpaceId`-like global. Both codebases instead pass the id captured in the event
  handler; see the evidence rows for A1/D5.

## 2. Findings

Severity is about user impact, not effort. "Status" is what happened in this change.

### D1 — P1 — Desktop: every background event re-encrypted and re-wrote the whole note store

*Feature*: desktop persistence (`saveSettings`), which runs whenever monitoring state changes.

*Evidence*: `snapshot()`/`saveSettings()` serialised `{...state, notes: notesWithTombstones(...)}` and
sealed it with `safeStorage.encryptString`, then `fs.writeFileSync`, **synchronously on the Electron main
thread**. A note image is a base64 data URL capped at 500 KB (`notes-sync.js: MAX_IMAGE_BYTES`), and the
store is capped at 12 MB (`NOTES_MAX_STORAGE_BYTES`). Saves were reached from every monitor event:
`persistMonitor` (coalesced to 1/s), `restSpace`/`resumeSpace`, `runWatcher`, bubble drag, notes sync.

*User impact*: a main-thread stall of tens of milliseconds per event on a full note store — during an
active chat, about once a second. The main thread is the thread that lays out the window, moves the bubble
and answers the tray, which is the shape of "the desktop becomes laggy while Bop runs".

*Measured*: `desktop/tools/perf-notes.js` (Electron 38.8.6, win32 x64, `safeStorage` available), 8 notes of
500 KB, median of 7 rounds — one save **27.04 ms / 5,334,711 bytes written** before, **0.36 ms / 285 bytes**
after. Raw output: [evidence/major-update/perf-notes.json](evidence/major-update/perf-notes.json).

*Fix*: note bodies live in their own encrypted store (`bop-settings.bin.notes`); the settings file no
longer contains them. The note store is rewritten only when the note arrays are *replaced* (an identity
check, valid because every mutation builds a new array). Both files are written through a temporary file
and renamed, so an interrupted write cannot destroy the previous good store. A settings file from an older
build still carries its notes: they are read from it once and migrated on the next save.

*Regression test*: the integration harness seeds 8 notes with 500 KB attachments, asserts the two stores'
sizes, sends a message, and asserts **zero** note bytes were rewritten:
[evidence/major-update/monitor-smoke.json](evidence/major-update/monitor-smoke.json)
(`notesPersistence.noteBytesWrittenByOneEvent: 0`).

### D2 — P1 — Desktop: every broadcast carried every note attachment to every window

*Feature*: the dashboard snapshot / IPC.

*Evidence*: `snapshot()` returned `notes: state.notes` — the full note objects including base64 bodies —
and `broadcast()` structured-clones that object into up to four renderers (dashboard, bubble, menu, notes
window) after every monitor event. No dashboard surface draws an image: the Notes page prints
`▧ Image attached` from `note.image`'s truthiness, and the note editor reads its own `bop:notes-snapshot`
IPC.

*User impact*: the same multi-megabyte copy per event, in both processes, for data nothing on screen uses.

*Fix*: `notePreview()` projects `{id, sender, timestamp, text, image: boolean}` for broadcast state. The
editor's full-note IPC is unchanged.

*Verification*: covered by the same harness run (the dashboard renders, the seeded notes appear, the
editor path is untouched); the payload reduction is by construction, not separately benchmarked — see
[Known limitations](#known-limitations).

### D3 — P1 — Desktop: a signed-out account stopped announcing messages and said nothing

*Feature*: notification reliability, authentication expiry.

*Evidence*: `AccountMonitor.ready(url)` sets `reauthentication-required` when the loaded URL matches a login
route, after which `title()` returns `{changed:false}` for every reading. Nothing in `main.js` raised an
alert for that state — only `did-fail-load` and `render-process-gone` did. The dashboard card showed the
raw status string, which a user who does not open the dashboard never sees.

*User impact*: exactly the reported symptom — messages arrive, no notification, no explanation. The account
looked healthy because nothing said otherwise.

*Fix*: new pure module `desktop/src/main/monitor-health.js` decides when the user must be told, and
`main.js:applyHealth()` turns that into one alert per space (tag `health`, replaced not stacked) plus a
native notification and a reminder card. Entering the state raises it once; staying in it does not repeat;
a working load clears it silently.

*Regression test*: unit tests in `desktop/test/monitor-health.test.js` (8 cases), and a real integration
step: the harness loads a `/login` route and asserts one card for account A only, no repeat while it stays
there, and that it clears when `/chat` loads again — while account C's event still reaches the user.

### D4 — P1 — Desktop: the bounded retry gave up in silence

*Feature*: notification reliability, connection loss.

*Evidence*: `retrySpace()` schedules retries only while `monitor.failures <= 5`. The sixth failure set
`temporarily-unavailable` and scheduled nothing, forever. No state, alert or badge recorded that monitoring
had stopped.

*Fix*: `AccountMonitor.suspend()` sets a distinct `monitoring-stopped` state; `retrySpace()` calls it when
the budget is exhausted, and the same health rule raises one card ("… stopped being monitored … open the
space to start again; the saved session is kept"). The dashboard label map in `renderer/app.js` now reads
the six real states in words a user can act on instead of raw identifiers.

*Regression test*: unit-tested (`monitor-stopped` transition, and no stale title can revive a suspended
monitor). The 930-second retry ladder is too slow for the integration harness, so the exhausted path is
**not** exercised end-to-end — see limitations.

### D5 — P1 — Android: a notification-listener reconnect erased another source's alert and every dismissal

*Feature*: account/source isolation, notification reliability.

*Evidence*: `HubRepository.connected()` did `alerts = emptyMap()`, and `onListenerDisconnected()` called
`HubNotifications.clear()` (which clears the `posted` signature map) after `disconnect()` had already
dropped every non-web alert. Android drops this listener routinely (updates, revoked-and-regranted access,
memory reclaim).

Two consequences, both user-visible:

1. The open web session's own alert needs no notification access, but it was erased with the rest. It only
   came back when the page reported a *different* unread count, which may never happen.
2. Every dismissal was forgotten, and because `posted` was cleared too, a reconnect re-posted cards the
   user had already swiped away — the 1.3 defect the current code claims to have fixed, still reachable
   through this path.

*Fix*: a reconnect changes the connection flag and nothing else (`HubReducer.connect`); a disconnect stops
ingestion without erasing what was observed (`HubReducer.disconnect`). Reconciliation against the live
notification set still prunes genuinely gone sources, and `upsert` preserves a dismissal for unchanged
content. `onListenerDisconnected()` re-syncs after clearing so surviving web alerts are republished at once
rather than waiting for a new reading.

*Regression test*: `app/src/test/java/com/example/twoaccmess/HubReducerTest.kt` (6 cases): dismissal
survives a disconnect+reconnect+re-ingest; a web alert survives a reconnect; two slots keep independent web
counts and catching up in one does not silence the other; an unchanged count keeps a dismissal while a real
increase reopens it; two slots of one app are never guessed. One pre-existing assertion in
`ExampleUnitTest` encoded the old "wipe on disconnect" rule and was updated to the new invariant; its
"no ingestion while disconnected" half is unchanged and still asserted.

### D6 — P1 — Desktop: notifications raised inside an allowed sign-in popup were dropped

*Feature*: website-notification attribution.

*Evidence*: the `bop:web-notification` handler resolved the owning space by searching `spaceViews` for a
matching `webContents.id`. A popup created by `did-create-window` shares the opener's session and preload
but is not in `spaceViews`, so `owner` was undefined and the event was discarded without a trace.

*Fix*: popups are attributed to the space that opened them (`popupOwners`, populated when the popup is
created, cleaned up on `destroyed`). Attribution stays Bop's decision — the page still cannot name an
account — and the existing `pageAllowed` check still applies.

*Verification*: code-reviewed only. No automated test creates an allowed popup and raises a notification
inside it; see limitations.

### D7 — P3 — Desktop: a relative `--bop-out` killed the verification run before it started

*Evidence*: `npx electron . --bop-monitor-smoke --bop-out ./dist-smoke` printed
`App threw an error during load / Error: Path must be absolute` and hung with an empty output directory.
`SMOKE_OUT` was passed verbatim to `app.setPath('userData', ...)`.

*Fix*: `SMOKE_OUT` is `path.resolve(...)`. Found while verifying this change, fixed because it makes the
harness usable from the documented command line.

### D8 — P2 — Desktop: the dashboard renderer kept a full-rate compositor while hidden

*Evidence*: `uiView` (the dashboard, which has no monitoring duty) was created with
`backgroundThrottling: false`, so a hub behind other windows kept its renderer at full rate. Space views
keep that setting on purpose, and that reason is documented in `docs/desktop.md`.

*Fix*: the dashboard uses Chromium's default throttling; the comment in `spaceView` still explains why the
space views are the exception.

*Verification*: reasoned from the platform behaviour, **not measured** — I did not have a way to profile
compositor time on this machine. Called out in limitations.

### D9 — P3 — Documentation contradicted the code

*Evidence*: `docs/monitoring.md` still said "Background throttling is enabled rather than disabled for all
page work", while the code (and the newer `docs/desktop.md`) disables it for space views by default.

*Fix*: the desktop section of `docs/monitoring.md` now matches the code, and both documents gained the
new health states, the two-store persistence model, and the diagnostics procedure. The counts quoted in
both documents were also two releases out of date (51/106 tests, "no device attached"); they now match
this run's numbers and its emulator evidence.

### D10 — P2 — Android: an alert already received stayed invisible after the notification permission was given back

*Feature*: Android notification reliability, permission changes.

*Evidence, on the emulator* (Android 17 / API 37, `sdk_gphone16k_x86_64`): with a bound WhatsApp slot and
`POST_NOTIFICATIONS` granted, a fixture notification produced card `hub-account-C`. Revoking the permission
removed that card and made the next alert post nothing (correct). Granting the permission again and
returning to the hub left **zero** cards, and none appeared until a *later* message arrived. The alert was
still in the hub's state the whole time; only the shade had lost it. Nothing broadcasts a permission change,
and `HubNotifications` remembers what it posted, so no sync was ever triggered.

*Why it matters*: this is the same shape as the reported symptom — a message arrives, and outside the app
nothing says so. Granting the permission is exactly the moment a user expects the missed alerts to appear.

*Fix*: `HubNotifications.restore()` re-syncs on `MainActivity.onResume`, and a card whose content is
unchanged is re-posted **silently** when the shade no longer holds it (`NotificationManager.activeNotifications`
is consulted instead of trusting the in-memory `posted` map). Restores stay scoped to that resume path, so a
swipe whose acknowledgement broadcast is still in flight cannot turn into the 1.3 "dismissed card comes
back" loop.

*Verified on the emulator*: baseline card → revoke → new message → 0 cards → grant → return to hub →
**1 card**, and the sequence is recorded in [the device evidence](evidence/major-update/android-device.json).

### D11 — P3 — Android: a cold start could delete an added slot's notification channel, and its mute choice with it

*Feature*: Android alert channels (`HubNotifications.createChannels`).

*Evidence*: `sync()` calls `createChannels(context, state.slots)`, and that function treats every slot
**not** in the list as removed — it deletes the channel and the channel group. Before the encrypted store
has loaded, `HubState` is the default (A and B only) with no alerts, so a sync in that window deletes the
channel of every extra space. That silently resets a user's per-account mute/importance choice for that
space, which Android stores on the channel itself.

Reached by the listener's state collector when the service connects before the store is ready, and made
certain by D10's new resume-time restore, which runs on every cold start. Not observed on the emulator
(the store loaded first every time), so this one is a code-path finding, not a reproduction.

*Fix*: `syncInternal` returns until `state.ready`. `MainActivity` re-runs `restore` from a `LaunchedEffect`
keyed on `state.ready`, so the cards D10 is about still come back once the real state is in memory.

## 3. What deliberately did **not** change

- **The rest cycle** (`REST_RUN_MS` 45 s / `REST_MS` 7 min) is unchanged. It is the existing, documented
  memory trade-off; replacing it with an unsolicited suspend was explicitly out of bounds, and it is not
  implicated in the per-event cost that was measured.
- **`backgroundThrottling: false` on space views.** It is what keeps a hidden chat page running its own
  timers; removing it would quietly reduce monitoring coverage, which the brief forbids.
- **`CalculateNativeWinOcclusion`** stays in the disabled-features list. Re-enabling it would let Chromium
  stop painting covered windows, but it also risks the always-on-top bubble being treated as occluded, and
  I could not measure either effect here. Recorded as an open performance hypothesis in
  [Recommended next steps](#recommended-next-steps) rather than an untested change.
- **No new timers, workers or services** were added anywhere. The new health logic is event-driven.
- **Android LAN permission flow** was inspected and found correct: `pairNotes()` calls `syncNotes()`, which
  requests `ACCESS_LOCAL_NETWORK` at runtime on SDK ≥ 37 and only then pairs; `HubRepository.startNotesSync`
  independently refuses to start without it. No change was needed.
- **No "region" mapping was invented.** Adding one would be inventing a concept the product does not have.

## 4. Verification

| Check | Command | Result |
| --- | --- | --- |
| Desktop tests | `cd desktop && npm test` | **136 tests, 0 failures** (128 before, 8 new) |
| Desktop syntax | `node --check` on all `src/main` + `src/renderer` files | pass |
| Desktop integration (real Chromium, real SSE, real OS `Notification`, real encrypted stores) | `npx electron . --bop-monitor-smoke --bop-out "$(pwd)/dist-smoke"` | **passed**, 10/10 steps, 19 OS notifications requested, 0 failed — [evidence](evidence/major-update/monitor-smoke.json) |
| Desktop functional smoke (windows, panes, dialogs, theme, reminder, bubble drag, sign-in grant, delete) | `npx electron . --bop-smoke --bop-out "$(pwd)/dist-smoke"` | **ok: true**, 51 steps — [evidence](evidence/major-update/source-smoke.json). Its `pane-visibility` step still reports **12 timer ticks in 1200 ms** in a space pane, which is the un-throttled monitoring behaviour D8 deliberately left alone |
| Persistence cost | `npx electron tools/perf-notes.js` | 27.04 ms → 0.36 ms per save; 5,334,711 → 285 bytes written |
| Retry ladder, end to end | `npx electron . --bop-retry-smoke --bop-out "$(pwd)/dist-retry"` | **ok: true**. Six real failed navigations at the production 30/60/120/240/480 s backoff, `monitoring-stopped` at **930.9 s**, no retry scheduled, one card ("Account A stopped being monitored") and **one** OS notification; a working load cleared the card without a new notification — [retry-smoke.json](evidence/major-update/retry-smoke.json) |
| Android JVM tests | `./gradlew :app:testDebugUnitTest` | **142 tests, 0 failures** (6 new) |
| Android debug build | `./gradlew :app:assembleDebug` | **BUILD SUCCESSFUL** |
| Android on a device | `adb install -r` on `emulator-5554` (Android 17, API 37), driven from adb | 10 checks, 0 failed — [android-device.json](evidence/major-update/android-device.json) |
| CI | `.github/workflows/ci.yml` | added: desktop `npm ci` + `node --check` + `npm test` on Windows, Android `testDebugUnitTest` + `assembleDebug` on Linux with JDK 21. Not yet executed by GitHub — see limitations |

Notification matrix coverage, against the 16 combinations the brief lists (desktop unless stated):

| # | Scenario | Evidence |
| --- | --- | --- |
| 1 | One account, normal event | harness steps 1–3 |
| 2 | Two accounts, same monitored application | harness step 1 (A/B/C, same origin, isolated sessions) |
| 3 | Interleaved/overlapping events | harness "distinct consecutive accounts"; Android `interleavedArrivalsNeverMutateOtherAccountContext` |
| 4 | Different account context per event | every alert carries its captured `spaceId`; Android `AlertKey(accountId, sourceKey)` tests |
| 5 | One account unauthenticated, other healthy | harness "a login route raises exactly one card …"; C keeps alerting |
| 6 | Monitored source returns an error | harness "renderer crash … with real backoff" |
| 7 | One account's worker stops / connection fails | harness crash + offline/online steps; B and C unaffected |
| 8 | Network disconnect and recovery | harness "fixture site reconnects its own EventSource" |
| 9 | App hidden / backgrounded | harness "minimized and closed-to-tray" |
| 10 | Desktop minimize / tray | same step (minimize, restore, close-to-tray) |
| 11 | Android background / process recreation / permission change | **passed on the emulator**: `am kill` then relaunch restored 3 spaces and kept alerting; `cmd notification disallow_listener` + `allow_listener` did not resurrect a dismissed card; `POST_NOTIFICATIONS` revoke/re-grant covered by D10; forced deep idle still ingested a message |
| 12 | Restart with multiple accounts | **passed on the emulator**: `adb reboot` → hub starts with 3 spaces (A/B Messenger, C WhatsApp) and notification access intact; encrypted-store round-trip is also covered by the harness |
| 13 | Duplicate delivery and retry | harness "unchanged state is quiet …"; Android `a_listener_blip_does_not_reopen_a_dismissed_card` and the device run above |
| 14 | Unknown or missing region/context | not applicable: a space id is always present; an unknown id is dropped (`accountFor` returns null) |
| 15 | Notifications disabled at OS level | harness denies *website* notifications and asserts the title source still works. **On the emulator**, revoking `POST_NOTIFICATIONS` from the hub itself suppressed cards while the alert stayed in state (0 cards), and D10 covers the re-grant |
| 16 | Recovery after a persistent source error | `npx electron . --bop-retry-smoke`: the sixth failure raises one card at 930.9 s and a working load clears it silently — [retry-smoke.json](evidence/major-update/retry-smoke.json) |

The harness distinguishes the four stages the brief asks about: it counts **OS notification requests**
(`notificationAttempts`, incremented immediately before `notice.show()`), counts **OS `show` events**
(`osNotificationDiagnostics.shown`), and fails the call on **`failed`**. It never claims a human saw or
heard a notification; `audibleSoundVerified` is `false` in the evidence file and stays that way.

## 5. Resource numbers from the run

From [the harness evidence](evidence/major-update/monitor-smoke.json), three tiny local fixture pages:

| State | Summed working set | Summed interval CPU |
| --- | ---: | ---: |
| Idle, 3 sessions | 817.23 MiB | 0.028 % |
| Active, 6 spaced events | 823.88 MiB | 0.505 % |
| All sessions stopped | 553.23 MiB | 0.197 % |

These are **not comparable** to the 712.63 MiB figure in `docs/monitoring.md`: that run had no note store,
and this one deliberately holds 2.1 MB of seeded attachments to measure persistence. Do not read a
regression into it. Idle request delta during the 4-second sample was **0**.

## 6. Known limitations

- **The Android device is an emulator**, not a phone: `sdk_gphone16k_x86_64`, Android 17 (API 37). Real
  OEM battery managers, real Doze calibration, physical WebView builds and provider notifications are still
  not exercised. The LAN permission flow was reviewed in code (and its runtime request is correct); it was
  not paired against a second machine here.
- **One un-explained native crash was observed on the emulator.** A single `SIGILL` in
  `:messenger_c` inside `libwebviewchromium` (`WebViewChromium.onTrimMemory`) occurred while that
  background slot's process was being reclaimed after `am kill`. It did not reproduce on a plain launch,
  no app frame appears in the tombstone, and it is recorded rather than claimed fixed.
- **CI has not run yet.** The workflow is committed but GitHub has not executed it; the same commands were
  run locally in this checkout.
- **The notification-provider fixture is a tool, not a test suite.** `tools/notifier-fixture` posts real
  `MessagingStyle` notifications as `com.whatsapp` on a throwaway emulator; the device checks above were
  driven by hand from adb, not by an automated instrumentation test.
- **No live messaging account.** Every desktop event came from a local SSE fixture. Nothing here proves a
  provider's real push, title format or notification behaviour.
- **The retry path is proven against a refused local connection**, not a provider outage. Six consecutive
  real navigation failures drive the production ladder (`--bop-retry-smoke`, 930.9 s), but what a provider
  does after sixteen minutes of failure is a different question.
- **Popup attribution has no automated test.** Creating an allowed popup in the harness would need a
  same-origin navigation that the permission flow accepts; reviewed but unproven.
- **D2's payload reduction is by construction.** The removed bytes were not benchmarked separately from D1;
  the sizes are bounded by the documented 500 KB per image and 12 MB per store.
- **D8 is reasoned, not measured.** No compositor-level profiling was possible here.
- **Desktop memory in the harness is higher than the previous document's figure** because of the seeded
  notes; a like-for-like memory comparison before/after this change was not made.

## 7. Recommended next steps

1. ~~Exercise the retry-exhaustion card end to end~~ — **done**: `--bop-retry-smoke` ran the production
   ladder to exhaustion (930.9 s), raised exactly one card and one OS notification, and cleared the card on
   a working load ([evidence](evidence/major-update/retry-smoke.json)).
2. Decide the occlusion question with a measurement: profile GPU/compositor CPU with
   `CalculateNativeWinOcclusion` present and absent, including the always-on-top bubble, before changing it.
   Not attempted: it needs a profiler attached to a running build on this machine.
3. ~~Run the Android matrix rows that need hardware~~ — the background/doze, process-death, listener
   revocation, permission and reboot rows now **pass on an API 37 emulator**. Still open: a **real phone**
   with an OEM battery manager, and one real provider message per supported app.
4. Give the Android cockpit a per-slot "last successful check" line from the same health timestamps the
   desktop now exposes, so both products report monitoring health in the same terms. Not built: it needs a
   new persisted field in the encrypted hub state, and it is presentation work rather than a confirmed
   defect, so it was left out of this change instead of being rushed in at the end.
5. Run the new GitHub workflow once on a pull request to confirm a clean runner has everything the local
   machine had (JDK 21, the Android SDK licence, and the Electron download behind `npm ci`).
