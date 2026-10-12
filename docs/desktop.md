# Bop Desktop

## Current source: 0.1.9 — release check, English only, one build left (October 10, 2026)

Asked for: whether the app is ready to release and, if anything needs fixing for that, to fix it; to turn
every Vietnamese string into English; and to delete the older builds, keeping only the newest one.

**Ready as a portable desktop build, with three things this round could not fix:** the artifact is
unsigned (SmartScreen warns on first launch), no real signed-in account has ever been tested here, and
this build has no installer target. Everything else in the release check passed on the delivered file:

| Check | Result | Evidence |
| --- | --- | --- |
| Desktop unit tests | 86 passed, 0 failed | `npm test` |
| Packaged smoke from the portable EXE | 45 steps, `ok: true`, 4 alerts, `missingFiles: []` | [packaged-smoke-019.json](evidence/desktop-portable/packaged-smoke-019.json) |
| Live check on the same EXE | 15/15, 0 failed | [live-check-019.json](evidence/desktop-portable/live-check-019.json) |
| Real-pointer drag on the portable EXE | +220,+130 → +220,+130, **offBy 0** | [release-019.txt](evidence/desktop-portable/release-019.txt) |
| Android APK language check | no Vietnamese and no locale configuration in either APK | [release-019.txt](evidence/desktop-portable/release-019.txt) |

The delivered file is `desktop/dist/Bop-0.1.9-portable.exe` (85 210 117 bytes, sha256
`f16b8f152dcf98a36cfb83c0c5f8b3cb98649289aaf5b39ebe81ec516e44b7f1`), copied to
`C:\Users\nguye\OneDrive\Desktop\Bop-0.1.9-portable.exe` with an identical hash. `desktop/dist` now holds
that one executable and nothing else; every removed build keeps its size and sha256 in the round's
[notes](evidence/desktop-portable/release-019.txt), and the one file that could not be deleted — the user's
running `Desktop\Bop-0.1.8-portable.exe` — is named there too.

**English, measured rather than assumed.** The delivered `app.asar` decodes to English text only: the scan
finds two Vietnamese signature characters, both inside binary PNG blobs. The APK was the artifact that
really did ship Vietnamese — not Bop's own strings, which are English, but the AndroidX libraries' own
translations, 88 merged `values-*` folders with `values-vi` among them, which is what a phone set to
Vietnamese showed. `androidResources { localeFilters += listOf("en") }` drops them: the release APK went
1 467 466 → 1 336 583 bytes and `aapt2 dump configurations` no longer lists a single language.

**Why 0.1.9 and not 0.1.8.** Running the smoke under load found two steps that sampled a state instead of
waiting for it — the reminder card was allowed a fixed 500 ms to create and load its window, and the
dashboard's visibility was read once while the user's own copy of Bop covered it. Both are defects of the
check, not of the app, and both live in the app's own source (`src/main/main.js`, the `--bop-smoke` path),
so the version moved rather than leaving the tree and the artifact disagreeing about what 0.1.8 is. No
user-facing code differs between 0.1.8 and 0.1.9.

## 0.1.8: a bubble you can move, a face you can choose (October 9, 2026)

The packaged artifact for this round was `desktop/dist/Bop-0.1.8-portable.exe`
(85 213 624 bytes, sha256 `3828466165b0c52c1100a1fa4f301f52cb225d4ef26c1a554283c433b9a0298c`), also copied to
`C:\Users\nguye\OneDrive\Desktop\Bop-0.1.8-portable.exe` with an identical hash. **That build has since
been superseded by 0.1.9 and deleted** — see the section at the top of this file — and only the copy on the
Desktop remains, held open by the instance the user had running. It was tested as
packaged: 86 unit tests, a 45-step smoke run *from the portable EXE* (which is where the
`missingFiles: []` above comes from), and a 15-step live check on the same file, 0 failed. The
before/after measurements and the screenshots are in
[evidence/desktop-portable/ui-018.txt](evidence/desktop-portable/ui-018.txt); everything below it is
historical.

### What was wrong, and how it was found

Four requests. All four were measurable, and the first one measured differently from the report: the
drag *did* work — for a hand that happened to land on a 13px ring.

1. **"The bubble cannot be moved freely at all."** Half of that was the surface: Chromium's
   `-webkit-app-region: drag` covered the 60px box while the 38px round button in the middle was
   `no-drag`, so only a ring about 13px wide moved the window, and a press that looks like a grab landed
   on the button and opened the menu — exactly what the user's own screenshot shows. The other half was
   accuracy: with the machine's own pointer (`tools/drag-check.js`, which presses and drags for real
   because the window is moved by the operating system and a synthetic event cannot prove anything), a
   260×150 drag moved the bubble **227×131 — 33 points short** of the hand.
