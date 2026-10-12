# Bop — verification and delivery

## Desktop 0.1.9 — release check, English only, one build left (October 10, 2026)

Asked for: whether the app is ready to release and, if anything needs fixing for that, to fix it; to turn
every Vietnamese string into English; and to delete the older builds, keeping only the newest one.

**The verdict.** Ready as a portable desktop build. Three things stay outside this round's reach and are
recorded as limitations rather than passes: the artifact is unsigned (SmartScreen warns on first launch),
no real signed-in account has ever been tested, and this build has no installer target. Full round notes,
with the before/after numbers: [release-019.txt](evidence/desktop-portable/release-019.txt).

| Check | Result | Evidence |
| --- | --- | --- |
| Desktop unit tests | **86 passed**, 0 failed, 0 skipped, exit 0 | `npm test` |
| Android JVM unit tests, forced re-run | **124 passed**, 0 failed / errors / skipped, exit 0 | `./gradlew :app:testDebugUnitTest --rerun-tasks` |
| Packaged smoke from the portable EXE | **45 steps**, `ok: true`, 4 alerts, `packaged: true`, `missingFiles: []` | [packaged-smoke-019.json](evidence/desktop-portable/packaged-smoke-019.json) |
| Live check on the same file | **15/15**, 0 failed, exit 0 | [live-check-019.json](evidence/desktop-portable/live-check-019.json) |
| Real-pointer drag of the bubble, portable EXE | press (70,393), window 38,361 → 258,491 for a +220,+130 drag, **offBy 0** | [live-check-019.json](evidence/desktop-portable/live-check-019.json) |
| Delivered `app.asar`, searched for Vietnamese | 2 signature characters, both inside binary PNG blobs — text is English only | [release-019.txt](evidence/desktop-portable/release-019.txt) |
| Android APKs, searched for Vietnamese + `aapt2 dump configurations` | no Vietnamese string, and no locale configuration at all in either APK | [release-019.txt](evidence/desktop-portable/release-019.txt) |

- **English: the desktop app already was, the APK was not.** Bop's own Android strings are English, but
every AndroidX library brings its own translations, so 88 merged `values-*` folders — `values-vi` among
them — went into the APK and a phone set to Vietnamese showed library text in Vietnamese. Fixed with
`androidResources { localeFilters += listOf("en") }` in [app/build.gradle.kts](../app/build.gradle.kts);
the release APK went **1 467 466 → 1 336 583 bytes** and no longer carries a single language.
- **Two smoke steps were waiting faults, and both are fixed.** The packaged smoke failed once on a busy
machine with “no reminder card appeared for a web notification” and once with “the dashboard reports
hidden” while the user's own copy of Bop covered the smoke's window. The first awaited a fixed 500 ms for
a window that still had to create and load itself; the second read the dashboard's visibility once. Both
now wait, bounded, for the real condition, and both pass on the delivered file.
- **Deleted: every build but the newest.** 0.1.2 → 0.1.8, nine files, each size and sha256 recorded before
removal ([record](evidence/desktop-portable/release-019.txt)). `desktop/dist` holds one executable,
`Bop-0.1.9-portable.exe`. One older copy could not be removed because the user's running instance holds
it: `C:\Users\nguye\OneDrive\Desktop\Bop-0.1.8-portable.exe`.
- **Why the version moved.** The two waiting fixes are inside the app's own source (`src/main/main.js`, the
`--bop-smoke` path). Shipping them under `0.1.8` would have left the tree and the artifact disagreeing
about what `0.1.8` is, so the artifact is 0.1.9. No user-facing code differs between the two.

## Desktop 0.1.4 — boots with the machine, lives in the tray, pages stay alive (October 9, 2026)

Requested: test the whole desktop app again and fix everything broken in the app and in web-notification
tracking, make the desktop app run as soon as the machine boots, land it in the tray, and have the Bop
bubble there by default with an easy way to open and put it away.

- **Found and fixed a real cause of "nothing arrives".** Measured with the app's own DevTools protocol on
  0.1.3: every space pane *and the dashboard itself* reported `document.visibilityState === 'hidden'` and a
  100 ms timer fired **10 times in 10 seconds** — a child view of a `BaseWindow` is never told it became
  visible, so Chromium treated each space as a throttled background tab (after five minutes hidden, a page
  is intensively throttled to about one timer a minute). A site in that state hands its messages to a
  service worker, and **Electron does not implement Web Push**, so those alerts never reached Bop. Fixed
  with `backgroundThrottling: false` plus an explicit `view.setVisible(...)` per pane. Measured after:
  **20 ticks in 2000 ms** in the open pane and in a background pane, the open pane reporting `visible`, a
  never-opened pane reporting `hidden` (see the `pane-visibility` and `open-pane-visible` smoke steps).
- **Built `desktop/dist/Bop-0.1.4-portable.exe`** with `npx electron-builder --win portable --x64`,
  85,191,512 bytes, sha256 `762b9858cff386892d7c26505fb5247e396aa0ef20cc9b912179306ce0f56fa8`; the copy on the
  user's Desktop is the same file (hash compared). Not code-signed (`NotSigned`), so SmartScreen warns on
  first launch. [Evidence bundle](evidence/desktop-portable/build-smoke-live-014.txt).
