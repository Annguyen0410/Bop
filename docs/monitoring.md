# Bop: lightweight monitoring source upgrade

October 8, 2026. **Source changes, not a rebuilt/released APK or EXE.** Existing packaged artifacts are
older and do not contain this upgrade. No dependencies, cloud backend, database, wake lock, dedicated
monitor thread per account or Android foreground service were added.

## What changed

### Desktop

- Reuses one existing `WebContentsView` and `persist:bop-<id>` profile per loaded account. Existing
  cookies/local storage stay in place; same-service accounts never swap cookie jars. No duplicate
  background window/view was introduced. Chromium still uses renderer processes for separate profiles.
- Native `page-title-updated` plus a post-load `getTitle()` baseline supply independent unread signals.
  No injected title script, page scan, polling request or periodic page reload. Websites maintain their
  own live connection; Bop does not intercept sockets, cookies or private application internals.
- The website Notification bridge remains supplementary. Each constructor event has a document-scoped
  event ID, distinct from its conversation/replacement tag. The native source notification is silent;
  Bop requests its own OS notification/sound. Native denial remains native: no fake permission grant.
- Per-account monitor state is a small JS object: unread baseline, lifecycle status, bounded 128-entry
  event-ID cache and short correlation credits. Titles/previews/event IDs are not persisted. Only the
  aggregate unread metadata is saved with existing encrypted settings, with writes coalesced for bursts.
- First loaded unread is a silent baseline; repeated/decreased counts are quiet. Normal navigation and
  restart rebaseline to avoid old-message alerts. A retry after a known renderer/load failure preserves
  the in-process baseline so an exposed increase can be reconciled on reload.
- Cross-source deduplication pairs title delta credits and website notification events within 1 second,
  in either order. Identical explicit event IDs are ignored. This is **heuristic matching**, not original
  message-ID deduplication: close unrelated events may pair incorrectly; delayed duplicate sources may
  alert again. A burst title delta causes **one aggregate OS notice**, not N reconstructed messages.
- Close-to-tray/minimize leaves views alive. Quit stops everything. **Stop monitoring** closes the view,
  removes runtime state/retries, disables its task watcher and stops restoring it, while retaining
  session cookies. Clear session closes it first and erases storage/cache. Service/custom URL replacement
  tears down the old view/state. Removed spaces release resources; base slots remain available.
- Crash/load failures retry at 30, 60, 120, 240, 480 seconds, then stop automatic attempts after the next
  failure. Open can retry again. No reload loop for a functioning SPA or a recognized login route.
- Background throttling is enabled rather than disabled for all page work. The monitor itself has no
  repeating timer. A one-shot scheduler runs only for opt-in existing task-page watchers, with existing
  failure backoff and no overlapping watcher runs; it is not message-level reconciliation.
- Small existing UI additions: lifecycle status, title unread value, Stop monitoring and global
  **Message sound** mute. `observing-auth-unknown` explicitly does not assert authenticated/live service
  delivery. `reauthentication-required` is a login-path hint, not verified token/auth status. A silently
  suspended page or stalled provider connection cannot be detected from its title alone.
- OS notification permissions, DND/Focus Assist and OS sound settings govern Bop sound. No shell beep,
  WebAudio or Ringtone bypass. OS show events are not proof that a speaker played a sound. Portable
  Windows apps may lack a working notification identity. Website playback/service-worker sounds are
  outside the constructor bridge and can still duplicate audio.

Implementation: [main.js](../desktop/src/main/main.js),
[message-monitor.js](../desktop/src/main/message-monitor.js),
[notification-bridge.js](../desktop/src/main/notification-bridge.js),
[space-preload.js](../desktop/src/main/space-preload.js),
[spaces.js](../desktop/src/main/spaces.js),
[preload.js](../desktop/src/main/preload.js), [dashboard](../desktop/src/renderer/app.js).

### Android

- Replaces the injected 3-second title script/JavaScript bridge with native
  `WebChromeClient.onReceivedTitle` and a post-load baseline. Only slot, unread count and an incoming
  flag cross the existing private broadcast; no webpage title/message text is persisted.
- Independent watcher state stays with each existing WebView/profile. A–P private processes/data
  directories remain unchanged; Q onward retain AndroidX named profiles. No new off-screen WebViews,
  profile migration, login requirement or monitoring service was introduced.
- Baselines and decreases update aggregate unread silently; duplicate counts do not reopen dismissed
  cards. Growing markers reopen the account's existing card. Installed-app notification listener
  disconnect no longer removes independent web alerts. Account/channel mute, mirror toggle, permission
  and existing lock policy remain in effect. Silent unread updates do not request another sound.