2. **"Settings and the Guide do nothing while a space is open."** The nav click did work, but the pane
   covers the main view (`.space-open .main { visibility: hidden }`), so the section changed *behind* it
   and the only way to see it was the ✕.
3. **"Make the bubble's icon nicer and let me use my own picture."** The face was a flat disc with a text
   smile and a fixed white button; there was no picture setting at all.
4. **"In full screen the spaces huddle up — let them expand."** `repeat(auto-fill, minmax(210px, 1fr))`
   reserves the tracks nothing lands in, so at 1568px wide the three cards stayed ~210px in the first
   three of nine columns and the rest of the window was empty.

### The fixes

- **The gesture is Bop's own now.** The bubble reports the pointer (`pointerdown/move/up` with
  `screenX/screenY` and pointer capture, so a drag that leaves the 64px window keeps reporting), and
  `src/main/bubble-drag.js` — pure, unit-tested — decides the geometry: the press point is the grab point,
  so the bubble cannot jump under the cursor; sub-point movement does not re-place the window; fewer than
  4 points travelled is still a click. Main places the window directly, one point per point.
- **A section click leaves the space instead of hiding behind it.** The space keeps running in the
  background pane with its session, its page and its monitor; only the ✕ was removed from the critical
  path, not the ✕ itself.
- **The face.** A vector smile in a soft-shaded sphere, in `bubble.css` — a linked file, not an inline
  `<style>`, because `bubble.html`'s own policy is `style-src 'self'` and would drop an inline block
  (which is what had already happened to the space menu). Settings → Floating bubble → Bubble picture
  takes any picture: cropped to the largest centred square, kept at most 256px, retried at 128px if the
  data URL would not fit Bop's settings file, stored *as* a data URL so moving the original cannot break
  it. SVG is kept as SVG. `avatar.js` holds the rules; the two size bounds (`avatar.js` and `spaces.js`)
  are asserted equal, because a picture that can be stored but not read back would silently vanish.
- **`auto-fit` instead of `auto-fill`** for the space cards and the new-space app grid, so the cards take
  the width the window gives them.
- `workAreaFor` read a work area using work-area-relative coordinates, which named the wrong display
  whenever a monitor sat left of the primary one; it now reads the window's own position.

### Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Unit tests | 86 passed, 0 failed | `npm test` |
| Source smoke | ok, 45 steps | [source-smoke-018.json](evidence/desktop-portable/source-smoke-018.json) |
| Packaged smoke (the portable EXE itself) | ok, 45 steps, `packaged:true`, `missingFiles:[]` | [packaged-smoke-018.json](evidence/desktop-portable/packaged-smoke-018.json) |
| Live check on the portable EXE | 15/15, 0 failed | [live-check-018.json](evidence/desktop-portable/live-check-018.json) |
| Real-pointer drag on the portable EXE | 38,361 → 258,491 for +220,+130, offBy 0, size kept | step `bubble-drag-pointer` in the same report |
| Sections switch with a space open | pane x 320 → −20000, page settings, pane still rendering | step `nav-switch-while-open` (source and EXE) |
| The spaces grid fills a wide window | 296px cards in a 605px grid → 733px in a 1480px grid | step `spaces-grid-grows` |
| The bubble's face and picture | screenshots | [bubble-face-drawn-018.png](evidence/desktop-portable/bubble-face-drawn-018.png), [bubble-picture-018.png](evidence/desktop-portable/bubble-picture-018.png), [settings-avatar-018.png](evidence/desktop-portable/settings-avatar-018.png), [dashboard-wide-018.png](evidence/desktop-portable/dashboard-wide-018.png) |

### What this release does not prove

No account was signed in anywhere, so a logged-in panel or messenger session is still unverified. The
drag was verified with a mouse on a 100%-scaled 1920×1080 display — touch, pen and a scaled display are
unmeasured, and so is multi-monitor dragging (no second display was attached). The operating system's
picture picker was not automated; everything after it was. The artifact is unsigned, so SmartScreen warns
on first launch.

## 0.1.7: text that follows the theme, a bubble you can park (October 9, 2026)

The packaged artifact for that round is `desktop/dist/Bop-0.1.7-portable.exe`
(85 202 841 bytes, sha256 `5c1f8877a0526cda7c5255fa1c1570b95a10d5cac1b461128720c1b06fb0f2b7`), verified as packaged
in [evidence/desktop-portable/ui-017.txt](evidence/desktop-portable/ui-017.txt) — which also carries the
before/after measurements and the screenshots. The release notes below it are historical.

### What was wrong, and how it was found

Four requests, three of them measurable defects:

