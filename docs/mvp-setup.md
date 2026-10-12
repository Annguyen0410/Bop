# Bop 2.0 — setup and acceptance

Previously TwoAccMess. Display branding changes, but debug ID `com.example.twoaccmess`, release ID
`com.twoaccmess.hub`, encrypted-settings key/AAD and legacy A–P browser suffixes remain compatible.
VersionCode 9, versionName `2.0-bop`. Release still requires your signing key.

## Everyday use

1. Accept the short disclosure. **Spaces** contains your account cards, search and app filters.
2. Tap **＋ Add**, choose an app, then Open and sign in on its official HTTPS domain.
3. The card's **⋯** menu lets you rename, change app, choose/reset picture or remove a space.
   Removing hides the space and clears hub alerts but keeps its website session and picture. A/B stay.
4. **Alerts** shows observed notifications, account filters and excerpts. Open conversation uses the
   source notification's original action; expired actions fail closed rather than opening another account.
5. **Settings** contains Appearance, Bubble studio, notification/overlay permissions, test alerts,
   optional native Messenger routes and copyable diagnostics.
6. **Guide** holds expandable instructions and honest privacy/compatibility limitations.
7. In the browser, **Spaces** picks an enabled account with that account's app; Options changes
   desktop/mobile mode or clears the local session. Uploads use Android's document picker.

## Slot isolation and resource limits

- A–P keep sixteen private manifest activities/processes and their existing browser directories.
- Q onward use a dynamic ID (Q…Z, AA…AZ, …), encrypted persisted metadata and a named WebView profile,
  applied before settings/cookie access/navigation. There is no hard-coded 16-count cap.
- `MULTI_PROFILE` is checked. Without it extra spaces are blocked with an engine-update message;
  shared cookie jars are never a fallback. `DELETE_BROWSING_DATA` is also checked before full
  profile-specific clearing. A legacy session's clearing APIs stay in its own process.
- Provider/storage/memory limits still exist. "No fixed ceiling" does not mean literal infinity or
  unlimited simultaneous running WebViews. Profiles share the Android UID, not a security sandbox.
- Per-space app/consent/desktop preferences are separate; old activity preferences migrate locally.
- Notifications cannot identify several accounts in one installed app. Messenger routes use profile
  bindings; other supported apps require exactly one enabled space for the app. Unknown categories
  are accepted for compatibility and can still be inaccurate. No background web polling/push.

## Bubble acceptance

The horizontal dock coordinate is exactly **0** on the left or **screen width − bubble width** on the
right. Drag release, canceled drag, restore and rotation re-dock. Vertical margins remain for touch
safety. Its round icon has no exterior padding. START gravity converts absolute horizontal positions
for RTL, and drag starts from the absolute anchor, not the mirrored layout parameter. The menu has
its own window, is clamped/measured to fit, and is removed when the service is stopped.

## Phone/emulator checklist

1. Upgrade a matching-signed 1.7 install: A/B app choices, labels, pictures and actual website logins
   should survive. Verify with your own real accounts; this is not proved by synthetic cookies alone.
2. Add 17+ spaces; open Q and R with the same service. Sign into different accounts; restart and verify
   separation. Clear Q and confirm R stays signed in. On an unsupported WebView, extra spaces must
   fail closed and A–P remain available.
3. Rename a space, search by the new name, filter apps, choose portrait/landscape avatars, remove and
   re-add. Check the documented retained-login behaviour.
4. Trigger a real supported message notification. Check the slot, excerpt, original action, swipe
   dismissal and Refresh (unchanged dismissed content must not resurrect). A new message can re-alert.
5. Test duplicate-app ambiguity, source removal/read, notification permission revocation and lock.
   Categorized likes/promos must be filtered; unknown category accuracy depends on the source.
6. Start bubble, drag left/right and confirm a flush horizontal edge; open/close menu/web account,
   rotate, restart, switch to an RTL locale and stop while expanded. No leaked menu/window allowed.
7. Switch light/dark/system and inspect the dashboard, bubble, menu/browser toolbar; large font,
   narrow phone, landscape and long names must remain usable. Guide text must not clutter Spaces.
8. Upload an attachment through the Android picker, cancel another upload, recover a stopped renderer
   with Reload. Check domain display and blocked off-service/cleartext/TLS navigation.
9. Capture screenshots/recording of Spaces, bubble and browser; Bop sets no screenshot-blocking flag.
10. Verify native account links, encrypted settings, generic work/lock-screen cards, and test-alert expiry.
11. Open **Settings → Runs on every phone** on the phone you actually use. It must list the real device
    and WebView line, mark each of the six checks Allowed/Off/Unrestricted honestly, and its **Fix**
    buttons must land on the matching system screen — the battery one opens the one-tap exemption dialog
    on builds that allow it. Then revoke notification access manually: the “Listener connected” check
    must turn red and reconnect from its own button.

## Verification evidence

See [verification.md](verification.md) for the final build/test totals and artifact hashes. Earlier
attempts remain in `.freebuff/bop-*.log`; a failed attempt is not evidence of success. Live account
login/site compatibility and OEM notification behaviour still need phone acceptance.

## Main implementation

- [MainActivity.kt](../app/src/main/java/com/example/twoaccmess/MainActivity.kt): bento dashboard,
  Alerts, Settings, Guide, card management and avatar picker.
- [HubState.kt](../app/src/main/java/com/example/twoaccmess/HubState.kt) and
  [HubRepository.kt](../app/src/main/java/com/example/twoaccmess/HubRepository.kt): stable dynamic
  identities, encrypted settings and old-data compatibility.
- [SpaceSessions.kt](../app/src/main/java/com/example/twoaccmess/SpaceSessions.kt): non-secret
  cross-process routing index and guarded WebView profile attachment/cookie manager.
- [MessengerWebActivity.kt](../app/src/main/java/com/example/twoaccmess/MessengerWebActivity.kt):
  legacy and dynamic browser, profile-specific clearing, enabled-space picker and upload flow.
- [FloatingHubService.kt](../app/src/main/java/com/example/twoaccmess/FloatingHubService.kt) and
  [BubbleGeometry.kt](../app/src/main/java/com/example/twoaccmess/BubbleGeometry.kt): edge docking,
  separate account menu, RTL conversion and lifecycle cleanup.
- [HubNotificationListener.kt](../app/src/main/java/com/example/twoaccmess/HubNotificationListener.kt):
  source reconciliation preserves acknowledgements while removing vanished source notifications.
- [HubReliability.kt](../app/src/main/java/com/example/twoaccmess/HubReliability.kt): the six
  every-phone checks and the manufacturer advice, kept free of Android types so the rules are unit-tested.
- [HubBootReceiver.kt](../app/src/main/java/com/example/twoaccmess/HubBootReceiver.kt): asks Android to
  re-bind the notification listener after a restart or an app update, without starting any service.
- [Brand icon](../assets/bop-icon.png), [avatar](../assets/bop-avatar.png) and
  [privacy](PRIVACY.md).
