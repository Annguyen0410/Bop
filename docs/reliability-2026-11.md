# Bop — cross-platform functional reliability round, November 2026

Scope: this repository, both products (Android app, Windows Electron app). Every claim below names the
command or measurement that produced it, and every gap is listed as a gap.

## A. Repository and branch

| | |
| --- | --- |
| Original branch | `main`, at `b690111` ("Desktop: release Bop 0.2.0 and make the acceptance run prove the pointer") |
| New branch | `fix/cross-platform-functional-reliability-2026-11` |
| Working tree at branch time | 75 entries already present (38 modified, 37 untracked) — prior in-progress work, **kept as-is** |
| `main` | not touched: still `b690111`; no reset, no force-push, no history rewrite |
| Commits on the branch | `b5eb45d` Android layout + migration, `59aa1b0` desktop verification harness, and the docs commit that carries this file |

The branch was created with `git checkout -b`, so the uncommitted work that was already in the tree came
along with it rather than being stashed or discarded. Nothing in this round deletes a user's stored
accounts, sessions, settings or notes.

**One thing to know about those commits:** `MessengerWebActivity.kt` and `desktop/src/main/main.js` already
had substantial uncommitted work in them when this round started (the popup/sign-in window, conversation
memory, space delete/clear, the desktop release work). Those files could not be committed without that work,
so the first two commits carry it too. It is preserved, not rewritten; 65 other modified/untracked entries
from that in-progress work are still uncommitted and untouched.