1. **Text did not follow the theme.** Measured with a contrast walk of every window that holds text
   (`tools/contrast.js`, run through the app's own DevTools port): in dark theme the app names in the
   "A new little space" dialog were `rgb(0, 0, 0)` on a `#262235` tile — **1.36:1**, six elements at once.
   A `button` does not inherit `color` and nothing set it on `.app-choice`. `color-scheme` also computed to
   `normal` in dark theme, so scrollbars and carets stayed light, and with the app set to "System colours"
   a Windows light/dark switch never reached an open window at all.
2. **The bubble could not be parked.** Releasing a drag snapped it flush to the nearest side edge.
3. **Notifications repeated themselves.** A site re-raising the same notification, or a watched line that
   re-reads to the same text, dinged the desktop again — the "app spams me" report.
4. **The bubble's panel was ugly and clipped.** Two causes: `menu.html` kept its rules in an inline
   `<style>` block that its own CSP (`style-src 'self'`) blocks — `document.styleSheets` held only
   `styles.css`, so the panel had no layout at all — and the panel was anchored to the bubble, which in a
   corner clamped it against that edge and cut its first word off.

### The fixes

- `button { color: inherit }` (and `.app-choice { color: var(--text) }`, the element that was actually
  wrong); `color-scheme: light` on `:root` with `dark` under `[data-theme='dark']`; and one
  `nativeTheme.on('updated')` re-broadcast so the OS switch reaches every open window.
- `docking.free` replaces the flush docking: the drop position is kept on both axes and only the screen
  edge corrects it, with `settleBubble` handing the frame back if Windows Aero-snapped the window.
- `src/main/notify-log.js`: only the most recent notification per space is remembered (space, kind, title,
  body), so identical words are silent while anything new — or the same words after a different event —
  still notifies. Not persisted; the Alerts list always records the alert.
- The menu's rules moved to `src/renderer/menu.css`, and `docking.centered` puts the panel in the middle of
  the display in a rounded, shadowed card with a header, a scrolling list and a footer.

### Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Unit tests | 74 passed, 0 failed | `npm test` |
| Source smoke | ok, 37 steps | [source-smoke-017.json](evidence/desktop-portable/source-smoke-017.json) |
| Packaged smoke (shipped asar) | ok, 37 steps, 4 alerts | [packaged-smoke-017.json](evidence/desktop-portable/packaged-smoke-017.json) |
| Live check on the portable EXE | 13/13, 0 failed | [live-check-017.json](evidence/desktop-portable/live-check-017.json) |
| Contrast audit, six surfaces, both themes | 0 elements below 4.5:1 | [ui-017.txt](evidence/desktop-portable/ui-017.txt) |
| The new menu and the fixed dialog, both themes | screenshots | [menu-dark-017.png](evidence/desktop-portable/menu-dark-017.png), [menu-light-017.png](evidence/desktop-portable/menu-light-017.png), [modal-dark-017.png](evidence/desktop-portable/modal-dark-017.png) |

### What this release does not prove

No real account was signed in anywhere, so a logged-in panel or messenger session is still unverified; the
free bubble placement was verified by moving the real window and by the drag maths, not by automating a
human mouse drag; the OS light/dark switch was driven through Electron's `nativeTheme` event rather than by
flipping this machine's Windows theme; and the artifacts are unsigned, so SmartScreen warns on first launch.

## 0.1.6: the panel sites answer again (October 9, 2026)

That artifact was `desktop/dist/Bop-0.1.6-portable.exe`
(85 196 781 bytes, sha256 `01d6782b6cae9e8bac99c4cc6ed6250eb37c4f5563907b346b64139473d115d5`), verified as
packaged in [evidence/desktop-portable/build-smoke-live-016.txt](evidence/desktop-portable/build-smoke-live-016.txt).

### What was broken, and how it was found

The report was: *"the desktop build is so buggy, now it cannot even load"* — from the packaged 0.1.5 the
user was running. Their app was up with four spaces loaded and every one of them answered on its own port,
the machine had network, and the window was on screen. Nothing about the app was hung, which is the clue:
the pane held a page the site had chosen to serve, and it was not the page the user wanted.

Opening the same panel in a copy of their profile and reading the page the pane really held:

```
https://app.usercrowd.com/unsupported_browser
Sorry, you can't use UserCrowd on this version of Electron
```

`navigator.userAgent` in that pane was the Electron default — `...Electron/38.8.6 Bop/0.1.5...` — and the
site keys on exactly that token. Asking the same engine for the same URL as Chrome was served the real
sign-in page (*"Log in to continue · Email address · Password"*). So the whole task-panel feature was
being refused by the sites it exists for, and the app had no way to say so.

### The fixes

- **No space is ever served with an agent that names the app.** `spaces.userAgentFor` builds one of two
  agents and both describe the engine truthfully: an Android Chrome agent for the phone layout (the
  default — the layout built to fit a narrow pane) and a Windows/macOS/Linux Chrome agent for the desktop
  layout, each carrying the real Chromium version of the bundled engine. The old agent was
  `app.userAgentFallback`, which Electron composes from the app name and version.
- **A page that refused the browser is named on the space card** (and on its sidebar row) instead of
  leaving an empty pane with no explanation: both halves of the fix are asserted in the smoke run, and the
  agent rule is unit-tested (`a space is never served with an agent that names the app itself`).

### Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Unit tests | 71 passed, 0 failed | `npm test` |
| Source smoke | ok, 33 steps | [source-smoke-016.json](evidence/desktop-portable/source-smoke-016.json) |
| Packaged smoke (shipped asar) | ok, 33 steps, 4 alerts | [packaged-smoke-016.json](evidence/desktop-portable/packaged-smoke-016.json) |
| Live check on the portable EXE | 13/13, 0 failed | [live-check-016.json](evidence/desktop-portable/live-check-016.json) |
| Real panel site, source and packaged, both layouts | served its sign-in page | [panel-016.txt](evidence/desktop-portable/panel-016.txt) |

### What this release does not prove

No real panel or messenger account was signed in through Bop, so a logged-in panel session is still
unverified; a clean Chrome agent is a truthful claim and not a promise that every site accepts it; and the
artifact is unsigned, so SmartScreen warns on the first launch.

## 0.1.5: dialogs you can actually click (October 9, 2026)

That artifact was `desktop/dist/Bop-0.1.5-portable.exe`, verified as packaged in
[evidence/desktop-portable/build-smoke-live-015.txt](evidence/desktop-portable/build-smoke-live-015.txt).

### What was broken, and how it was found

The report was: *"still cannot click New space or add a space, the interface is a mess, and in the
task/earnings panel I cannot even click or reach the web, let alone watch it"* — from the packaged 0.1.4
the user was running. Every smoke step and every live check passed on that build, which is the clue: both
harnesses drove the UI with `element.click()` through DevTools, and the handler was never the problem.

The bug lives a layer below the DOM. The dashboard is one child view of the window and each open space is
another, drawn **above** it. So:

1. **A dialog was under the pane.** The new-space picker, the edit form and the watch form are all drawn
   by the dashboard renderer. With a space open, the pane covered them and received their clicks. On the
   user's own profile this was measurable with a real mouse: the same click at the same coordinates did
   nothing with a space open and switched the picker to *Task / earning panel* with none open. And where
   the pane had never navigated, nothing was painted over the dialog at all — the dialog looked perfect,
   the click went to an invisible page, and there was nothing on screen to explain it.
2. **A `custom` space with no address was a trap.** The user's profile carried one (a leftover from an
   earlier smoke run), so `Open` produced an empty pane across the whole hub that painted nothing and ate
   every click — including the `Edit` dialog that would have fixed it. Nobody could tell what was wrong
   from the window.