- `onPause` pauses WebView rendering but no longer globally pauses all website timers; `onStop` no
  longer aborts another account's in-flight navigation. Surviving off-screen sessions may emit native
  title callbacks. **This is best-effort, not reliable continuous Android background delivery.**
- Resume reconciles a surviving title baseline once; a destroyed renderer can recreate its WebView on
  user return using the same profile. A destroyed document starts a new baseline, not a history sync.
  No boot-time reload of web accounts, persistent worker, wake lock or battery optimization bypass.- No original message ID exists in these signals. Web alerts use an honest account-level
  `web-session` entry, not a fabricated per-conversation update. Android installed-app events and web
  title signals have no shared message identity; cross-source duplicate suppression between them is
  **not implemented**. No new Android per-account authentication/status dashboard or persistent sync
  cursor was added; existing diagnostics show native-title/best-effort state. Android notification channels may
  coalesce/rate-limit consecutive updates; per-message audible playback is not guaranteed.

Implementation: [WebUnread.kt](../app/src/main/java/com/example/twoaccmess/WebUnread.kt),
[MessengerWebActivity.kt](../app/src/main/java/com/example/twoaccmess/MessengerWebActivity.kt),
[WebAlertReceiver.kt](../app/src/main/java/com/example/twoaccmess/WebAlertReceiver.kt),
[HubState.kt](../app/src/main/java/com/example/twoaccmess/HubState.kt),
[HubRepository.kt](../app/src/main/java/com/example/twoaccmess/HubRepository.kt),
[HubNotifications.kt](../app/src/main/java/com/example/twoaccmess/HubNotifications.kt).

## Mechanism for every existing social integration

These are generic session/title adapters, **not verified provider-specific message integrations**.
For each row, desktop observes native title markers plus successful website `window.Notification`;
Android observes native title markers plus its unchanged installed-app notification listener where
that app is installed and can be mapped unambiguously. Disabled website notifications do not disable
Bop's title observation. No official API credentials or supported sync cursor is configured.

| Service | Independent source used | Extra signal on desktop | Live authenticated message test |
| --- | --- | --- | --- |
| Messenger | Native title unread marker, if exposed | window.Notification | Not run |
| Facebook | Native title unread marker, if exposed; may include non-message alerts | window.Notification; may include feed alerts | Not run |
| Instagram | Native title unread marker, if exposed | window.Notification | Not run |
| WhatsApp | Native title unread marker, if exposed | window.Notification | Not run |
| TikTok | Native title unread marker, if exposed | window.Notification | Not run |
| Telegram | Native title unread marker, if exposed | window.Notification | Not run |
| Zalo | Native title unread marker, if exposed | window.Notification | Not run |
| X | Native title unread marker, if exposed | window.Notification | Not run |
| Threads | Native title unread marker, if exposed | window.Notification | Not run |
| Reddit | Native title unread marker, if exposed | window.Notification | Not run |
| Discord | Native title marker/count, if exposed; dot can only signal a transition | window.Notification | Not run |
| Snapchat | Native title unread marker, if exposed | window.Notification | Not run |
| LinkedIn | Native title unread marker, if exposed; may include network alerts | window.Notification; not necessarily messages | Not run |
| Viber | Native title unread marker, if service still exposes web messaging | window.Notification | Not run |
| Skype | Native title unread marker, if reachable/current service provides it | window.Notification | Not run |
| Google Chat | Native title unread marker, if exposed | window.Notification | Not run |
| VK | Native title unread marker, if exposed | window.Notification | Not run |
| Bluesky | Native title unread marker, if exposed | window.Notification | Not run |
| WeChat | Native title unread marker, if exposed | window.Notification | Not run |

A numeric title marker is capped at 99; `(N)`, leading `N` and dot-style markers are parsed. These are
format heuristics, not guaranteed message counts. An unchanged unread-chat count, dot, 99+ cap, message
read immediately in the selected conversation, loading hydration after baseline or unrelated badge
cannot reliably be classified as a distinct incoming message. No entire-page scan or reload fallback
can fix that without a trustworthy source. Task integrations retain their opt-in title/body/selector
fingerprint checks and are not represented as message detectors.

## Verification and acceptance matrix

- Desktop: **51 Node tests, 0 failures/skips**; all JS main/renderer/test files pass `node --check`.
- Android: **106 JVM tests, 0 failures/errors/skips**, Kotlin compilation included via
  `:app:testDebugUnitTest`. No `assemble`, Electron packaging or installer task was run.
- New source Electron test: **3 separate same-origin local SSE sessions**, not real messaging service
  accounts. [Harness](../desktop/src/main/monitor-smoke.js) drives actual Chromium views, real SSE
  connections, persistent session cookies, native title events, preload/IPC, settings files and OS
  Notification API. [Evidence](evidence/monitoring/monitor-smoke.json).