- **The built EXE ran the 30-step smoke: `ok: true`, 30 steps, 4 alerts**
  ([report](evidence/desktop-portable/packaged-smoke-014.json)), including the new `defaults`, `tray`,
  `autostart`, `pane-visibility` and `open-pane-visible` steps, and the existing web-notification evidence:
  `watcher`, `web-notification`, `reminder-card` and the live bubble badge.
- **A new live check passed 13/13 against that same EXE** ([report](evidence/desktop-portable/live-check-014.json)):
  [tools/live-check.js](../desktop/tools/live-check.js) starts the app the way a user does — no smoke flag,
  a real `http://127.0.0.1` origin, its own `--user-data-dir` — and then reads what the app itself reports
  over the DevTools protocol: dashboard IPC, the bubble window at 64x64 on screen, both space pages and
  their notification bridge, a page's own `new Notification(...)` becoming an alert *and* an on-screen card
  with its text, an unread tab title, a watched page that changed in place raised by the watcher's own
  timer, the rendered Alerts page, the bubble badge, the tray state, and the start-up entry switched off
  and on again. It also proves the **bubble appears for a profile that never asked for one**, because the
  check's profile has no `bubble` field at all.
- **Start-at-login, verified against the operating system, not the preference.** After the delivered copy
  was started once, `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` held
  `com.bop.desktop = "C:\Users\nguye\OneDrive\Desktop\Bop-0.1.4-portable.exe" --bop-autostart` — the file
  the user launched, not the temporary unpack directory the portable build runs from. A development run
  registers nothing (asserted in the smoke), and the packaged smoke run leaves the registry untouched.
- **On the real profile, with the user's own stored settings:** window enumeration after launching the
  delivered copy reported `"Bop bubble" visible=True at 0,361 size 64x64` and `"Bop" visible=True at
  320,106 size 1280x820` — a 64 px bubble docked flush to the left edge, from a settings file whose stored
  value was the old `bubble: false` default.
- **Tests:** 69 desktop unit tests pass (0 failed/skipped; +5 for the start-at-login decision and the new
  defaults). Source smoke passes 30 steps, the packaged EXE passes the same 30.
- **Not verified:** no real Messenger/TikTok/WhatsApp/Telegram account was signed in, so real message
  delivery is still unverified; service-worker `showNotification` and Web Push remain uncaptured (Electron
  has no Push API); the installer target was not rebuilt or installed; the artifact is unsigned.

## Portable-only desktop rebuild and an English pass (October 8, 2026)

Requested: rebuild the desktop app as a **portable EXE only** (no installer), confirm the desktop build
notifies from the web, and make sure everything the project ships reads in English.

- **Built `desktop/dist/Bop-0.1.3-portable.exe`** with `npx electron-builder --win portable --x64`,
  exit 0. Bytes and hash updated above; the earlier setup EXE was not rebuilt and the 0.1.2 artifacts
  were left untouched. The executable is **not code-signed** (`Get-AuthenticodeSignature` → `NotSigned`),
  so SmartScreen warns on first launch. [Build and smoke log](evidence/desktop-portable/build-and-smoke.txt).
- **The built EXE ran the full 25-step smoke: `ok: true`, 25 steps, 4 alerts**
  ([report](evidence/desktop-portable/packaged-smoke.json)), which is the web-notification evidence:
  `watcher` raises a card when a watched page changes, `web-notification` mirrors a page's own
  `window.Notification`, `reminder-card` draws Bop's own on-screen card, and `bubble-unread-live` moves the
  live badge 4 → 3. A portable launcher returns before its child exits, so the child's completed report,
  not the launcher's exit code, is what is recorded here.
- **English pass:** every README, doc and app string was scanned for non-Latin/Vietnamese text. No
  Vietnamese remained in code or documentation; [desktop-notification-preview.html](desktop-notification-preview.html)
  was the one document written in Vietnamese and is now English, rebuilt on this round's captures.
- **Corrected by this round:** the recorded hash for the portable EXE was the previous build's, and
  [desktop-release-verification.json](desktop-release-verification.json) still said 42 unit tests (64 now)
  and did not say which smoke belonged to which artifact. Both are updated rather than left to drift.
- **Not verified:** no real signed-in account in the desktop build, no real provider message, no installer
  rebuild, and no code signing. The desktop smoke uses local fixture pages.

## Round-robin unread scan core (October 8, 2026)

The 10-second sweep now exists as code and is tested, but only as a core: promised vs delivered, the
process-boundary reason a driver cannot simply be added to the hub, and the acceptance criteria for
wiring it up are in [scanning.md](scanning.md).

- 18 new JVM tests for the sweep, the unmuted baseline rules, adapter failure isolation and the page
  payload format; full suite **124 tests, 0 failures/errors/skips**, exit 0
  ([raw log](evidence/scanning/jvm-tests.txt)).
- An in-page reader with **one descriptor for every catalog app** (19 ids), verified against a local
  fixture chat page through a real DOM: 13 Node tests, desktop suite 64/64, asset packaged
  (`:app:mergeDebugAssets`, exit 0). [Raw output](evidence/scanning/reader-tests.txt).
