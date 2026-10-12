# Bop — Privacy Policy

Last updated: 8 October 2026

Bop runs entirely on your phone. It has no server, no account of its own, and no analytics.

## What the app accesses

| Data | Why | Where it goes |
| --- | --- | --- |
| Web sessions you sign in to (cookies, cache, site storage) | To keep each slot logged in separately | App-private storage on this device only |
| Notifications from installed messaging apps | To show "Account X has a message" cards | Message previews are held in memory only |
| Native WebView tab-title changes in a loaded web space | To update an aggregate unread marker without polling | Title held in memory; only account and unread count cross to the hub, never uploaded |
| Pictures you choose for the bubble and slots | To show avatars | App-private storage (`filesDir/avatars/`), scaled to 256 px |
| Notification-action tokens from those apps | So tapping a card can open the real conversation | Memory only; never written to disk |

## What the app never does

- The hub never extracts passwords, PINs, recovery codes, cookies or session tokens. WebView itself
  stores website sessions locally and communicates with the official sites you sign in to.
- Android web monitoring uses `WebChromeClient.onReceivedTitle`, not an injected script, JavaScript
  bridge, DOM observer, repeating timer or network poll. No DOM/message text is read and the title is
  not stored. Off-screen callbacks are best-effort: Android or the website can suspend/kill a session.
  There is no new foreground service, wake lock, boot-time web-session loader or remote monitoring.
- It never scrapes a page's DOM, and never forwards authenticated URLs to other apps.
- It never uploads message content, notification content, or diagnostics anywhere.
- It has no advertising, tracking, or third-party analytics SDK.

## Notification access

Android grants notification access broadly. Bop filters for the 18 catalog apps that own a
phone app and ignores every other package. It keeps only message-like notifications (a messaging
payload, a conversation shortcut, or a message category; unknown categories are accepted for
compatibility and can be inaccurate) and stores previews in memory.
You can revoke this at any time in Android Settings, which stops installed-app observation.
Web-session unread signals are independent of notification access. Posting Bop notifications still
requires Bop's OS notification permission, mirror setting, account channel settings and lock policy.

## Reports and diagnostics

Crash and session reports stay on the device. They contain process names, SDK versions, stage names and
stack traces only — never passwords, cookies, message content or page URLs. You can view, copy or clear
them from Settings, and copying is a manual action you take.

## Browser spaces and attachments

Legacy spaces A–P keep separate private browser processes/directories. Additional spaces use named
WebView profiles, separating cookies and website storage; all share the same Android UID, not a
work-profile sandbox. Removing a space hides it but retains its local session and picture. Clear its
local session in the browser before removal if you want to log out.

Uploads use Android's document picker and are sent by the website to the service you selected.
Bop does not store an extra upload copy or hand authenticated page URLs to other apps. Camera and
microphone access, external popups and downloads remain disabled.

## Backup and screenshots

Android backup and data extraction are disabled for the app's data. Screenshots and screen recording
are allowed on purpose: no screen sets a secure-window flag, so the cockpit, the floating bubble and
the web slots can be captured like any other app. A screenshot of a signed-in web session shows
whatever that page shows, so treat it as a screenshot of that site.

## Children

The app is not directed at children and collects no personal data.

## Contact

Open an issue in the project repository you obtained this build from.