- Existing desktop regression smoke: **25 recorded steps**, covering task watcher/filter, isolation,
  website notification, tray, bubble layout/settings and reminder. [Evidence](evidence/monitoring/regression-smoke.json).
  Its first run failed because the old 900ms wait assumed hidden website timers were unthrottled.
  Repaired to await the actual event with an 8-second bound; the unchanged delivery assertion passes.
  An initial monitor harness also hung during server teardown; fixed bounded test operations and
  nonblocking fixture cleanup before claiming the successful runs.

| Requested scenario | Actual verification |
| --- | --- |
| Three concurrently connected same-service accounts | 3 isolated local fixture profiles; no live provider logins |
| B/C receive while A selected | Passed in actual Electron with source Notification permission denied |
| Website notification disabled but session delivers | Passed via fixture SSE → native title → Bop |
| Hidden/minimized/close-to-tray | Passed in source Electron fixture; provider suspension untested |
| One sound per distinct message across accounts | Separate OS notice requests passed for separate fixture events; audible sound NOT verified; aggregate title bursts are one notice |
| Duplicate events/sources | Explicit IDs and unchanged markers pass unit checks; local paired title+Notification creates one notice; delayed/unrelated sources remain heuristic |
| Stopped accounts consume no monitor resources | Stop through actual IPC closes all 3 views/SSE streams, clears monitor/retry maps and loaded restoration list |
| Renderer crashes/reconnects | Real Chromium renderer crash; real 30-second retry; fixture latest unread delta reconciled |
| Network interruption/recovery | Actual session offline/online; fixture site's own EventSource reconnects and exposes latest unread |
| Expired account isolation | Local login-route hint tested; real authentication expiry NOT tested |
| App restart | Real encrypted settings roundtrip and loaded-id/unread restore tested; full process restart and live logged-in restore NOT tested |
| Android device/background/audio | NOT tested: adb reports no attached device; host memory insufficient for previous emulator. JVM state tests are not device proof |
| Genuine incoming provider message | NOT tested; no authorized signed-in test account/message-send flow supplied |

## Resource measurements

Final source fixture run:

| State | Summed working set | Summed interval CPU | Loaded account views |
| --- | ---: | ---: | ---: |
| Idle, 3 sessions | 712.63 MiB | 0.016% | 3 |
| Active, 6 spaced events | 712.90 MiB | 0.205% | 3 |
| All sessions stopped | 445.23 MiB | 0.005% | 0 |

Zero new HTTP requests during the 4-second idle sample. 17 native OS `show` events, no `failed`
events; **audible playback not verified**. No full message history or live provider was involved.

See the raw evidence JSON for the final run values. Measured with Electron `app.getAppMetrics()`:
summed process working-set memory (includes shared pages), summed interval CPU percentage, all Bop
processes including dashboard, GPU, network and reminder. Idle sampled after 4 seconds, active after
6 fixture events spaced 1.2 seconds, stopped sampled after 3 seconds. No before/after speedup claimed.
Three very small fixture pages are **not representative of full Messenger/WhatsApp applications**;
real providers can use substantially more RAM/CPU/network/battery. Idle request delta is measured, not
an inference from a timer count. No Android battery/resource measurements were possible.

## User live verification needed

1. Run desktop from source (`cd desktop && npm start`) to exercise this change, not the old portable
   executable. Open 2–3 authorized accounts and leave only A selected. Record service/layout/account ids.
2. Disable website notifications without clearing cookies. From a second device send a real message
   to B/C. Check title changes, the correct Bop unread/status/card and actual speaker sound.
3. Send a second message while the same chat remains unread; send another to an open selected chat.
   If the title does not change, record the unsupported case rather than pretending a message ID exists.
4. Minimize/close to tray, briefly disconnect networking, then restore. Check website's own connection
   and exposed state recover; verify no repeated old-message sound. Quit/restart separately.
5. On a real Android device test separate profiles, screen-off/doze/process removal and native title
   callbacks. Do not infer reliability from the desktop SSE run. Check permission/channel mute/DND.

**Outcome:** implemented and verified a lightweight multi-account unread-signal pipeline within the
existing architectures. The full objective of reliable per-message, per-conversation monitoring across
all providers and Android background states is **not achieved or claimed**. That requires verified
provider-specific message IDs/events or official authorized APIs and, for continuous Android delivery,
a supported push mechanism or explicitly accepted local keepalive cost. No remote infrastructure was
introduced. Bop cannot monitor after its local process is terminated.