- The shipped asset also ran in a **real Chromium engine** (`npm run smoke:unread`, 7/7 steps, exit 0,
  [report](evidence/scanning/reader-smoke.json)): injection, the muted-arrival case and every refusal path.
  That run found and fixed two real bugs in the asset — a missing promised count used to be reported as
  "1 unread" (an invented message), and a partial reading used to encode as `muted=undefined`. Neither the
  fixture nor the engine proves anything about a real service's markup, and no account was signed in.
- **Not implemented by this round:** no verified selectors for any real site (every app is still driven
  by its tab title, which cannot distinguish muted conversations); no 10-second driver; no IPC for
  readings; the hub still builds web cards from the title path ([WebUnread]). No APK was assembled, so
  nothing here is a device or delivery claim.

## D-backed emulator attempt (October 8, 2026)

[Full report and rerun command](emulator-D.md). A new test AVD and its writable data/cache live on D:;
the existing user AVD on C: was not moved or deleted. The 1 GiB guest booted but was unstable; a 2 GiB
launch without `-lowram` was auto-promoted to 4 GiB and failed RAM/commit checks. With `-lowram`, 2 GiB
booted and the existing APK's onboarding/Spaces UI was verified by real Android taps, scroll,
UIAutomator and [screenshot](evidence/emulator-D/spaces.png).

**Not passes:** both individually attempted instrumented web-entrypoint/profile tests ended with
`Process crashed`; Android exit-info identifies `LOW_MEMORY`. No signed-in account, real message,
website-muted chat, 10-second scanner or screen-off delivery was tested. No APK was rebuilt this round.
The emulator was stopped and only its disposable snapshot RAM/cache was cleared; reusable data stays
on D:. Previous rounds' absence-of-device claims remain historical, not claims that this attempt
completed their device checks.

## Lightweight monitoring source upgrade (October 8, 2026)

Current findings, code paths, per-service mechanism matrix and acceptance gaps:
[monitoring.md](monitoring.md). This source-only round **does not rebuild the older APK/EXE artifacts**
below. Their prior hashes remain historical artifacts, not a delivery of the new monitoring code.

- Desktop: 51 Node unit tests, no failures/skips; JS syntax checks; 3 separate local SSE Electron
  sessions independently monitor while another is selected/minimized/hidden. Source notification
  permission denied, duplicate pairing, crash backoff, network restore, mute and cleanup verified.
  [Raw report](evidence/monitoring/monitor-smoke.json).
- Existing desktop regression: 25 recorded steps, `ok:true`, exit 0 after correcting the old fixed 900ms
  hidden-timer assumption to a bounded wait for the actual notification event. Assertions were retained.
  [Raw report](evidence/monitoring/regression-smoke.json).
- Android: 106 JVM tests, 0 failures/errors/skips; Kotlin compile via `:app:testDebugUnitTest`, no APK
  assembly. [Run log](evidence/monitoring/android-tests.txt).
- Final fixture totals: idle 712.63 MiB / 0.016% CPU, active 712.90 MiB / 0.205%, stopped 445.23 MiB /
  0.005%. All Electron processes included; fixture pages are much lighter than real messaging sites.
  No new HTTP requests in the 4-second idle sample. No speedup or Android battery savings measured.
- **Not verified:** real incoming provider messages, real authentication expiration, full-process
  restart with logged-in accounts, Android device/background delivery, or audible speaker sound.
  OS emitted 17 `show` events; that is not audio proof. Title counts are aggregate signals, not message
  IDs; unchanged/dot/capped counts cannot deliver exactly one ding per message or per-chat histories.
- Existing browser sessions/profiles retained; no remote infrastructure, new dependencies, foreground
  monitor service or wake locks. Test profiles/logs/cache on D:, never real account data cleanup.

## Desktop 0.1.3 reminder release (October 8, 2026)

Why this release exists: on the user's machine, with the portable build running, **no account reminded them**
of a new message. Diagnosis, measured rather than assumed:

- `C:\Users\nguye\OneDrive\Desktop\Bop-0.1.2-portable.exe` was the running build (unpacked into `%TEMP%`).
  No `Bop.lnk` existed in either Start Menu, `HKCU\...\Notifications\Settings` had **no Bop entry**, and
  `HKCU\...\PushNotifications\ToastEnabled = 1`. Windows therefore dropped every toast — Bop's and the
  space page's alike — and 0.1.2 only ever attempted a toast for a `watch` alert.
- Live partitions held `bop-a`, `bop-b`, `bop-c`; the cookie stores contained `.facebook.com`/`.messenger.com`
  only. Configured TikTok and Telegram spaces had never been opened, so they had no session at all.