3. **A dialog could be taller than the window.** The edit form's `Save` sat at y=1048 in an 820-high
   window, so a real click at its coordinates landed outside the app.

### The fixes

- **The dashboard view is raised while a dialog is open,** and dropped back under the panes when the last
  dialog closes (`applyViewOrder` in `main.js`, driven by `window.bop.setModal` from the renderer).
  The page keeps running underneath; the dialog is clickable, not merely visible.
- **`spaces.openTarget` is the single rule for whether a space has a page to show** (pure, unit-tested).
  `Open` on a space that has none does not create a pane at all: it returns the reason, closes whatever was
  open, and the dashboard opens the `Edit` dialog with the cursor already in the address field. The sidebar
  and the card mark it *needs an address* before it is clicked, the watcher reports the missing address
  instead of "page not loaded", and `Reload page` cannot conjure a pane for a space with nothing to load.
- **Dialogs are a fixed header, a scrolling body and a fixed footer** (`openModal` builds the three parts,
  `styles.css` lays them out), so Save/Cancel stay on screen and never sit on the last field.
- **A smoke run refuses to start unless its profile is isolated** — the leftover fixture space in the
  user's list is the reason that assertion exists.
- Two smoke steps assert the mechanisms: a space with no address opens no pane and says why, and an open
  dialog is the top view and gives the position back when it closes.

### How to check the same thing by hand