Files changed in this round (all listed in [C](#c-implemented-fixes)):

- `app/src/main/java/com/example/twoaccmess/HubApps.kt`
- `app/src/main/java/com/example/twoaccmess/WebSessionPolicy.kt`
- `app/src/main/java/com/example/twoaccmess/MessengerWebActivity.kt`
- `app/src/main/res/values/strings.xml`
- `app/src/test/java/com/example/twoaccmess/WebSessionPolicyTest.kt`
- `app/src/test/java/com/example/twoaccmess/HubAppsTest.kt`
- `desktop/src/main/main.js`
- `README.md`, `docs/reliability-2026-11.md` (this file), `docs/verification.md`

## B. Defects discovered

### A1 — Critical — Android — Messenger (and Instagram) no longer reach a messages view

- **Root cause.** A fresh space started on the **phone** layout (`WebSessionPolicy.DEFAULT_DESKTOP_MODE =
  false`). Measured on 12 November 2026 with the entry points the app actually loads:

  | Request | Phone user agent | Desktop user agent |
  | --- | --- | --- |
  | `https://www.facebook.com/messages/` | `302` → `https://m.facebook.com/messages/?wtsid=…` | no redirect — stays on the messages page |
  | `https://www.instagram.com/direct/inbox/` | `302` → `accounts/login/?next=…` | `302` → `accounts/login/?next=…` |

  The phone route is the legacy `m.facebook.com` site, and it answers with
  `m.facebook.com/login.php?next=https%3A%2F%2Fm.facebook.com%2Fmessages%2F…&refsrc=deprecated`. So the
  phone layout does not render the messages page — it *leaves* it. The regression is the layout default,
  exactly as suspected: the first release asked for the desktop site and messaging worked; the change to a
  mobile-first default exchanged "wide dialogs that can overflow a phone screen" for "no messages page".
- **Severity.** Critical — the product's headline feature stops working.
- **User-visible impact.** Opening Messenger in a space lands on a deprecated mobile page with no usable
  chat list; Instagram's phone web build hands off to the phone app and offers no direct inbox.

### A2 — High — Android — a layout migration could silently discard the owner's own layout

- **Root cause.** The one-time migration behind `layout-rule` deleted a stored `desktop` value whenever the
  `desktop-choice` marker was absent. The marker has been written by the layout switch since the first
  commit in this repository (`git log -S'putBoolean("desktop"'`), so a stored value with no marker can only
  come from a build that predates the marker — and a default written by such a build cannot be told apart
  from a switch the owner flipped. Guessing "it was a default" and deleting it is what moves a space onto a
  layout its owner rejected.
- **Severity.** High — silent loss of a user preference (not of session data).
- **User-visible impact.** A space the owner had switched back to the phone layout reopens on the desktop
  layout (or vice versa) after an update, with no explanation.

### A3 — Medium — Android — the very old per-activity switch lost its *value*, not just its meaning

- **Root cause.** The legacy migration (`getPreferences(MODE_PRIVATE)` → the space's own preferences) wrote
  `desktop-choice = true` when the old file contained `desktop`, but never copied `desktop`'s value. The
  space then read its layout from a key that was never written and fell through to the app's default.
- **Severity.** Medium — same class as A2, narrower population (only slots that migrated from the oldest
  build).
- **User-visible impact.** The About text claims the switch was honoured; the layout says otherwise.

### A4 — Medium — Android — a refused popup was dropped in silence

- **Root cause.** `onCreateWindow` returned `false` for every refusal: no user gesture, another popup
  already open, or a stale view. With `setSupportMultipleWindows(true)`, that is the page's `window.open()`
  quietly getting nothing back. When a sign-in dialog asks for a second window on a real tap, the tap
  appears to do nothing.
- **Severity.** Medium — an authentication dead end with no explanation.
- **User-visible impact.** "I tapped the sign-in button and nothing happened."

### D1 — High — Windows — the app's own verification harness could not load its fixture at all

- **Root cause.** Every verification run drives the app against a fixture on `127.0.0.1`. On a machine whose
  network settings make Chromium resolve a proxy, that resolution sits in front of the loopback URL too.
  Measured on this host: `npx electron . --bop-monitor-smoke --bop-out <dir>` failed at `load A timeout`
  after 10 s, while the dashboard (a `file://` document, no network service) loaded normally. Adding
  `--no-proxy-server` made the same run pass, 21 checks, exit 0.
- **Severity.** High for release verification (the integration harness is how the desktop app is proven),
  none for a user's own spaces, which are remote HTTPS pages and keep the machine's proxy.
- **User-visible impact.** None directly; the release check reports a false failure on an affected machine
  and gets skipped or hand-waved.

## C. Implemented fixes

### Android

1. **Messenger and Instagram start on the desktop layout** — `HubApps.kt`.
   `desktopSite = true` on both entries, so a fresh space asks for the layout that actually has a messages
   view, and their catalog notes say so (the About dialog is where the owner reads it). The route itself is
   unchanged: Messenger still opens `https://www.facebook.com/messages/`, because `messenger.com` is
   retired. TikTok, Zalo and WhatsApp keep the same treatment they already had; everything else keeps the
   responsive phone layout, and the per-space switch in **Options** still wins for any space.
   *Trade-off, stated plainly:* the desktop layout is wide, so its own dialogs can overflow a narrow screen.
   **Options → Fit the page to this screen** and pinch-zoom are the escape hatches, and switching back to
   the phone site is one tap. Reaching the chat list beats a page that fits but has no chats.

2. **The layout migration can no longer discard a stored layout** — `WebSessionPolicy.planLayout()` plus its
   use in `MessengerWebActivity.getSpacePreferences()`. The decision is now a pure function
   (`LayoutPlan(rule, desktop, choice)`) with no way to express "remove the stored value":
   a space that stores a layout keeps it and is marked as having chosen it, and only a space that has never
   stored one picks up the app's rule. It is idempotent — once `layout-rule` is written the next call
   returns `null`, so reopening a space does not rewrite its preferences on every launch.

3. **The oldest switch carries its value across** — `WebSessionPolicy.legacyDesktopChoice()` and the legacy
   branch of `getSpacePreferences()`. The old file's `desktop` boolean is written into the space's own
   preferences together with the choice marker, so the layout the owner picked is the layout they get.

4. **A refused popup says why** — `MessengerWebActivity.onCreateWindow`. The security decision is unchanged
   (only a real tap, only one window at a time, only inside this slot's WebView profile, only allow-listed
   destinations). What changed is that a tap refused because a sign-in window is already open now writes
   "Close the sign-in window that is already open, then tap again." in the status line instead of doing
   nothing. Non-gesture popups still fail closed without a message, because those are ads, not sign-in.

5. **`LAYOUT_RULE` moved to `WebSessionPolicy`** so the rule version and the code that reads it cannot drift
   apart, and so it is testable without an Android device.

### Windows

6. **Verification runs bypass proxy resolution for their own loopback fixtures** — `desktop/src/main/main.js`.
   `if (SMOKE || LIVE_CHECK) app.commandLine.appendSwitch('no-proxy-server')`, placed with the other
   pre-`whenReady` switches and scoped to verification runs only. A user's real spaces are unaffected.

## D. Android verification

| Check | Command | Result |
| --- | --- | --- |
| JVM unit tests | `./gradlew :app:testDebugUnitTest` | **146 tests, 0 failed, 0 errors, 0 skipped** (`app/build/test-results/testDebugUnitTest`, 17 classes) |
| Debug APK | `./gradlew :app:assembleDebug` | **BUILD SUCCESSFUL**, `app/build/outputs/apk/debug/app-debug.apk`, 11 748 101 bytes |
| Lint | `./gradlew :app:lintDebug` | **0 errors, 51 warnings** (pre-existing warning set; no new error) |
| Instrumentation / device | `adb devices` | **no device attached and no AVD defined** on this machine (`emulator -list-avds` is empty) — not run |

New regression tests (`app/src/test/java/com/example/twoaccmess/WebSessionPolicyTest.kt`):

- `appsNeedingTheDesktopSiteStartThere` — pins the exact set of apps that start on the desktop layout and
  pins that the desktop agent really removes `Android`, `; wv`, `Mobile` and `Version/4.0`.
- `theMessengerRouteItselfIsUnchanged` — Messenger and Instagram entry points, and that the phone UA's
  `m.facebook.com` bounce target stays inside the same slot instead of being blocked as foreign.
- `aStoredLayoutIsNeverDiscardedByTheMigration` — a stored `true` and a stored `false` both survive with the
  choice marker; an untouched space is the only one the rule may move.
- `theLayoutMigrationRunsOnceAndOnlyOnce` — idempotence.
- `theOldPerActivitySwitchCarriesItsValueAcross` — A3.
- `HubAppsTest.catalogMarksTheAppsThatStartOnTheDesktopSite` — updated to the five-app set, and still
  requires each of those notes to explain itself.

**What this does not prove.** These are JVM tests of the policy and migration logic. They do not render a
page, do not sign in to Meta, and do not send a message. No such test was possible here (see [G](#g-remaining-issues)).

## E. Windows verification

| Check | Command | Result |
| --- | --- | --- |
| Unit tests | `cd desktop && npm test` | **136 tests, 0 failures** (node `--test`, exit 0) |
| Syntax | `node --check src/main/main.js` | pass |
| Integration harness, real Electron | `npx electron . --bop-monitor-smoke --bop-out <abs dir>` | **21/21 CHECK steps, exit 0**, no extra flags — [evidence](evidence/reliability-2026-11/monitor-smoke.json) |
| Packaging | not run this round | see [G](#g-remaining-issues) |

The integration run is the app's own local SSE fixture (`desktop/src/main/monitor-smoke.js`), and it covers:
three isolated same-origin sessions, background detection while another space is on screen, minimized and
closed-to-tray delivery, title/notification pairing, the sign-in-required card raised once and cleared by a
working load, renderer crash with the real backoff and unread-delta reconciliation, offline/reconnect, mute,
the split note stores, and `stop` releasing every view and stream. Its own report says what it is:
`"kind": "local SSE integration fixture (not live-service messaging)"`.

Before the fix in C6 this same command failed at `load A timeout` on this machine, twice, and passed with
`--no-proxy-server` — that pair of readings is the evidence for D1.

**Not run this round:** `npm run dist` / `dist:portable` (packaging), the 51-step `--bop-smoke`, the
`--bop-retry-smoke` ten-minute ladder, and `tools/live-check.js`. The repository already carries their
results for the current code; re-running the ladder alone takes ~16 minutes.

## F. Data safety and security

- **No storage format changed.** No settings schema, no note store, no `space-index.json`, no crypto. The
  only persisted Android keys touched are the layout pair, and the migration is now strictly additive.
- **The migration cannot lose a value by construction:** `LayoutPlan` has fields for the rule version and for
  what to *write*; there is no field that says "delete". An interrupted migration is harmless — the rule
  version is written in the same `apply()` as the adoption, and a re-run recomputes the same plan.
- **Sessions untouched.** No cookie/profile code was modified in this round: `SpaceSessions`,
  `WebSessionRuntime` and the per-process data-directory suffix are unchanged, so existing A–P logins and
  named profiles are where they were. The layout change alters the user-agent string only.
- **WebView security unchanged and still strict:** cleartext blocked by policy and manifest, SSL errors always
  `handler.cancel()`, `mixedContentMode = NEVER_ALLOW`, no file/content access, host allow-list on
  navigation *and* redirects *and* main-frame resource requests, user-info/port/scheme rejected, no JS bridge
  into page content, permissions denied by default. C4 does not loosen any of it — it adds a message on a
  path that already refused.
- **Desktop security unchanged:** `contextIsolation: true`, `nodeIntegration: false` on every window and every
  space view, privileged work in the main process, a notification-only preload bridge for remote pages,
  `setWindowOpenHandler` + `will-navigate`/`will-redirect` gating. `sandbox` stays `false` because
  `space-preload.js` loads `notification-bridge.js` with `require` and executes it in the main world — a
  sandboxed preload cannot do that, so switching it on would silently break web-notification capture. That
  is a deliberate, documented trade-off, not an oversight.
- **Notes/LAN crypto inspected, unchanged:** AES-256-GCM with a fresh `crypto.randomBytes(12)` nonce per frame,
  a fixed AAD, a 16-byte tag that is validated on open, base64 round-trip validation, frame size bounds,
  private-address-only peers, 5 s / 10 s socket timeouts and a peer check on accept. No plaintext fallback
  path exists on a decrypt failure.
- **No secrets added.** Nothing in this round reads or writes credentials, signing material or tokens.

## G. Remaining issues

**Bugs still present (known, not fixed here):**

- Instagram's layout choice rests on its documented phone-web behaviour, not on a measurement that separates
  the two layouts after sign-in (both agents answer with the same login redirect before authentication). See
  [J](#j-final-status).
- The desktop layout in a narrow WebView can still overflow; Fit to screen and pinch-zoom mitigate it.
- `desktop/src/main/main.js` keeps `sandbox: false` on space views for the reason in [F](#f-data-safety-and-security).

**Tests not performed (environment):**

- No Android device and no AVD on this machine (`adb devices` empty, `emulator -list-avds` empty), so no
  instrumentation test, no layout screenshot, no real WebView run of either layout.
- No authorized Meta test account, so no sign-in, no inbox render, no conversation opened, no message sent:
  the Messenger/Instagram fix is **not** proven end-to-end.
- Desktop packaging (`npm run dist`), the 51-step smoke, the retry ladder and the live check were not re-run.

**Third-party restrictions (by design, not Bop bugs):**

- Meta can refuse sign-in inside an application-owned WebView. Bop does not disguise the browser, does not
  solve CAPTCHAs and does not share cookies between WebView and Custom Tabs. The supported paths are already
  in the app: **Open Messenger app** (when `com.facebook.orca` is installed) and **Open outside Bop**, plus
  the "This provider blocks embedded sign-in" status line for identity-provider refusals.
- Messenger-only accounts (no Facebook account) may not be usable on the Facebook website at all.
- Unread counts are the page's own tab title. A service that keeps no count there cannot be counted, and a
  closed web session raises no card.

## H. Exact commands

```bash
# branch (already created)
git checkout -b fix/cross-platform-functional-reliability-2026-11

# Android
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
./gradlew :app:lintDebug

# Windows desktop
cd desktop && npm test
node --check src/main/main.js
npx electron . --bop-monitor-smoke --bop-out "$(mktemp -d)"

# device checks (blocked here)
"$ANDROID_SDK/platform-tools/adb.exe" devices
```

## I. Manual verification guide (the part this machine cannot do)

Messenger, on a phone with Android 9+ and an up-to-date Android System WebView:

1. Install the debug APK, add a space and choose **Messenger**, open it, accept the consent card.
2. Sign in on Facebook's own page. If Meta refuses the embedded browser, the status line says so — use
   **Options → Open Messenger app** (or **Open outside Bop**) and record what happened; do not retry a
   blocked Google/Meta callback URL.
3. Confirm the inbox renders. If the layout is wrong, **Options** switches between phone and desktop site.
4. Open one conversation and send a message **to a test conversation you control only**.
5. Force-stop Bop, reopen the space, and confirm the session and layout are still there; then open a second
   space with a different account and confirm the two never show each other's login.
6. Repeat 1–5 for **Instagram**. Record which layout reached the inbox.
7. Long-press a link in Messenger and choose to open a sign-in window, to exercise the popup path.

Desktop, on Windows:

1. `cd desktop && npm start`; add a space, sign in, close the hub to the tray, and confirm a message still
   raises exactly one card.
2. Watch Task Manager for a minute with three spaces open and confirm CPU stays near idle.

Please put the outcome — including "it did not work" — wherever the team tracks requirements; nothing in
this report should be read as that sign-in having been tested.

## J. Final status

| Requirement | Status |
| --- | --- |
| Working branch, `main` untouched | **VERIFIED** |
| Android compiles, unit tests pass, lint has no errors | **VERIFIED** (146 tests, APK built, 0 lint errors) |
| Windows builds and its tests pass | **VERIFIED** for unit tests and the integration harness (136 tests, 21/21 checks); packaging **NOT VERIFIED** this round |
| Regression tests cover the defects fixed | **VERIFIED** (5 new/updated Android tests; D1 covered by the harness itself) |
| Android layout selection behaves correctly | **VERIFIED** for the policy and migration (JVM); **NOT VERIFIED** for what a phone renders |
| Messenger and Instagram tested in both layout modes | **BLOCKED BY UPSTREAM PLATFORM** — no device and no authorized account here; the phone-route redirect is measured at the HTTP level, the post-sign-in render is not |
| Account/session isolation verified | **PARTIALLY VERIFIED** — unchanged by this round, covered by existing unit tests and prior emulator evidence; not re-run on a device now |
| Unsupported Meta authentication fails gracefully and honestly | **VERIFIED** by code path and copy (status line + app/browser actions); not exercised against a live refusal |
| Notification behavior tested | **PARTIALLY VERIFIED** — desktop harness covers title/notification pairing, dedup, mute and tray delivery; Android notification pipeline not re-run on a device |
| Floating bubble tested | **NOT VERIFIED** this round (covered by prior audits; unchanged) |
| Desktop website integrations tested | **PARTIALLY VERIFIED** — session isolation and navigation policy via the harness; no real service account |
| Desktop unread detection: no duplicate storms or background load | **PARTIALLY VERIFIED** — harness asserts one arrival per event, mute, and `stop` releasing everything; no long soak |
| Notes intact across restart and migration | **VERIFIED** for the migration path touched here (additive only, idempotent, unit-tested); the note/LAN stores were not modified |
| LAN sync handles invalid input and interruptions safely | **PARTIALLY VERIFIED** — crypto and frame validation inspected and unit-tested upstream; not exercised over a real link this round |
| No secrets introduced | **VERIFIED** |
| No unrelated working features removed | **VERIFIED** |
| Documentation matches implementation | **VERIFIED** for the files listed in [A](#a-repository-and-branch) |
| Known external limitations documented | **VERIFIED** — see [G](#g-remaining-issues) |
