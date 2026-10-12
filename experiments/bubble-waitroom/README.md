# Bop bubble waiting-room experiment

**Outcome: useful partial mechanism, but the requested waiting room did NOT pass.**

Tested October 7, 2026 on the existing D:-hosted Android 17/API 37 Play Store emulator. No root,
Accessibility service, privileged APK, notification assistant, ROM changes, Messenger/Zalo installation
or real account login. Bop production sources, APKs and desktop releases were not changed.

## Exact acceptance

An original foreign bubble enters Bop and disappears from the outside screen; the source application
still owns the conversation and receives messages; choosing it restores the original bubble/chat.
A shortcut list, copied notification, screenshot overlay or replacement WebView does not satisfy this.

## Two real apps, not two fake UI elements

- [Source APK](artifacts/waitroom-source-lab.apk), package `com.bop.lab.source`, UID **10229** in this run:
  owns Alpha/Beta conversations, system bubble metadata, original Activity and message counters.
  Also creates an independent `TYPE_APPLICATION_OVERLAY` named `WaitroomSourceOverlay`.
- [Room APK](artifacts/waitroom-room-lab.apk), package `com.bop.lab.room`, UID **10230**:
  user-authorized notification listener restricted by its code to the Source package.
  Buttons snooze Alpha, try foreign repost, open its original PendingIntent or attempt cancellation.
- Java framework APIs only. Build uses installed SDK/JBR, no new library/service or dependency download.
  Both APK signatures verify. These are **lab APKs, not a release to install on a personal phone**;
  the Source message receiver is intentionally exported for the emulator harness.

## Observed results

| Probe | Actual observation | Does it meet the requested feature? |
| --- | --- | --- |
| Snooze foreign notification | Alpha removed from active notifications, removal reason 18, appears in the system snoozed list | Only the notification is parked |
| Restore on timer | Final 25-second test reposts after **25.127 seconds** (log timestamps) | Notification returns, not user-controlled bubble restoration |
| New message while snoozed | Source receiver increments Alpha to message 6; Room reads message 6 in the snoozed list; original Source Activity also shows 6 | Source remains responsible for updates; not proof of Messenger push |
| Hide actual system bubble | **Stack bubble count stays 2 before and during snooze**, both source keys retained in WMShell | **FAIL**: the foreign bubble is still on screen |
| Hide app-owned overlay | `WaitroomSourceOverlay` remains in window dumps during snooze | **FAIL**: snoozing notification does not control foreign overlay |
| Repost as original app | `notifyAsPackage` throws SecurityException: Room cannot post for Source | **Denied without source notification delegation**; not proof that every possible restore approach is impossible |
| Open original chat | After visible-sender BAL opt-in, original Source Activity launches and shows Source UID 10229/message 6 | **PASS** for original Activity launch, not for restoring a parked bubble |
| Cancel Alpha via listener | API request logged; immediate snapshot still has Alpha and two bubbles | No useful bubble parking demonstrated; no long-term cancellation guarantee |
| Drag foreign bubble into Bop | Not implemented or tested | Not satisfied |

Do not infer success from the notification's `FLAG_BUBBLE`: WMShell state and screenshots are the
important check. The two retained source bubble keys disprove the hide step on this emulator.

The Source has an optional **explicit notification delegation** button for future cooperative-app
experiments, but it was **not pressed/tested**. Messenger/Zalo cooperation cannot be assumed.
No hidden unsnooze method was invoked; shell unsnooze was not used to fake an app capability.

## Evidence

- [Machine-readable results and APK hashes](evidence/results.json)
- [Actual room before parking](evidence/23-final-two-plus-overlay.png)
- [Room after parking](evidence/24-final-real-park-plus-overlay.png)
- [Update while parked](evidence/25-final-update-plus-overlay.png)
- [Permission denied](evidence/26-final-permission-denied.png)
- [Original source chat, message 6](evidence/27-final-original-chat.png)
- [Before: WMShell](evidence/23-final-two-plus-overlay-shell.txt)
- [Parked: WMShell](evidence/24-final-real-park-plus-overlay-shell.txt)
- [Updated: notification state](evidence/25-final-update-plus-overlay-notifications.txt)
- [Updated: foreign overlay still present](evidence/25-final-update-plus-overlay-windows.txt)
- [App logs](evidence/logcat.txt)

Earlier tests had a real source crash because bubble launch tokens must be mutable; repaired with a
separate explicit mutable bubble token while retaining immutable contentIntent. An initial original
chat launch was blocked by Android BAL; repaired with `ALLOW_IF_VISIBLE` sender opt-in, then observed
at the actual original Activity. Source Java APIs are guarded by lab minimum API 30; the BAL sender
option requires a newer OS, so this prototype is tested only on API 37, **not** validated on API 30–33.

Automation also encountered SystemUI's first-bubble tutorial and bubble/flyout interception of centred
button taps. The driver now dismisses the tutorial and taps the exposed right side of buttons. Failed
runs are not counted as completed parking. Build still reports deprecation/compiler/native-access
warnings; no warning suppression was added.

## Reproduce in the same Windows SDK environment

Requires emulator-5554 running, SDK build-tools 37.0.0, platform android-37.0, JBR and local debug key.
Build intermediates are on D:; final APKs/evidence are in this experiment folder.

```bash
python experiments/bubble-waitroom/build.py
python experiments/bubble-waitroom/drive.py setup
python experiments/bubble-waitroom/drive.py capture before
python experiments/bubble-waitroom/drive.py tap 'Park Alpha for 25 seconds'
python experiments/bubble-waitroom/drive.py capture parked
# Wait >25 seconds, then capture and compare the WMShell stack counts.
python experiments/bubble-waitroom/drive.py capture returned
python experiments/bubble-waitroom/drive.py tap 'Park Alpha for 2 minutes'
python experiments/bubble-waitroom/drive.py update
python experiments/bubble-waitroom/drive.py ui
python experiments/bubble-waitroom/drive.py tap 'Try restore'
python experiments/bubble-waitroom/drive.py tap 'Open original'
python experiments/bubble-waitroom/drive.py logs
python experiments/bubble-waitroom/verify.py
```

`verify.py` validates the **recorded named snapshots**, including the failed user criterion, not a new
live test or compatibility suite. UIDs/counters/timestamps refer to this recorded run. The harness
uses emulator shell commands only to install lab APKs, configure equivalent user notification/bubble/
overlay permissions, simulate incoming messages, collect state and drive taps. Snooze/launch/foreign
repost calls themselves execute under Room's ordinary UID, not shell/root.

## Conclusion and next boundary

This prototype proves original-chat routing and timed notification parking are possible without
owning the chat, but **it does not put the original bubble into a Bop waiting room**. No claim is made
about a Samsung S21 Ultra, older Android versions, Messenger/Zalo, ten simultaneous bubbles, indefinite
parking, crash/reboot recovery or battery/performance. No Bop feature was shipped from this experiment.

A next experiment must address **SystemUI bubble visibility/stack control** (or cooperation from the
source app), not add prettier room UI around snoozed notifications. System-level experiments would
need a separate approved emulator setup; changing the personal phone is not authorized by this test.