- A probe against the real sites with the *phone* layout (the 0.1.2 default) landed TikTok on the For You
  feed instead of `/messages`, WhatsApp on `web.whatsapp.com/mobile/` ("Use WhatsApp Web by going to
  web.whatsapp.com from a browser on your computer"), Snapchat on its mobile landing page, and Skype on
  *Unsupported Browser*. Same probe, desktop layout: TikTok `/login?redirect_url=.../messages`, the real
  WhatsApp Web app, the Snapchat site, the Teams web app.

What changed: `src/main/popup.js` (unit-tested queue/placement), `src/renderer/alert.html|alert.js`,
main-process reminder window and IPC, `app.setAppUserModelId('com.bop.desktop')`, and a per-kind layout
default in `spaces.js` with a one-time version-2 repair of stored social spaces.

Checks:

- **42 unit tests pass**, zero failed/skipped (the suite is **64** today — see the section at the top of
  this file); every changed file passes `node --check`.
- Source smoke: **25 steps**, `ok:true`, exit 0.
- Packaged `win-unpacked/Bop.exe`: **25 steps**, `ok:true`, exit 0.
- Portable EXE: **25 steps**, `ok:true`. Its windowed launcher writes no stdout, so the completed report
  was read from the run's own `smoke.json` instead of inferred from the launcher's exit code.
- Extracted installer application: **25 steps**, `ok:true`, exit 0. Its `app.asar` matches the unpacked
  tested application: SHA-256 `fdd6f00389f8ef8d38bbcf2b5fe98f804b76eafc205d8a73c906f120e8d80613`.
  The install/uninstall script itself was **not** executed. That comparison belonged to this round: the
  later portable-only rebuild replaced `dist/win-unpacked`, so this hash no longer describes the files on
  disk, and the installer still carries the `fdd6…` asar while the rebuilt portable carries `544d…`.
- The reminder step drives the real path: a page in space A raises a real `window.Notification`, Bop's own
  card appears with `NEW MESSAGE ALERT · Account A · Same chat · Second message · Open Account A`, sits
  fully on screen, steps above a bubble parked in the same corner (`card.y+height <= bubble.y`), captures
  to `reminder.png`, and opening it opens account A, hides the card and marks that alert read.
- The layout step still proves a new task space defaults to the phone layout and switches both ways in the
  engine's own user agent, so the per-kind default did not leak into panels.
- No real Messenger, TikTok or Telegram account was signed in here: delivery of a real message into a
  space remains **unverified**, and service-worker/Web Push alerts are still not captured.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Portable EXE 0.1.4 — **deleted on 2026-10-10**; kept here as the record of what it was | 85,191,512 | `762b9858cff386892d7c26505fb5247e396aa0ef20cc9b912179306ce0f56fa8` |
| Portable EXE 0.1.3 — **deleted on 2026-10-10** | 85,185,034 | `ff764a3d94d6087347426ae66e61e94a79162381bad24d8371500eb876662109` |
| Setup EXE 0.1.3 (not rebuilt since 0.1.3; no 0.1.4 installer exists) — **deleted on 2026-10-10** | 85,405,210 | `228972635412e8c3359848d6a16fad4435dc6bdd21661a25c930ac037e6e3072` |

Both were copied to the workspace `desktop/dist` and the portable one to the Windows Desktop. The 0.1.2
artifacts remain untouched. **All five files in this table were deleted on October 10, 2026**, when the
older builds were removed and one executable was kept; the hashes stay here as the record of what they
were, not as files on disk. A user upgrading with the portable EXE keeps the same `%APPDATA%\Bop` data
folder, so spaces, opened-space ids and signed-in cookies survive; the old instance must be quit first
because both share one Chromium profile directory.

**Unresolved requests:** Android's two embedded web accounts still have no Messenger Web Push; no Android
code or APK changed this round. Embedding another app's actual bubble inside Bop is not implemented on
either platform. See [desktop limitations](desktop.md).

## Desktop 0.1.2 notification release (October 7, 2026)

- **36 unit tests pass**, zero failed/skipped; all main/renderer JavaScript files pass `node --check`.
- Source smoke: **23 recorded steps**, `ok:true`, exit 0.
- Packaged `win-unpacked/Bop.exe`: **23 steps**, `ok:true`, exit 0.
- Portable EXE: **23 steps**, `ok:true`. The portable launcher returned 0 before the child finished;
  the child's completed smoke report was checked separately, not inferred from launcher exit.
- Extracted installer application: **23 steps**, `ok:true`, exit 0. Installer `app.asar` matches the
  unpacked tested application: SHA-256 `59ecbcb9d17e4439d4c66736aabceb2f2740eb3837ca452fe22c6581f71dfd2b`.
  The install/uninstall script was **not** executed.
- Two real Chromium sessions on the **same loopback origin** request native notification permission
  and emit notifications from inline startup scripts. Both report `granted`, one alert each, native
  tags `bop:A:same-thread` and `bop:B:same-thread`. While Bop is hidden via Close, A receives another
  alert and replaces only A's card; B's first message remains unchanged.
- Dashboard IPC acknowledgement changes the live bubble count from 4 to 3. The menu initializes with
  B's pending count 1 and its B button opens B. Opened-space ids/URLs survive a real settings-file
  round-trip. This is not a two-process restart or live Messenger test.
- Earlier source smoke failed because the watcher read before `did-stop-loading`. The load wait was
  repaired (10-second bounded wait, failure reported as a failed read), then all checks were rerun.
- Build exit 0; both files were copied to the Windows Desktop and workspace, with SHA-256 equality
  checked for each copy. Prior desktop executables remain untouched (**since deleted on October 10, 2026**
  — see the round at the top of this file).

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Portable EXE 0.1.2 — **deleted on 2026-10-10** | 85,176,481 | `1edeb138384bdb9b3deb9e8c4079decab9aabfef2e30a8f56989e2cb43d16bbf` |
| Setup EXE 0.1.2 — **deleted on 2026-10-10** | 85,405,407 | `52fa33e59be87d2553fdd96b925f8224937e17e2470d06128318a70aa7d2bb13` |

[Machine-readable release checks](desktop-release-verification.json).
[Dashboard capture](screenshots/bop-notify-dashboard.png),
[bubble capture](screenshots/bop-notify-bubble.png),
[settings capture](screenshots/bop-notify-settings.png) are from the packaged portable application.

**Unresolved requests:** Android's two embedded web accounts still have no Messenger Web Push; no
Android code or APK changed this round. Embedding another app's actual bubble inside Bop is not
implemented on either platform. Real Messenger sign-in/delivery and service-worker notification
capture are not verified. See [desktop limitations](desktop.md).

## Android layout + realtime round (October 8, 2026)

Why this round exists: two owner-reported failures on the phone. A TikTok space never reached its
messages, and a message that arrived in an open web space produced no card and no badge.

**1. TikTok (and Zalo, WhatsApp Web) had no messages page.** Measured on this host on October 8, 2026
with the two user agents the app can send — the phone one is a real WebView agent, the desktop one is a
desktop Chrome agent standing in for `WebSessionPolicy.desktopAgent`, which the unit test pins (engine
version kept, `Android`/`Mobile`/`wv`/`Version/4.0` removed):

| Entry point | Phone agent | Desktop agent |
| --- | --- | --- |
| `https://www.tiktok.com/messages` | `302` → `/foryou` (the feed) | `302` → `/login?...redirect_url=...%2Fmessages` |
| `https://chat.zalo.me/` | `302` → `market://details?id=com.zing.zalo` | `200` |
| `https://web.whatsapp.com/` | `400` | `400` — this host's network answered the probe that way, so WhatsApp is **not** concluded from here |
| Telegram / Instagram / Discord | same as desktop | same as phone |

A fresh space now starts on the layout that has a messages view: `HubApp.desktopSite` is true only for
TikTok, Zalo and WhatsApp Web, `WebSessionPolicy.defaultDesktop` reads it, and a switch the user flipped
still wins. Layout rule 2 in [MessengerWebActivity](../app/src/main/java/com/example/twoaccmess/MessengerWebActivity.kt)
drops a `desktop` value an older build wrote as *its* default (with no real flip behind it), so those
spaces pick the new rule up once without overriding anyone's choice.

**2. An open web space now updates the bubble and its card in realtime.**
[WebUnread](../app/src/main/java/com/example/twoaccmess/WebUnread.kt) reads only the page's own unread
marker out of its tab title; the page hands back nothing but that title through a single-method bridge;
the session's process sends the slot plus a count to the hub process
([WebAlertReceiver](../app/src/main/java/com/example/twoaccmess/WebAlertReceiver.kt)), which raises the
same kind of card the notification listener posts. No message text, sender or DOM content is read orstored, and the title itself is not persisted. Unread the loaded page already had never raises anything,
the same count twice does not alert twice, and a count that falls back to zero removes the card.

The reading is a **foreground** one, on purpose: leaving the space runs `WebUnread.STOP_SCRIPT`, which
clears the page's timer, and coming back installs the watcher again and reads the marker once more, so a
message that arrived during the break is still reported as new. That also fixed a real inconsistency:
the earlier build only paused WebView timers for the A–P slots, so a later slot kept polling a hidden
page for as long as it existed.

**Environment note (machine-local, not a product claim):** the first build attempts of this round
failed because the system drive reported `0` bytes free — Gradle could not write its daemon registry, so
nothing to do with the code. The Gradle home and the Android SDK were then moved off C: to `D:\dev\`
(5.2 GB + 7.2 GB, C: back to 15 GB free), and Gradle, the tests and the APK were re-run from there:
`BUILD SUCCESSFUL`, 105 tests, and the debug APK came out **byte-identical** (`e7b442c7…`), which is why
one hash still covers both builds. A cleanup helper lives at `D:\dev\clean-caches.sh`.

Checks that ran this round:

- **105 JVM tests, 0 failures / errors / skips** (was 87). New: 15 in
  [WebUnreadTest](../app/src/test/java/com/example/twoaccmess/WebUnreadTest.kt) covering the title shapes
  the live services use, the raise/clear rules, the script's hygiene (no `textContent`, `querySelector`,
  `document.cookie` or `fetch`), the stop/resume scripts, the diagnostics line, the dot-only and
  above-99 limits, the rule that a web alert counts without notification access while another slot's
  alert still needs it, and the refresh that must not wipe an open session's alert. Updated:
  `WebSessionPolicyTest` (10) pins the per-app layout rule and the layout line the diagnostics prints,
  `HubAppsTest` pins which entries may claim the desktop site, `AccountAlertsTest` pins the test-card
  wording for a web-only app.
- **Both fixes are readable on the phone itself.** A space now writes what it asked for and what the
  watcher did into its session status: `Settings → Session diagnostics` shows the layout line
  (`TikTok · desktop site` for an entry measured as having no phone messages page) and then
  `tab-title watcher running`, `new message seen in the open tab · 3 unread`, `caught up in the open tab`
  or `tab-title watcher stopped (space off screen)`. That is the intended way for the owner to confirm
  the two fixes without a debugger — and it is an in-app claim that has **not** itself been seen on a
  device yet.
- `./gradlew :app:testDebugUnitTest :app:assembleDebug` → `BUILD SUCCESSFUL`
  (log `/d/tmp/bop-android-bugfix4.log` and `/d/tmp/bop-android-bugfix5.log`, outside this checkout; the
  first two attempts of this round failed for environment reasons — the system drive reported
  `0` bytes free — and were not counted as passes).
- The shipped watcher scripts ran in a real browser engine, not only in JVM text tests:
  [evidence/web-title-watcher.html](evidence/web-title-watcher.html) evaluates the exact
  `WebUnread.SCRIPT` and `STOP_SCRIPT` extracted from the Kotlin source, next to a stand-in bridge, and
  the measured sequence was `["watcher harness", "(3) Messenger", "(4) Messenger"]` across four steps:
  one baseline report on install, one report for a title change, **no** report while stopped although the
title changed and two poll intervals passed, and the missed change reported on resume (Chromium,
  October 8, 2026).
- **Bugs found in this round's own code before shipping:** `HubNotifications.posted` was a plain
  `HashMap` written from two threads once the web receiver existed (now a `ConcurrentHashMap` with one
  atomic `put`, so a card is never posted twice or lost to a torn map); the receiver started one thread
  per broadcast, which could apply a later "caught up" reading before the "new message" reading it
  followed (now one ordered worker); `WebUnread.count` compiled two regexes per poll (now built once);
  and the watcher kept running on a hidden page for slots that are not A–P (now stopped on pause for
  every slot).

**Not verified this round, and not claimed:**

- **No device or emulator run.** The emulator refused to start on this host, which was short of memory:
  `ERROR: Insufficient RAM free for launching emulator. Needed: 4096.000000 MB` with 2794 MiB remaining
  (log `/d/tmp/bop-layout-emulator3.log`). The TikTok/Zalo rows above are HTTP answers, not a WebView on
  a phone, and the bridge → broadcast → receiver → card/badge path has **no on-device evidence yet**. The
  owner's phone is the first real check of both fixes.
- The eight device tests recorded in the screen-fit round were not re-run, and the release APK was not
  rebuilt, so its row below is still that round's artifact.
- [LayoutProbeTest](../app/src/androidTest/java/com/example/twoaccmess/LayoutProbeTest.kt) is kept as the
  owner's reproduction recipe for the two layout rows above: it asserts nothing and only prints where
  `tiktok.com/messages` and `chat.zalo.me` land with each agent, so it cannot fail the device suite, but
  its numbers are **not** among the checks above — it has never been run.
- A web session still has no background delivery: nothing arrives while the space is closed, and a
  hidden space is deliberately not polled — its timer stops on pause and the marker is read again on
  resume, which is where a message missed during the break is picked up.
- Two honest limits of the reading itself, both pinned as tests rather than hidden: a client that draws a
  marker with no number at all (`"• Discord"`) reports an unread state, not a count, so a second message
  of a session that is still marked produces no second card; and a count above 99 reads as "no marker",
  because these services draw `99+` rather than a number there.

## Android 2.0 (screen-fit round — superseded by the round above)

## Final artifacts

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| [Debug APK](../app/build/outputs/apk/debug/app-debug.apk) | 12,653,460 | `e7b442c7806e24e80081d70330b9682bf2024b25302fe1ca424196ff095c62a1` |
| [Unsigned release APK](../app/build/outputs/apk/release/app-release-unsigned.apk) | 1,467,466 | `c2db7abce90528ad965a39c9070d689983b000d9d30955a97a6f33fc194da2ce` |

Debug: `com.example.twoaccmess`; release: `com.twoaccmess.hub`; versionCode 9, versionName `2.0-bop`.
The debug row is the October 8 layout+realtime build: no file under `app/src/main` is newer than it, and
the JVM run behind the 105 results finished after the last test source was written (only a string
resource changed after that run, and the test task correctly reported no new work for it). The release row is
unchanged from the screen-fit round (R8/resource-shrunk and **unsigned**, not rebuilt in this round); the
earlier 2.0 and every-phone hashes belong to their own rounds above.
The release is R8/resource-shrunk and **unsigned** (no signing configuration in this checkout).
Release manifest inspected with aapt2: all sixteen legacy processes, DynamicWebActivity, the
notification listener, overlay service and alert receiver remain. Display name and launcher resources
are Bop; IDs deliberately retain upgrade compatibility.

## Passing checks

- **87 JVM tests**, zero failures/errors/skips. Includes 200 dynamic spaces, 10,000 identifier
  round-trips, unique storage/channel/avatar/report identities, no stale alert reuse after space
  removal/recreation, renaming without binding loss, acknowledgement retention across refresh,
  flush-edge docking and independent horizontal/vertical clamp margins. [HubReliabilityTest] pins the
  every-phone rules: one broken input cannot hide, losing notification access fails both the access
  and the connection check, a granted-but-disconnected listener reports the rebind case, an unknown
  browser-engine answer is never drawn as a failure, and every brand with advice has real steps.
- **8 device tests on Android 17/API 37 emulator**, zero failures/errors/skips:
  more than sixteen spaces with app index persistence; appearance UI and cross-process mirror;
  notification-filter platform constants; channel/legacy process/picture-picker checks; unbound web
  entry points; rename/search/Guide through actual Compose UI; synthetic account-specific alerts and
  encrypted settings; real WebView profile cookie separation and profile-specific deletion.
-  Debug/release build, JVM tests and lint for this round: `.freebuff/bop-everydev-final.log`,
  `BUILD SUCCESSFUL`. Device tests: `.freebuff/bop-everydev-connected.log`, `BUILD SUCCESSFUL`,
  8 tests in `TEST-BopTest(AVD) - 17.xml` with `failures="0" errors="0" skipped="0"`.
  The earlier 2.0 runs remain in `.freebuff/bop-device-verify2.log` and `.freebuff/bop-release-final.log`.
- Release manifest inspected with aapt2 keeps `HubBootReceiver`, `RECEIVE_BOOT_COMPLETED` and
  `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` alongside every previous component, and `HubBootReceiver` is
  still present in the shrunk `classes.dex`. The new advice strings and the Xiaomi auto-start component
  are present in the release dex, so the card is not stripped by R8.
- Lint on this round is still **0 errors / 20 warnings**. The one new warning is
  `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS violates the Play Store Content Policy` (BatteryLife) on the
  exemption dialog; it is left visible rather than suppressed, because the permission is a real
  publication decision — see the note in [README](../README.md). Two `Uri.parse` KTX warnings in the
  touched functions were replaced with `toUri()` rather than added to.
- Lint: **0 errors / 20 warnings** (12 KTX suggestions, 5 dependency update notices, 1 Kotlin version
  notice, 1 API-guarded WebView suggestion, 1 intentional JavaScript enablement). No suppression,
  baseline or skipped test was introduced.
- Source changes were rebuilt after the last repair. Earlier failures are retained in the logs:
  old test assertions expected a 16-space ceiling; old Espresso failed on Android 17; lazy-list tests
  were updated to scroll to uncomposed nodes; text input tests now replace rather than insert at the
  cursor; one overloaded emulator run could not read the API level. Those are not reported as passes.

## Actual interface inspection

The final debug APK was installed and used on a separate temporary AVD on D:, leaving the user's
existing Medium_Phone AVD configuration unchanged. Light and dark dashboard, Guide, permissioned
bubble start, real drag input, menu open and menu Stop were exercised. Screenshots were captured from
Android, not rendered as a mockup:

- [Spaces / light](screenshots/bop-spaces-light.png)
- [Spaces / dark](screenshots/bop-spaces-dark.png)
- [Guide](screenshots/bop-guide.png)
- [Bubble / left](screenshots/bop-bubble-left.png)
- [Bubble / right](screenshots/bop-bubble-right.png)
- [Bubble / menu](screenshots/bop-bubble-menu.png)

Measured overlay on the 1080px-wide emulator: bubble width **126px** (48dp). Left docking layout
`x=0`; right docking actual frame **[954,1096][1080,1222]**: `954 + 126 = 1080`, **zero horizontal gap**.
Opening the menu preserves the bubble frame. Stopping from the menu leaves **0 Bop overlay windows**
in `dumpsys window`, confirming both menu and bubble cleanup. Capturing these screenshots also proves
ordinary capture is allowed for the inspected app and overlay surfaces.

## Every-phone reliability round

Settings now carries a **Runs on every phone** card: six live checks with one repair action each —
Bop notifications, notification access, listener connected, floating windows, battery optimisation and
parallel web sessions — plus manufacturer auto-start/battery steps for nine phone families, and a
boot/update receiver that asks Android to rebind the notification listener. The card was driven on the
emulator, not only asserted in unit tests:

- [Every-phone card, broken phone](screenshots/bop-everyphone.png) — 5 of 6 checks failing on a fresh
  install, each with its own advice line.
- [Every-phone card after repairs](screenshots/bop-everyphone-checks.png) — 2 of 6, with
  `Notification access: Allowed`, `Listener connected: Connected`, `Battery optimisation:
  Unrestricted` and `Parallel web sessions: Supported`. The two that stay red (Bop notifications,
  float over apps) really were still off, so the card does not over-report success.
- Tapping **Fix** on Battery optimisation opened Android's own
  `com.android.settings/.fuelgauge.RequestIgnoreBatteryOptimizations` dialog. After Allow,
  `dumpsys deviceidle whitelist` listed `user,com.example.twoaccmess` and the row became
  `Unrestricted` — the permission path works, not only the label.
- Tapping **Fix** on Notification access opened
  `com.android.settings/.Settings$NotificationAccessSettingsActivity`. After access was granted, a cold
  start showed `● Alerts on` and the card read `Listener connected: Connected`, which is the real
  binding state the watchdog surfaces rather than a mocked value.
- `HubPlatform.deviceLabel` printed the real probe:
  `Google sdk_gphone16k_x86_64 · Android 17 (API 37) · WebView com.google.android.webview 149.0.7827.5`.
- The manufacturer block correctly fell back to the generic steps for an unknown brand (`Your phone`),
  which is the branch any phone family outside the alias list will take.

## Screen-fit round

The web session defaulted to the **desktop** user agent, so the service served its wide layout. Its own
dialogs then placed their close button outside a phone-sized screen and there was no way to dismiss
them — the owner hit exactly this on a Facebook support prompt opened from the bubble, at more than one
screen size, on both builds.

What changed:

- `WebSessionPolicy.DEFAULT_DESKTOP_MODE = false` — a fresh space asks for the **mobile** site, which is
  the layout built to fit an arbitrary width. Desktop mode is still one tap away in Options and is
  still remembered per space, so a panel that needs its desktop form keeps it.
- `textZoom = 100` on the WebView pins web text scaling. This does not prove that every device size,
  system display setting or fixed-width website modal fits.
- New **Fit the page to this screen** action in Options restores WebView viewport/zoom settings and
  loads the current URL again. It does not change a stored desktop-mode preference. The action was
  visible in the emulator but was not tapped or verified against a signed-in modal.
- The controls row deliberately stays at five buttons: a sixth would squeeze the row on exactly the small
  screens this round is about, so the action lives in the Options menu that already holds
  desktop/mobile, clear, copy and about.
- Every space reaches this code — the whole app creates a WebView in one place
  (`MessengerWebActivity.prepare`), including the per-slot activities and `DynamicWebActivity` used by
  spaces beyond A–P.

Evidence: `aFreshSpaceUsesTheMobileSiteBecauseThatIsTheLayoutThatFits` pins the default in
`WebSessionPolicyTest` (8 tests in that class, all passing), `desktopAgent` still strips the `Mobile`,
`wv` and `Version/` markers so the opt-in path is unchanged, and the debug and release APKs above were
both rebuilt after the last source change with no source file newer than them.

On a device, not only in unit tests: the debug APK was installed on the API 37 emulator
(1080×2400 @ 420dpi) and driven through the real UI.

- [Web session](screenshots/bop-fit-mobile-web.png) — the address line reads `https://m.facebook.com`.
  The app really asked for, and was served, the mobile site.
- [Options menu](screenshots/bop-fit-options.png) — the new **Fit the page to this screen** item is
  there, and the item beside it reads *Use desktop website*, which is what shows `desktop` is `false` at
  runtime on a clean install rather than only in the model.
- The same build re-ran the **8 device tests** on the emulator before that manual pass — 8 tests, 0
  failures, 0 errors, 0 skips, results written at 19:49 (`app/build/outputs/androidTest-results`).

Honest limits for this round: this is an emulator, not the owner's phone, and the page reached is
Facebook's own sign-in screen — no account was signed in and no dialog was measured. Whether Facebook's
support prompt now fits on the owner's device is therefore still unverified. The tests prove the
fresh-space mobile default, not that every screen size fits. Existing stored `desktop=true` choices
remain true. A page can still overflow; the earlier all-screen fit wording was too strong.

## Real-device report (owner-reported, not measured here)

The project owner runs a matching build personally on a **Galaxy S21 Ultra 5G** and reports that
parallel logins and notifications behave well there (October 2026). This is a user report, not a
measurement: this workspace captured no log, screenshot, timing or battery figure from that phone, so
it is not evidence about other devices. All OEM items below remain unverified here.

## Remaining acceptance, not claimed

- Live third-party sign-in, encrypted-history recovery, actual old-install login preservation,
  attachment upload to a real service and real notification delivery on OEM phones (the owner report
  above is the only OEM evidence, and it is not a measurement).
- The manufacturer deep links are best effort: only the generic fallback and the emulator's own
  settings screens were exercised. No Xiaomi/OPPO/vivo/Huawei/Samsung/OnePlus/ASUS/Motorola/Transsion
  auto-start component was opened on real hardware, and the non-Samsung component names are the usual
  candidates rather than confirmed working ones.
- `HubBootReceiver` was compiled, kept by R8 and verified in the release manifest, but a real reboot or
  in-place update was not performed on a phone, so the rebind was not observed happening.
- RTL drag and rotation are repaired mathematically/source-level, but not exercised on an RTL device.
- Android 7–8 native-only mode and an engine without multi-profile support were not device-tested.
- Screenshot capture of an actually signed-in third-party web page was not tested.
- Storage/provider limits mean no literal infinite capacity; the 16-space application ceiling is gone.
- No speed/battery improvement claim or benchmark is made. No guarantee that all bugs or all service
  compatibility issues have been eliminated. Store publication still needs signing, policy review,
  screenshots and real-phone acceptance.

## Branding exports

[Icon](../assets/bop-icon.png): 1024×1024 RGBA PNG. [Avatar](../assets/bop-avatar.png): 512×512 RGBA PNG.
The app includes vector adaptive/themed icons and matching legacy WebP launchers at every density.
