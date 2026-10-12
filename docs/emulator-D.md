# Android emulator test on D:

October 8, 2026. This round sets up and tests the existing Android application in a new disposable
AVD on D:, as requested. It does **not** implement the proposed 10-second sequential unread scanner.
No APK was rebuilt, no host processes owned by the IDE were stopped, and no existing user AVD/session
was moved, wiped or deleted.

## Exact environment

- SDK: `D:\dev\android-sdk` (already moved in a previous round).
- New test AVD: `D:\dev\bop-test-avd\BopLowRam.avd`.
- AVD discovery/index: `D:\dev\bop-test-avd\BopLowRam.ini`.
- Logs/temp: `D:\tmp\bop-emulator-check`, `TEMP`/`TMP` set to `D:/tmp` for launch.
- System image: installed Android 17/API 37, x86_64 Google Play, 16KB page size.
- WebView provider: `com.google.android.webview` 149.0.7827.5.
- WHPX hardware acceleration: available; no elevated/system configuration changes.
- 2 CPU cores; 480×800 display, 160 dpi; no snapshots/audio/cameras/SD card.
- Final tested guest RAM: **2048 MiB** with `-lowram` to prevent the installed Play image from promoting
  the requested 2048 MiB to 4096 MiB. `-lowram` did not establish `ro.config.low_ram=true` on the first
  run; do not infer Android low-RAM policies from the emulator flag alone.
- Writable userdata, cache and generated VM configuration were checked on D:. Existing `Medium_Phone`
  AVD on C: is unchanged. This is a separate test AVD, **not a migration of all AVDs to D:**.

## What actually worked

1. New D-backed AVD is discoverable with `ANDROID_AVD_HOME` set for the launch.
2. **1024 MiB trial:** cold boot eventually reached `adb device` and `sys.boot_completed=1`, after the
   initial bounded readiness wait timed out. The guest was too memory-constrained for useful testing:
   launcher/process kills, broken temporary external-storage readiness and test-process failure.
3. **2048 MiB without `-lowram`:** failed before guest boot. Emulator raised RAM to 4096 MiB and reported
   insufficient RAM/commit headroom. This failed launch is not counted as an emulator pass.
4. **2048 MiB with `-lowram`:** booted, log reports **56,484 ms**, `adb device` and `sys.boot_completed=1`.
   Actual generated `hardware-qemu.ini` confirmed `hw.ramSize=2048` and D: userdata/cache paths.
5. Installed the existing application and existing instrumentation APK in this test guest; granted
   notification permission for the test app. Successfully launched Bop and read its rendered onboarding
   through UIAutomator. Tapped Continue with real Android input, then scrolled the page to verify both
   **Account A / Account B**, Messenger labels and **Open** buttons on the Spaces screen.
   A first check before scrolling did not see account names below the viewport; scrolling made both
   visible without weakening the expected UI check.
6. Collected actual screenshot/accessibility XML and guest process diagnostics. Bop before web login
   measured **89,501 KiB total PSS**, **190,264 KiB total RSS**. This is one instantaneous measurement of
   onboarding, not multi-account scanning RAM, idle CPU, battery draw, thermal behavior or a speedup.

Evidence: [Spaces screenshot](evidence/emulator-D/spaces.png),
[UI hierarchy](evidence/emulator-D/spaces.xml),
[app memory](evidence/emulator-D/app-memory.txt),
[2 GiB emulator startup log](evidence/emulator-D/emulator-2048.log).

## Checks that failed — not claimed as passes

Two existing instrumented checks were attempted individually:

- [Web entrypoint test output](evidence/emulator-D/entrypoints-test.txt): `Process crashed`.
- [Profile isolation test output](evidence/emulator-D/profile-test.txt): `Process crashed`.

Android [process exit diagnostics](evidence/emulator-D/process-exits.txt) identify both instrumented
Bop process exits as **reason 3 (LOW_MEMORY)**, at approximately 107 MiB/142 MiB RSS. They were not
completed assertion failures and not passing tests. The guest Play/Google background apps repeatedly
consumed memory. Stopping unused Play/Google background apps in this isolated guest did not resolve
instrumentation process kills. No test was skipped/weakened to report success.

`adb shell am instrument` returned host exit 0 and printed `INSTRUMENTATION_CODE: 0` even for the
crashes; the output was checked and the wrapper rejected it rather than treating exit 0 as a pass.
The instrumentation APK is an existing earlier artifact, not a newly compiled test of all current
sources. No attempt was made to treat these device runs as verification of the newer unread scanner.

## Exact APKs used

| Existing artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| [App APK](../app/build/outputs/apk/debug/2accapp%20version%2012.apk) | 12,148,518 | `27c5c3cb51b140432c7019516488d15ff63e47a6e45f2dcc9c8590ff4f6034a3` |
| [Earlier test APK](../app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk) | 1,073,614 | `286e593e6e090938d1e20b0c20d5e05696208f681f35c75bf4b7fe3b1d40480e` |

The app artifact present when this round began was already named `2accapp version 12.apk`;
this agent did not rename/rebuild it. Package `com.example.twoaccmess`, versionCode 9, `2.0-bop`.

## Shutdown and cache cleanup

The owned guest `emulator-5560` / AVD `BopLowRam` was stopped through `adb emu kill`. Both emulator
and QEMU PIDs were checked gone; no device remains running from this round. Only this test AVD's
snapshot RAM backing store and cache images were deleted **after shutdown** (approximately 2 GiB
backing store removed). Configuration and its approximately 1.7 GiB userdata were retained for reuse.
No unrelated caches, IDE daemons, old D: test AVDs or existing C: AVDs were touched.

Rerun from Git Bash (change `-no-window` if a visible emulator window is wanted):

```bash
export ANDROID_HOME='D:/dev/android-sdk'
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_AVD_HOME='D:/dev/bop-test-avd'
export TEMP='D:/tmp' TMP='D:/tmp'
/d/dev/android-sdk/emulator/emulator.exe \
  -avd BopLowRam -datadir D:/dev/bop-test-avd/BopLowRam.avd \
  -memory 2048 -cores 2 -lowram -no-window -no-snapshot -no-snapstorage \
  -no-audio -no-boot-anim -gpu auto -port 5560
```

Check that ports 5560/5561 are free and no `BopLowRam` guest is already running first. A fresh emulator
is not a logged-in messaging account; preserved host/phone account cookies are not copied into it.

## Remaining blockers for the user's scanner request

- The requested round-robin scanner, filtering website-muted chats across all services, per-space
  true unread badge and notification-on-new-unmuted-unread are **not implemented by this round**.
  (A later round added the [tested scan core](scanning.md) for this request, still unwired to any page.)
- No source account was logged in, no actual incoming message was sent, and no unread/mute DOM/API
  adapter for a provider was validated. Title counts cannot distinguish muted conversations.
- Screen-off sequential delivery, Doze handling, notification delivery for actual accounts, resource
  improvement and phone temperature were **not tested**. Doze can suspend CPU/network work; 10 seconds
  is not a supported guaranteed background schedule just because storage is on D:.
- A lean non-Play test image and sufficient host commit/RAM headroom are the next practical way to get
  stable instrumentation. Source-specific unread/mute adapters still require authorized login sessions.
