# Notifier fixture (device verification only)

Bop's Android alert path only reacts to notifications from packages in [HubApps](../../app/src/main/java/com/example/twoaccmess/HubApps.kt).
Verifying it on a device therefore used to need a real WhatsApp/Instagram/Messenger account. This little
app closes that gap: it installs as `com.whatsapp` and posts a `Notification.MessagingStyle` notification
with `CATEGORY_MESSAGE`, which is exactly the strongest "a conversation is active" signal
[AlertFilter](../../app/src/main/java/com/example/twoaccmess/AlertFilter.kt) accepts.

It is a **standalone Gradle project, not a product module**: the root `settings.gradle.kts` does not include
it, it is never part of a release, and it must only be installed on a throwaway emulator or test phone.

## Run

```bash
./gradlew -p tools/notifier-fixture :app:assembleDebug
adb install -r tools/notifier-fixture/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.whatsapp/.Main          # first launch leaves Android's "stopped" state
adb shell pm grant com.whatsapp android.permission.POST_NOTIFICATIONS
adb shell pm grant com.example.twoaccmess android.permission.POST_NOTIFICATIONS
adb shell cmd notification allow_listener com.example.twoaccmess/com.example.twoaccmess.HubNotificationListener
```

Then, in Bop, add a WhatsApp space (the picker finds the installed package) and post a message:

```bash
adb shell "am broadcast -a com.whatsapp.FIXTURE_POST --es tag chat-1 --es text 'hello' -p com.whatsapp"
adb shell dumpsys notification --noredact | grep -A2 "pkg=com.example.twoaccmess"
```

`com.whatsapp.FIXTURE_CLEAR` removes the fixture's own notification again. Use a **new tag** for each new
message: an updated notification with the same tag and unchanged text is deliberately silent.

## What this proves and what it does not

It proves the listener, `AlertFilter`, slot attribution, card wording and the notification-permission
behaviour with real `StatusBarNotification` objects from a real package. It does **not** prove WhatsApp's
own notification format, a physical phone's OEM battery management, or real Doze calibration.