`desktop/tools/` gained the small harness this round needed, because a scripted DOM click cannot see any
of it: `click-ui.js` (read an element's client rect over DevTools, then send a real OS click through
`click-window.ps1`), `type-ui.js` (type into the focused control), `capture-window.ps1` (screenshot the
window as Windows composes it), `copy-profile.ps1` (run a copy of a real profile without touching it),
`cdp-eval.js` (evaluate in a live target) and `panel-fixture.js` (a local "task panel" page that reports
whether a click reached it). `npm test`, `npm run smoke` and `npm run smoke:live` remain the checks that
must pass.

### What this round does not prove

The fixes were verified on a copy of the user's profile with a real mouse, not on a real signed-in
Messenger or a real Prolific account; no live service was signed in. The artifact is unsigned, so
SmartScreen warns on first launch.

## Previous: lightweight multi-account monitoring (October 8, 2026)

The monitoring behavior and test matrix are in [monitoring.md](monitoring.md). Packaged 0.1.3 files were
**not rebuilt** in that round and still have their older behavior.

- Open each connected social space once; Bop reuses that existing isolated Chromium profile/view.
  Native title-change events detect growing unread markers even with website notifications disabled.
  Website `window.Notification` is supplementary; title availability is service/page dependent.
- Minimize, Hide/Close to tray and the existing background views preserve loaded sessions. Quit does not.
- Cards show the monitor's lifecycle status and title unread count; a loaded page does not prove login
  or live delivery. Login-path hints are not authentication checks. Stop monitoring releases its view and
  disables its optional task watcher without deleting cookies. Clear session also erases that profile.
- Settings → Message sound controls Bop's native OS notice sound. OS permission/DND/sound policy still
  applies; no WebAudio/beep bypass. Audio playback has not been verified on this host.
- There is no message API/cursor adapter. Aggregate counts cannot identify every distinct message,
  recover histories or update a particular conversation. Cross-source matching is a short-window
  heuristic, not exactly-once delivery. Read the report before relying on it for critical messages.

Bop Desktop is separate from the [Android app](../app). Desktop hosts social accounts and task panels;
Android hosts social web sessions and observes supported installed-app notifications.

## 0.1.4: it starts with the computer, lives in the tray, and its pages stay alive

Requested: test the whole desktop app again, fix what does not work in the app *and* in web-notification
tracking, make the desktop app run as soon as the machine boots, and have the Bop bubble there by default
with an easy way to open and put it away.

**1. Every pane was a throttled background tab — measured, not reasoned.** Driven through the app's own
DevTools protocol on 0.1.3: every space pane *and the dashboard itself* reported
`document.visibilityState === 'hidden'`, and a 100 ms timer fired **10 times in 10 seconds** — Chromium's
background clamp (after five minutes hidden a page is intensively throttled to roughly one timer a
minute). The cause is structural: Electron tells a WebContents that it became visible when the embedder
says so, and a child view of a `BaseWindow` was never told, while `backgroundThrottling` — on by default —
throttled it anyway. What that looked like from a user's chair: a chat page that behaves like a background
tab for the whole session. Chrome freezes such a page, and a site that believes it is hidden hands its
messages to a service worker — **Electron does not implement Web Push** — so the alert never reached Bop
at all: no card, no badge, no list row. Fix: the dashboard and every space run with
`backgroundThrottling: false`, and each view is explicitly told whether it is on screen
(`view.setVisible`) instead of only being moved out of the way. Measured after the fix on the same machine:
**20 ticks in 2 seconds** (full rate) in the open pane *and* in a pane left in the background, with the
open pane reporting `visible` to its site and a pane that was never opened reporting `hidden` — a real
background tab, which is the state a chat page notifies from. The switch is in Settings (`Pages run at full
speed`) because the trade-off is real: a page that believes it is on screen may show its own in-page badge
instead of raising a notification, so the tab title stays the primary source Bop reads.

**2. It starts with the computer.** `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` now carries
`com.bop.desktop` → the user's own copy with `--bop-autostart`. A **portable** build registers the file the
user launched (electron-builder publishes it as `PORTABLE_EXECUTABLE_FILE`), never the temporary directory
it unpacks itself into and deletes on exit, which is what a naive `process.execPath` would have written. An
installed build registers its own `Bop.exe`. A **development run registers nothing** — registering
`electron.exe` out of `node_modules` would launch a bare Electron shell at every sign-in — and Settings
says so instead of pretending. A sign-in launch opens the tray icon and the bubble only, so nothing
appears over what the user is doing; the dashboard is shown anyway if there were no tray and no bubble,
because an app with no way back in is worse than an unwanted window.

**3. The bubble is on by default, and there is exactly one Bop.** `bubble: true` is the default now, and a
settings file written before version 3 — which cannot distinguish "the user stopped the bubble" from
"nobody ever started one", because the old default was off — is switched on exactly once. From version 3
on, the stored value is the user's own choice, both ways. Added to that, `app.requestSingleInstanceLock()`
means a second launch hands its request to the running copy instead of fighting it for the same settings
file and drawing a second bubble on the same desktop — which, with start-at-sign-in on, is what clicking
the app while it is already running would otherwise do.

**4. The tray became the way in and out.** Left-click shows the hub or puts it away; right-click offers
Open, the unread count, `Hide/Show the bubble`, `Hide the dashboard`, `Check watched pages now`, an entry
per space, the `Start Bop when I sign in` switch and Quit. The menu is rebuilt whenever its content
changes — the old one was built once at launch, so its "N new alerts" line and its bubble label went stale
and stayed stale.

**5. A live check, because a smoke run is not a user.** [tools/live-check.js](../desktop/tools/live-check.js)
starts the app the way a person does — no smoke flag, a real `http://127.0.0.1` origin, its own
`--user-data-dir` — and then reads what the app reports through the DevTools protocol: the dashboard over
its own preload IPC, the bubble window's size and position, each space page and its notification bridge,
a page's own `new Notification(...)` becoming an alert **and** Bop's card, an unread tab title, a watched
page that changes in place (raised by the watcher's own timer, no manual trigger), the rendered Alerts
page, the bubble badge, the tray state, and the start-up entry toggled off and on again. It is the check
that found the profile's bubble came up without being asked for, and it runs against both the source tree
and a built EXE (`npm run smoke:live`, `npm run smoke:live:exe`).

**What this release does not prove:** no real Messenger, TikTok, WhatsApp or Telegram account was signed
in, so delivery of a real message is still unverified; service-worker `showNotification` and Web Push
remain invisible to Bop for the platform reason above; the installer target was not rebuilt and not
installed; the artifact is unsigned, so SmartScreen warns on first launch.

## 0.1.3: reminders that are actually seen, and a messages page that exists

Two things stopped every account from reminding the user. Both are fixed, and both were measured before
and after on real sites rather than reasoned about.

**1. Bop now draws its own reminder card.** Windows only shows a toast for an application that has a
Start Menu shortcut carrying its AppUserModelID, and Bop also ships as a **portable** executable that has
none. Measured on the user's machine while the portable build was running: no `Bop.lnk` in either Start
Menu, no `HKCU\...\Notifications\Settings` entry for the app, and `ToastEnabled = 1` — the OS was dropping
every toast, from Bop *and* from the space's own page. Alerts reached the Alerts list, the tray title and
the bubble badge, and nothing appeared on screen; the old code only ever tried a toast for a `watch`
alert anyway. Now every message alert and watched-page change shows a small always-on-top card in the
bottom-right corner: the account and its accent colour, the alert title, the message text, an **Open**
button and the count of any further alerts that arrived while it was up. It never takes focus
(`showInactive`), steps above the bubble when the bubble occupies that corner, and hides itself after 9
seconds. `app.setAppUserModelId('com.bop.desktop')` is set too, so an installed copy is still recognised
as the same application.

**2. A social space now loads the desktop site.** The phone layout was the default for every space. That
is right for a task panel and wrong for a messenger, because the mobile website of these services is not
their messages page. Measured with the phone user agent, on the real sites: `tiktok.com/messages` is
replaced by the For You feed, `web.whatsapp.com` answers with `/mobile/` and the text *"Use WhatsApp Web by
going to web.whatsapp.com from a browser on your computer"*, Snapchat serves `www.snapchat.com/web/mobile-landing.html`,
and `web.skype.com` lands on *Unsupported Browser* for Teams. None of those pages shows a chat or can
raise a message alert. With the desktop layout the same entries reach `/login?redirect_url=.../messages`
(TikTok), the WhatsApp Web app itself, the Snapchat site, and the Teams web app. So `social` spaces start
on the desktop site; `tasks` spaces keep the phone layout. A stored file from 0.1.2 is repaired once on
read (version 2 in `spaces.js`): a social space written with the old phone-layout default moves to the
desktop site, an explicit `false` stays, and Edit switches either way by hand.

The Alerts list, the tray title and the shared bubble keep working exactly as before; the reminder card
is an addition, not a replacement.

**What this release does not prove:** a real Messenger, TikTok or Telegram account was not signed in here,
so delivery of a real message into one of these spaces is still unverified. The reminder card is verified
against a page that raises a real `window.Notification` in a space (see Verification below), not against
those services. A site that never raises an alert, or a service-worker/Web Push alert, still cannot be
shown by the constructor bridge; watching a messages page is the fallback for those.

## 0.1.2: notifications for multiple accounts on the same site

- Every space's live view now uses its own configured Chromium session (`persist:bop-<space>`).
  Previously the notification permission helper was used by smoke tests, but not ordinary space views.
- A notification-only bridge runs in preload **before page scripts**, not after `dom-ready`.
  It preserves native `Notification.permission` and `requestPermission`; it does not pretend permission
  is granted. Only successfully created `window.Notification` objects are mirrored into Alerts.
- Native notification titles include the space letter. Explicit notification tags are namespaced per
  space, so two accounts using the same conversation tag cannot replace one another's OS notification.
  Untagged alerts get distinct in-memory identities.
- Notifications are attributed by the sending WebContents, never a space id supplied by a website.
  Main-frame origin checks limit the bridge to the space's configured hosts.
- A space remains loaded when another one is in front. Closing the dashboard hides it while the tray
  or Bop bubble is available; **Quit** in the tray actually exits. If neither exists, Close exits normally.
- Explicitly opened spaces are remembered and reloaded on the next launch. New, unopened spaces are
  not automatically loaded. Cookies remain in the individual Chromium session.
- The shared bubble now gets live unread updates and an initial snapshot. Its menu also renders the
  initial list immediately; selecting a row opens the correct space.

### How to use

0. A reminder card appears in the bottom-right corner for every new alert; click it to open that account
   and count the alert as read, or × to hide it and leave the alert unread in Alerts.
1. Open each account's space once and sign in separately. A space that was never opened has no session and
   therefore no alerts; its card says *Open once to load this session for notifications*.
2. Enable desktop/browser notifications **inside each website** if that service offers them.
3. To keep loaded sessions active, close Bop to the tray rather than selecting Quit.
4. Start the shared Bop bubble in Settings if you want its pending-alert badge and space picker.

**Not a Messenger delivery guarantee:** the automated checks use two sessions on a local test site,
not two real Messenger accounts. If Messenger's selected mobile layout does not emit notifications,
try its desktop layout in Edit; this is service-dependent and is not a verified workaround here.
Service-worker `showNotification`/Web Push alerts are not captured by this constructor bridge.
OS notification settings, network loss, sleep and the website's own rules can still prevent alerts.

## Android and foreign bubbles: explicit limitations

Android's embedded WebView sessions do **not** implement Messenger Web Push in this build. The Android
listener reads alerts from installed apps, not the two web accounts. Linking one installed Messenger
cannot make it observe the other web account. Android code and APKs were not changed in this release;
the web-account notification request remains unresolved on Android.

The requested feature of dragging another application's actual chat bubble **inside** Bop, while that
foreign bubble continues running, is **not implemented**. Android overlays/system bubbles remain owned
by their source app/system. Electron likewise has no general, supported foreign-bubble embedding API.
The existing Bop bubble switches Bop spaces; it must not be advertised as an external-bubble container.

## Other desktop features

- 19 social catalog entries, 13 task-panel entries, and custom HTTPS sites.
- Separate cookies, storage and cache per space. Same application/OS account, not an OS security boundary.
- Main-frame host allowlist; outside HTTPS links are handed to the system browser.
- Mobile user agent by default, with per-space desktop opt-out. Neither agent names Electron or Bop, and
  the rule exists because a site that is told Electron may refuse to serve anything at all (measured:
  `app.usercrowd.com` answered `unsupported_browser` for the Electron default and its sign-in page for the
  same engine asked as Chrome). This is a layout preference, **not** a guarantee that every site's modal
  fits. The test reads the UA back; it does not measure a Facebook modal.
- Optional watched pages: compare title/body or selected text, first reading quiet, failed reads not
  reported as changes, phrase filters and failure backoff. Opening a watched page can load it; reads
  wait for load completion with a bounded timeout. No reload on every watch tick.
- Bubble sizes 48/56/64/72/80 px, opacity, double-click choices and edge docking. Multi-monitor restore,
  human mouse drag and Windows fullscreen stacking are not comprehensively verified.

## Build

[package.json](../desktop/package.json) defines the scripts. Existing dependencies are Electron 38 and
electron-builder 26; no renderer framework or new dependency was added.

```bash
cd desktop
npm ci
npm test
npm run smoke
npm start
npm run dist
```

On this nearly-full Windows system, output/cache/temp are on D: (Windows-style paths are important):

```bash
ELECTRON_BUILDER_CACHE=D:/bop-dev/electron-builder-cache ELECTRON_CACHE=D:/bop-dev/electron-cache \
TEMP=D:/bop-dev/tmp TMP=D:/bop-dev/tmp MSYS_NO_PATHCONV=1 \
  ./node_modules/.bin/electron-builder --win --x64 -c.directories.output=D:/bop-dev/bop-dist-notify
```

Targets: `Bop-0.1.4-portable.exe` and `Bop-0.1.4-setup.exe`, Windows x64. The installer is per-user.
Neither artifact is code-signed, so Windows SmartScreen warns on first launch — `Get-AuthenticodeSignature`
reports `NotSigned`. No automatic updater is included. Previous Desktop deliverables are retained.

### Portable only, one file

To rebuild just the single self-contained executable and nothing else:

```bash
cd desktop
npm install                                    # first time only
npm test                                       # 69 unit tests
npm run smoke                                  # 30-step smoke against the source
npm run smoke:live                             # 13-step live check, source tree
npx electron-builder --win portable --x64      # -> dist/Bop-0.1.4-portable.exe
npm run smoke:live:exe                         # 13-step live check against that EXE
```

`--win portable` does not build the NSIS installer; that is a separate target. After a rebuild, verify the
artifact itself rather than trusting the build's exit code — a portable launcher returns before its child
exits, so run it with `--bop-smoke` and read the `smoke.json` it writes (default
`%APPDATA%\Bop\smoke\smoke.json`), which is what the recorded 30-step result comes from. Then run
`npm run smoke:live:exe`, which starts the same EXE as a normal app and checks what a user would see. A
rebuild changes the SHA-256, so update the table in [verification.md](verification.md) and
[desktop-release-verification.json](desktop-release-verification.json) in the same pass.

## Verification

**69 unit tests** pass (five of them for the start-at-login decision and the new defaults). Source smoke
passes **30 recorded steps**; the packaged portable EXE passes the same 30 (`ok: true`), and the live check
passes **13 steps** against that EXE (`ok: true`) starting it as a user does. The smoke steps include:

- Separate session objects and cookie isolation.
- Watch baseline/change/filter behavior against rendered fixture pages.
- Notification permission requested through the native API in **two spaces on the same origin**.
- Both accounts notify from startup inline scripts, with the same conversation tag, producing distinct
  native tags (`bop:A:same-thread`, `bop:B:same-thread`) and one Bop alert per account.
- Close hides the dashboard without destroying the sessions. A then receives a second message while
  hidden, replaces only A's tagged card, and leaves B's message intact.
- Opened-space ids and URLs are read back through the actual encrypted settings-file path. This is a
  disk round-trip, not a complete two-process restart/sign-in test.
- Bubble initial badge is 4, becomes 3 after acknowledging A through dashboard IPC; menu initializes
  with B's pending count 1, and clicking B opens B.
- The **reminder card** appears for a real web notification with the account's wording and message text,
sits fully on screen, steps above a bubble parked in the same corner, captures to `reminder.png`,
and opening it opens that account and counts that alert as read.
- UA switching, docking through real window move events, resize/opacity, JSON geometry round-trip,
  rendered settings and clicking a size control.
- `defaults`: a fresh profile starts with the bubble running, `startAtLogin` on and `keepPagesAlive` on,
  and the start-at-login plan is asserted for all three shapes (installed, portable, development) —
  including that a development run returns no entry at all.
- `tray`: the tray icon exists in this build, because a hidden dashboard with no tray has no way back.
- `pane-visibility`: the dashboard reports `visible`, a background pane reports `hidden`, and the same
  pane still measures **12 ticks in 1200 ms** — unthrottled, which is the fix this release is about.
- `open-pane-visible`: the pane the user has just opened reports `visible` to its site.
- `reminder-card` still drives the whole real path, and `settings-ui` asserts the new Startup/Tray card
  actually rendered in the dashboard.

The smoke's navigation check is **model-only**, not a proof of every real navigation event. Bubble
geometry restore is **JSON/model-only**, not a restart test. No real service login, OEM overnight test,
Windows toast click test or installer install/uninstall has been performed.

Release artifact results and hashes are recorded in [verification.md](verification.md).
Older documentation claiming all 0.1.1 installer/unpacked tests ran was inaccurate: only the 0.1.1
portable smoke was evidenced; this document no longer relies on those claims.

## Privacy and lifetime

Remote space pages only get the [notification bridge](../desktop/src/main/space-preload.js), not the
[dashboard control API](../desktop/src/main/preload.js). Notification previews/Alerts are in memory and
are lost on Quit. Settings and opened-space ids are saved with OS encryption when available, with a
visible warning otherwise. Watch reads compare website text and can include messages if you choose a
chat page; they are not a complete inbox or unread-message API. No readings/previews are sent to Bop's
servers. Chromium still contacts the websites normally.

Quitting, sleep, offline periods or a service that suppresses browser notifications can cause missed
alerts; Bop cannot reconstruct them. Background-loaded pages consume memory and network resources.
