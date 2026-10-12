# Two-account Messenger bubble: feasibility and engineering report

**Project:** TwoAccMess  
**Research date:** 3 October 2026  
**Status:** Architecture decision and implementation plan; not an implemented or device-validated integration.  
**Decision:** No application virtualization. Use two official Messenger installations isolated by Android profiles, plus a personal-profile notification hub and profile-aware navigation. Use a custom overlay for the exact one-hub-bubble interaction; optionally use Android 17 system-managed app bubbles.  
**Product boundary:** A unified notification cockpit with conditional quick replies, not a replacement personal Messenger client.

## Executive decision

Two independent Messenger sessions can coexist without reconstructing Parallel Space: install the official, unmodified app in the personal profile and in an enabled managed/work profile, and sign in separately. Android supplies separate UIDs, storage, process contexts, permissions, and account state. The same package can be installed for both profiles. [S1–S3]

A host can observe permitted notifications from both profiles, distinguish their originating profile, display account-specific previews, and invoke original notification actions. This is **realtime notification integration**, not a complete conversation feed. A notification listener in the work profile is ignored; the listener must run in the personal profile, and the profile administrator can block its access to work notifications. [S1, S4]

The required complete, independently functioning conversation UI **inside one third-party bubble** has no reliable, documented implementation for two personal Messenger accounts. Meta's published Messenger Platform is for Facebook Pages/business messaging and Instagram professional accounts, not a personal-account inbox. Ordinary Android APIs cannot read Messenger's private databases, reproduce its authenticated message transport, or arbitrarily embed its Activities. [S5–S8]

**Go:** Build a capability-tested, local-only notification hub for supported devices/profiles.  
**No-go:** Promise a complete personal Messenger inbox, full realtime history, authoritative unread counts, guaranteed delivery, or guaranteed embedded Messenger screens. If those are non-negotiable, stop implementation unless Meta provides a supported integration or the scope changes to business/Page messaging.

Android 17 matters: official documentation now describes **App Bubbles**, allowing users to put any app in a system-managed floating window. This improves floating access to the hub and potentially the real Messenger apps. It does **not** grant the hub message access, cross-profile privileges, or authority to merge two Messenger tasks into one host-controlled window. Availability and managed-profile behavior require device testing. [S9, S10]

## 1. Exact problem definition and acceptance criteria

### 1.1 Requested experience

One draggable floating entry point → two visually distinct accounts → selected account's complete chat list → selected conversation and input inside the bubble → receive/send with minimal delay → account-specific Messenger-like notifications → instant account switching.

The objective is narrow: two personal Messenger accounts and one navigation/notification center. Games, stores, generic package managers, device spoofing, privacy cloaking, token extraction, authentication interception, and whole-framework emulation are explicitly out of scope.

### 1.2 What counts as success, and what must be changed

| Requested capability | Supported target for the selected architecture |
|---|---|
| Two simultaneously available sessions | Official Messenger in personal + managed profile; both enabled/unlocked and separately signed in |
| Independent account data | OS-owned profile isolation; host never copies Messenger session data |
| One main floating bubble and two account choices | Custom application overlay; Android 17 user-bubbled hub is an optional system-managed alternative |
| Account-specific unread counts | **Observed pending-alert counts**, not verified total unread messages; show unknown when coverage is lost |
| Complete conversation list | **Unavailable to host**; show “Recent notifications” and “Open Messenger inbox” instead |
| Complete conversation view | **Unavailable to host**; show clearly labeled observed notification snippets, then open the real conversation |
| Embedded send/receive | Conditional quick reply using a live original `RemoteInput` action; no general send API for personal accounts |
| Minimal-delay updates | Event-driven notification callbacks; no polling-based imitation of realtime |
| Correct account routing | Every route qualified by installation/profile and account binding generation; unresolved routes fail closed |
| Background survival | Persist host state, reconnect listener, reconcile active notifications; no immortal processes or guaranteed missed-message recovery |

**This is a reduced but usable MVP, not full satisfaction of the requested embedded-chat experience.** Product approval of this boundary is required before implementation.

### 1.3 Scope of this deliverable and workspace

This report is the deliverable: [two-account-messenger-engineering-report.md](docs/two-account-messenger-engineering-report.md). No application source, manifest, dependency, or build configuration is changed. The workspace is currently a Kotlin/Compose Android starter, not an existing cloning engine: [MainActivity.kt](app/src/main/java/com/example/twoaccmess/MainActivity.kt) shows a greeting, and [AndroidManifest.xml](app/src/main/AndroidManifest.xml) has only the launcher Activity. [app/build.gradle.kts](app/build.gradle.kts) declares minSdk 24 and compile/target SDK 37. Compose, Activity Compose, Core KTX, and Lifecycle Runtime KTX are already present; no virtualization, database, AccessibilityService, notification listener, or overlay implementation is present.

No Parallel Space APK, Messenger APK/version, test device, notification capture, or runtime trace was supplied or exercised. This investigation is **documentary/source-level analysis of an equivalent open-source architecture**, not a binary reverse-engineering result for proprietary Parallel Space. Device-specific Messenger behavior remains unverified.

## 2. Relevant Parallel Space mechanisms and reverse-engineering findings

### 2.1 Evidence and its limits

The inspected equivalent is VirtualApp's public Java source, including `VEnvironment`, `VUserHandle`, `VClientImpl`, `VASettings`, `ActivityStack`, `VActivityManagerService`, and `VNotificationManagerService`. These sources establish the mechanisms below; they do not establish that current Parallel Space uses identical code. The public repository says its code stopped updating in December 2017 and differentiates a commercial version. Its modern compatibility claims are not proof that the historical public engine runs current Messenger on Android 17. Moving `master` links are supplied for inspection, not a reproducible tested release. [S19–S26]

### 2.2 Storage and instance isolation

`VEnvironment.getDataUserPackageDirectory(userId, packageName)` builds a per-virtual-user, per-package namespace under the host's private `virtual/data/user/` tree. `VClientImpl.startIOUniformer()` redirects ordinary app paths into the virtual application's data directory, including native/direct path access. Application context and package metadata are adjusted during binding. [S20, S22]

| State | Equivalent virtual engine's required mechanism | Selected native-profile equivalent |
|---|---|---|
| SharedPreferences | Per-instance context/data directory; do not share preference caches across instances | Separate per-profile app sandbox |
| SQLite/databases | Redirect paths and journal/WAL files consistently; distinct in-memory handles | Separate per-profile database files and processes |
| Cache/files/code cache | Per-user/package paths; reconcile Java and native path access | Separate profile-specific app storage |
| External/app-specific files | Virtual external-storage mapping when needed, not just a preferences directory | Profile-aware storage/scoped-storage rules |
| WebView cookies/storage | Separate runtime/data context; renderer/cache/global-state compatibility must be verified | App WebView state separated by profile and UID |
| Login/session and account state | Per-instance data plus virtual account/service routing; directory separation alone is insufficient | Messenger maintains its own session and keys in each profile |
| Process globals | Distinct guest process context so singleton/native/WebView state cannot leak | Independent profile-specific process trees |
| Notifications/actions | Map notification ownership, IDs/tags, cancellation, and PendingIntents back to the originating instance | Native notification ownership includes profile |

The public source's path redirection is **not** proof of complete WebView, Android Keystore, modern credential-encrypted/device-encrypted storage, push, or E2EE compatibility. These are additional dependencies for a real modern guest. For example, the inspected old code redirects some device-encrypted paths into the same guest data directory; do not copy it as a modern security design.

A virtual user's namespace is generally not a kernel-enforced security boundary from the host or sibling code running with host privileges. Separate guest processes improve functional isolation but do not automatically supply distinct OS UIDs. Native profiles provide the stronger security boundary needed here.

### 2.3 Runtime identity

VirtualApp distinguishes instances with a virtual user and virtual app ID. `VUserHandle.getUid(userId, appId)` composes a virtual UID; `VActivityManagerService` keys processes by process name and virtual UID, while storage uses user + package. Virtual package metadata retains the guest package identity; stub components expose the real host identity to Android. [S20–S25]

Thus “Messenger A” and “Messenger B” need not have different package names inside a virtual engine. They can be `(virtualUserA, originalPackage)` and `(virtualUserB, originalPackage)`. A process name alone is not an account identifier, and a PID is not stable across restart.

### 2.4 Process and launch model

The inspected engine has a host UI, a virtual manager/server, and guest client processes using manifest-declared stub slots. `VASettings` names stub Activities, providers, and jobs; `VActivityManagerService` starts a slot through a stub provider and binds virtual UID/package/process state. `VClientImpl` creates the guest Application/context/classloader and installs providers before Application creation. [S22–S25]

| Component | Source-backed equivalent mechanism | Messenger-relevant consequence |
|---|---|---|
| Activity | `ActivityStack.startActivityProcess()` resolves user/package, obtains guest process, wraps original Intent/ActivityInfo/userId in `StubActivityRecord`, launches real host stub; guest restores intended component | Correct inbox/chat navigation requires account-specific task and intent routing |
| Service | Virtual service records resolve service for user; manager schedules create/start/bind into the guest process through app-thread compatibility calls | Push/lifecycle services require framework compatibility, not merely launching a screen |
| BroadcastReceiver | Virtual dispatch carries target process/component; `VClientImpl.handleReceiver()` binds app if needed, instantiates receiver, calls it with guest context | Restart/update/message-related broadcasts must stay in the same virtual user |
| ContentProvider | Manager starts the user-specific process, asks guest for provider Binder; guest installs providers and applies provider proxies | Same authorities across clones require instance-specific resolution and Binder routing |
| Notification | Manager namespaces tag as `package[:tag]@userId`, tracks ownership/cancellation; host posts to real system | Account context must survive both incoming notification and outgoing action paths |

`dealNotificationId()` in the inspected source returns the original numeric ID, while tag rewriting supplies part of the namespace. This illustrates why a bare numeric notification ID cannot be the hub's identity key. [S26]

Two active copies of an arbitrary unmodified application need independent execution/global-state contexts. In a practical app virtualization design that normally means distinct real stub/guest processes, potentially several per guest—not one host process with two preference folders. It is not CPU/hardware virtualization, but it still requires broad Android app/framework/native interposition.

### 2.5 What to retain—and what not to build

Retain only the **concepts**: instance-qualified identity, independent storage/session ownership, restartability, component/action routing, and notification namespace separation. Delegate actual sandboxing, component launch, and process management to Android. Do not add virtual PackageManager, Binder hooks, ART hooks, native I/O hooks, guest GMS, APK rewriting, or spoofed device metadata.

## 3. Architecture options

**A. Full application virtualization.** Can sometimes run guest APKs with a host and proxy processes. Messenger depends on native code, private framework behavior, authentication/E2EE state, and background messaging. Reducing the number of cloned apps does not reduce their runtime dependencies to a small guaranteed subset. Even successfully running guests does not expose complete structured chats or create a public embedding contract. Reject as the production foundation.

**B. Dual-instance/cloned-package architecture.** Separate two cases:

- **B1: Rename/re-sign Messenger APK.** Requires package/component/provider/native assumptions to remain valid; loses official signing identity and update path. Authentication, app links, services, and integrity expectations may fail. Do not circumvent these failures. Reject.
- **B2: OEM-supported dual-app/clone profile.** Can preserve official APK and independent data. AOSP defines a clone-profile type but does not provide an end-to-end consumer feature; OEM customization supplies it. Notification/profile visibility and launch APIs vary. An optional certified-device adapter, not a universal baseline. [S2]

**C. Managed/work profile.** Best public Android isolation mechanism for same-device coexistence. Provisioning needs explicit user/admin involvement and compatible device policy; a hub cannot silently create arbitrary profiles. Existing enterprise management may prevent setup or work-notification export. Installation/login, notification permissions, unlock, and profile activation are separate for the second instance. [S1–S3]

**D. Two independently installed Messenger environments.** This is the deployment arrangement; C supplies the recommended isolation. Two installs of the same package in the same Android user are not two separate installs—ordinary installation updates/replaces it. Two full secondary users lose the unified phone UX and notification visibility; private space stops apps when locked and has restricted discovery. Official alternate-package products, if any currently available, need independent evaluation, not an assumption that a historical “Lite” app remains supported. [S2, S13]

Two browser/WebView sessions are an alternative only for foreground experiments: separate cookie/data stores can isolate website logins, but mobile site availability, E2EE history, login flows, and background message delivery remain product-dependent. Two ordinary WebViews in one process commonly share state; separate processes/data-directory suffixes on supported APIs are not equivalent to supported Messenger integration. No hidden protocol or credential extraction is proposed.

**E. Host + notification integration.** Best supported information surface for the host: event callbacks, whatever preview/sender/timestamp/conversation metadata the app publishes, and original click/reply actions. Missing notifications mean missing data. No full history, contacts, online presence, or authoritative read state. Requires user notification access and permitted cross-profile delivery.

**F. Host + accessibility interaction.** Can inspect exposed visible UI nodes and perform user-directed actions. It is not a hidden inbox API, cannot watch two invisible complete chat trees, and cannot prove account identity from identical package names. UI changes/localization/virtualized lists break selectors. Android documents these services as assistive technology for disabilities; Play allows some other disclosed uses but requires declarations/consent and restricts autonomous automation. Do not misrepresent this hub as an accessibility tool. Exclude from MVP and core roadmap. [S14, S15]

**G. Host + intents/deep links.** Useful navigation, not data access. Prefer exact Messenger-created notification `contentIntent`; use `LauncherApps.startMainActivity(component, user, ...)` for an accessible profile's inbox. A generic URL or Messenger scheme does not safely select the desired signed-in account/profile and may open the wrong installation. There is no verified public arbitrary-personal-thread interface in this investigation. Do not construct private component names or rely on undocumented intent extras.

**H. Supported Meta APIs.** Official Page/business messaging supports scoped conversations, message events/webhooks, and sending within permissions/policy constraints. That is a different product/account scope. The published Conversations API also documents history/access limitations; do not promise “complete” access even after changing scope. A personal Facebook Login token does not create a personal Messenger inbox API. Gravity Index research found no catalog-supported provider for this personal-account requirement; authoritative Meta documentation establishes the actual published scope. [S5–S7]

## 4. Feasibility comparison

Ratings are for this exact **personal-account** project, not generic capability. **H/M/L** = high/moderate/low; **N** = not available through the published interface; **C** = conditional on user/admin/OEM/app capability. Complexity/maintenance: higher is worse. “Signal” means notifications, not full chats.

| Architecture | Technical feasibility | Android compatibility | Reliability | Background behavior | Realtime capability |
|---|---|---|---|---|---|
| A: Full app virtualization | M for guest execution; L for full required UX | L–M; per-release/native/ABI testing | L–M | Fragile; host/guest/push dependencies | Guest transport may work; host full stream unproven |
| B1: Repackaged clone | L as a maintained official Messenger solution | L–M, update/signing breakage | L | App/signature-dependent | Unproven |
| B2: OEM clone profile | H on supported OEMs | C; no portable end-to-end standard | M–H on certified models | Similar to native app, OEM restrictions | C notification signal |
| C: Work profile | H for independent sessions | H; API 21+, policy-dependent | H isolation; C integration | Native push while enabled/unlocked; no permanence guarantee | C notification signal; real content remains in Messenger |
| D: Two native environments | H when C/B2 supplies isolation | H for work arrangement; L for full-user unified UX | H isolation; deployment-dependent | Environment-dependent | No new host data interface |
| E: Notification host | H for notification cockpit | H; API 18+ with documented exceptions | M–H callbacks when bound/allowed; incomplete information | System-bound listener; gaps possible | Near-event signal + selected published snippets |
| F: Accessibility host | M for visible-screen interaction | M; framework available, UI/policy fragile | L | No full background chat feed | Visible UI observations only |
| G: Intent host | H for native inbox launch; C thread launch | H for public profile-aware launch, C app actions | H inbox; M thread action validity | Launch only on user action; BAL restrictions | None by itself |
| H: Official APIs | N for two personal inboxes; H for approved Pages | Android-independent backend API | N personal; M–H scoped business | Requires webhook server/push for business | N personal; scoped business content/events |

| Architecture | UI integration quality | Security/privacy implications | Implementation complexity | Maintenance difficulty |
|---|---|---|---|---|
| A | M apparent hosting; full custom chat still unproven | Host can access guest plaintext/session; weak isolation from host | Very high | Very high |
| B1 | Separate app navigation; not embedded | Re-signing/distribution/authentication concerns | High | Very high |
| B2 | Good shortcut/notification entry; OEM-specific floating UI | OS separation if real clone profile; vendor-dependent | Low–M host, high OEM integration | M–H |
| C | Good unified entry, native-app handoff; not host embedding | Strong sandbox; work-preview export requires policy and consent | M | Low–M |
| D | Good coexistence; separate tasks remain | Strong for profiles, poor fit for full-user bridging | Low–M after environment setup | Low–M |
| E | H notification panel; L complete chat UI | Broad sensitive notification access, retention/redaction risks | M | M; structured extras preferred |
| F | M prototype, poor full-inbox reliability | Broad screen/action privileges; major accessibility/Play policy constraint | High | Very high |
| G | Good correct-app navigation, no embedded control guarantee | Low data exposure; account-qualified action routing essential | Low–M | Low for launcher; M for app-specific actions |
| H | Could support custom UI for Pages, not these personal accounts | Business OAuth/token/server responsibilities and platform approval | M–H for alternate scope | M |

**No row satisfies all original requirements.** Combining C + D + E + G maximizes supported behavior while keeping machinery small.

## 5. Chosen architecture and minimum virtualization

### 5.1 Recommended stack

1. Official Messenger in the personal profile → account slot A.
2. Official Messenger in one enabled managed profile → account slot B.
3. TwoAccMess installed in the **personal profile**, with user-enabled notification listener access.
4. One overlay bubble plus Compose notification/account panel; an optional valid foreground service manages the user-enabled overlay session, not Messenger's transport.
5. Profile-aware inbox launch and original notification click/reply capabilities.
6. Small encrypted host metadata store; message snippets memory-only by default.
7. No server, no Messenger credentials, no Messenger networking protocol implementation, no accessibility automation.

### 5.2 Smallest amount of Android virtualization required

> **Zero application/framework virtualization is required to make two independent Messenger sessions coexist.** Use Android's existing profile sandboxing. The minimum additional host machinery is an account-to-installation binding, a permitted notification listener, a small local state store, a unified UI, and profile-qualified navigation/actions.

Profile isolation is not a second emulator and not a host-run VM. Android supplies the namespace and sandbox. Two sessions coexist logically even when one or both processes are not resident; the correct requirement is **restartable independently authenticated environments**, not “keep both processes alive forever.”

There is no proven small virtualization layer that additionally makes a full personal Messenger data API and embedded host UI available. Making an arbitrary unmodified Messenger guest run inside a host requires substantial compatibility machinery, and still does not establish the desired data contract.

### 5.3 Explicit feasibility gates

Before coding beyond a diagnostic prototype, verify on the intended device:

- A compatible work profile exists or can be created through a user-approved profile-owner provisioning flow. Do not remove/replace an enterprise profile or reset the device.
- Messenger is available/installable and independently authenticated in both environments.
- Both profiles are enabled/unlocked; separate push/background behavior works in an overnight test.
- Personal-profile listener receives notifications from **both** installations, and `StatusBarNotification.user` distinguishes them.
- Policy allows exporting work notification previews to the personal host. The user cannot override an administrator's denial.
- Public profile-specific launcher access works from a visible host UI. Default-launcher/shortcut privileges are not assumed.
- Original click actions open the correct instance; optional original quick-reply actions are tested with account-identifying test messages.
- Overlay permission and an appropriate foreground-service/distribution policy basis exist, or Android 17 user-enabled app bubbling is acceptable.

If work notification access is blocked, the two-account notification MVP is **not supported on that configuration**. A second work-profile listener is not a valid workaround. Do not bridge through private files, localhost relays, screen scraping, or hidden cross-user privileges.

## 6. System architecture diagram

```text
   Meta personal Messenger service (transport/E2EE owned by Messenger)
                 |                               |
        official Messenger A            official Messenger B
        personal profile                 managed/work profile
        UID + private data A             UID + private data B
                 |                               |
                 +---------- notifications ------+
                                     |
                    Android NotificationManagerService
                    user consent + cross-profile policy
                                     |
             TwoAccMess NotificationListenerService
             PERSONAL PROFILE ONLY; package + UserHandle
                                     |
                  installation/account binding resolver
                  unknown or ambiguous => no send route
                                     |
                   normalizer + per-account event reducer
                   transactional metadata + deduplication
                            /                  \
                Compose cockpit UI       host notifications
                one overlay bubble       account groups/channels
                            |
                    user-requested operation
                 /                           \
     source contentIntent /          original RemoteInput action
     profile-specific launcher       only if live + verified route
                 |                           |
              Android executes action in original Messenger context
```

There is deliberately **no edge from the host to Messenger's private database/session**, and no host-owned persistent connection to personal Messenger servers.

## 7. Account isolation and identity model

### 7.1 Installation identity is not Facebook identity

Use distinct types:

- `AccountId`: host UUID for a user-confirmed account slot.
- `InstallationId`: vetted package + profile serial number + installation/binding generation.
- `ConversationId`: opaque local ID scoped to `AccountId`; provenance marks whether it is a source shortcut or notification-session reference.
- `MessageId`: local observed-event/message UUID scoped to account/conversation; never pretend it is Meta's canonical message ID.
- `RouteGeneration`: invalidates actions/drafts after rebind, profile removal, data clear, or account-change declaration.

`UserManager.getSerialNumberForUser()` supplies a profile serial where accessible; resolve it against current public profile handles at runtime. Do not persist a PID or rely on recycled numeric user IDs. `StatusBarNotification.user` is the source profile. The same Messenger package name in A and B is expected.

The host cannot reliably discover the Messenger account's real name, avatar, online status, login expiration, or an in-app account switch. Labels/avatars are user-configured unless a documented source exposes trustworthy metadata. Show “Personal · Alice” / “Work profile · Bob”, not a fabricated online dot.

**Critical limitation:** A profile identifies an installation, not the person currently logged into it. If the user logs out of A and logs into a different account without telling the hub, the host cannot prove that change from a public session API. Enforce one account per installation as an operating rule, provide “Account changed / Rebind” with data/action invalidation, and warn that display labels are user-confirmed. Do not claim cryptographic or absolute Facebook-account identity verification. If absolute independently verified identity at every send is mandatory, disable host sending and require the real Messenger UI.

### 7.2 Collision prevention

Use composite primary/foreign keys everywhere:

```text
Conversation PK: (AccountId, ConversationId)
Participant PK:  (AccountId, ConversationId, ParticipantId)
Message PK:      (AccountId, ConversationId, MessageId)
Draft key:       (AccountId, ConversationId, RouteGeneration)
Source key:      (InstallationId, StatusBarNotification.key)
Action key:      (AccountId, ConversationId, RouteGeneration, SourceRevision)
```

Even if both installations publish shortcut `conversation-01`, their records remain distinct. Never merge conversations by title, sender display name, message body, or a package-only key.

### 7.3 Isolation coverage

OS profile separation covers Messenger's preferences, databases, cache/files, app WebView data, process globals, app-scoped keys, permissions, and Android account state. AOSP describes per-profile app UIDs/data and separate AccountManager account lists. [S32] System/network settings can be shared; shared settings are not shared authentication. APK code/version may be shared across user installs, so expect an update to affect both environments; data remains per-profile. Only store host-observed metadata/snippets, never clone app data or retrieve app keys.

## 8. Process model and component launching

| Process/component | Ownership and lifetime |
|---|---|
| Messenger A process tree | Android-managed, personal-profile UID; may include app-defined secondary/renderer processes |
| Messenger B process tree | Android-managed, different profile UID; same package/process names are not a collision |
| Host process | Compose UI, source binding, event reducer/store, system-bound notification listener |
| Optional overlay service | Host-owned, user-visible, legitimate foreground-service type; cannot protect Messenger from kill |
| Profile owner/DPC | Profile setup/policy control; not a required message relay and not the host's authority by default |

No proxy/virtual guest processes are necessary. It is incorrect to specify “exactly two processes”: each real Messenger instance can spawn several processes, and either may be reclaimed. Push/restart behavior belongs to Messenger and the OS; assume neither a particular push provider nor a private Messenger protocol.

**Activities:** Select current accessible profile via `LauncherApps.getProfiles()`, discover actual launcher component with `getActivityList(package, profile)`, and call `startMainActivity` on explicit user request. These public main-activity APIs differ from privileged shortcut enumeration/launching; do not require becoming the default launcher merely to open an accessible managed-profile main Activity. Package visibility and profile restrictions still apply. [S3]

**Chat navigation:** Prefer the original notification `contentIntent`, associated with its original profile and source revision. Treat it as an opaque capability. If absent/cancelled/expired, open the selected profile's inbox, clearly stating the chat needs manual selection. A fallback must never launch the current personal-profile package when B was requested.

**Services, receivers, providers:** The host does not directly invoke Messenger's private components. Android launches them normally inside the correct profile when Messenger's legitimate lifecycle, push, or notification action requires it. A profile owner cannot read private Messenger data simply by managing the profile.

Background Activity Launch rules apply even to PendingIntents sent by a third party. Use a visible host Activity and user action; supply current SDK-appropriate sender opt-in where required, preferring visible-only allowance on supported versions. An overlay alone is not a universal Activity-visibility guarantee. Do not auto-open chats from notification callbacks or assume an exception always permits a launch. Android 17 further hardens IntentSender and task interaction. [S11, S12]

## 9. Bubble UI architecture and target states

### 9.1 Surface decision

| Surface | Use in this product |
|---|---|
| Application overlay + `WindowManager` | **Baseline for exact single global bubble**; user grants `SYSTEM_ALERT_WINDOW`; `TYPE_APPLICATION_OVERLAY` on API 26+ |
| Compose | Host account/recent-alert/snippet UI; existing project technology |
| Activity-based panel | Prefer for text entry, IME/back handling and reliable user-driven PendingIntent launch; compact themed window with full-screen fallback |
| Foreground service | Optional host overlay lifetime only; start from explicit foreground user action, Stop action, no immortality guarantee |
| Conversation notification bubbles | Optional per actual observed conversation, using host-owned Activity/shortcut; not a synthetic two-account conversation |
| Android 17 App Bubble | User can bubble the hub Activity from launcher; lower custom-window burden on compatible devices; system controls shape/drag/task behavior |

Notification conversation bubbles on Android 11+ require conversation metadata, `MessagingStyle`, participants, a valid long-lived shortcut, and a suitable resizable/embeddable host Activity. A generic “two accounts” hub is not one human conversation. Do not fabricate a participant or chat to bypass qualification. App Bubbles on Android 17 are a separate system capability. User permission/settings govern bubbles; normal notifications and an ordinary Activity always remain a fallback. [S9, S10, S28]

An Android overlay is **not an Activity container**. Cross-app Activity embedding requires the target app to opt in (trusted host certificates or permitted untrusted embedding); no Messenger opt-in has been verified. Setting the host's `allowEmbedded` or adding an Intent does not override Messenger's embedding policy, and cross-profile launching introduces further restrictions. Android 17 system-bubbled Messenger remains an OS-managed app task, not a Messenger view owned by TwoAccMess. [S8]

### 9.2 User-visible state machine

```text
Hidden / disabled
      |
      v
Collapsed hub bubble <----> Account selector
                                  |
                                  v
                   Recent notifications for account
                                  |
                                  v
                   Observed snippets + optional reply
                                  |
                        Open in Messenger (handoff)
```

- **Collapsed:** One hub glyph; pending-alert badge; drag with edge snap; dismiss target and explicit Stop. Lock screen contains no floating private text.
- **Expanded:** Two account chips with user-selected label/avatar/color plus personal/work badge, observed pending count, and capability status.
- **Account selected:** “Recent notifications — Account A”, sender/chat labels when available, last observation time, coverage warning, and “Open full inbox in Messenger”. Never label it a complete conversation list.
- **Conversation selected:** Header always includes account and source environment. Display “Notification excerpts—not complete chat history”. Unknown content gets “New message; preview unavailable.” Input appears only for a tested, current reply capability; otherwise show “Reply in Messenger”.
- **Switch account:** Back to selector or account chip. Keep separate account-qualified navigation snapshots/drafts. Incoming B events while viewing A update B's badge without changing the active composer.

Show “Selected in hub” as the current-conversation indicator; the host cannot guarantee which Messenger chat is currently visible without a supported API. Opening snippets is not a Messenger read receipt.

Use small edge-docked touch targets (at least 48dp interactive area), insets-aware clamped positions, no full-screen invisible touch catcher, accessible labels, reduced-motion handling, TalkBack navigation, and screenshot/privacy protection. Overlay ComposeViews require explicit lifecycle/saved-state ownership and cleanup; reuse the host composables in Activities rather than leaking detached compositions. Starting footprint: one compact icon; expand only on interaction; hide on sensitive/permission/login surfaces rather than overlaying authentication.

**Instant switching target:** Cached selector/recent-alert switch should have no network dependency. Proposed warm UI target is p95 <100 ms to first updated frame, not a measured claim. Native Messenger cold-start or profile unlock latency is separate and not instant.

### 9.3 Foreground-service honesty

Modern foreground services require a valid type and declared permissions. A persistent overlay may justify `specialUse` with the precise overlay use case documented in the manifest and Play declaration, but eligibility/approval is not guaranteed. Do not label a local overlay `remoteMessaging` (device-to-device continuity) or `dataSync` merely to keep it alive. A system-bound listener itself does not require a permanent host FGS. [S16]

On Android 12+ background FGS starts are restricted. On Android 15+ the overlay-related exemption requires a currently visible overlay in addition to permission; it cannot bootstrap a vanished overlay after a kill. Start the user session while the app is foreground and use compliant restart/notification fallback. Do not silently resurrect an overlay after Force Stop or user Stop. [S12]

## 10. Notification architecture

### 10.1 Source identification and extraction

For each posted/updated/removed notification:

1. Reject host-origin notifications to prevent loops; allowlist only vetted Messenger package/installations.
2. Read the originating `UserHandle` and resolve it to the explicitly bound installation/account generation. Do not infer account from title text.
3. Preserve the source key, notification revision, post time, grouping/summary flags, and package/profile provenance.
4. Prefer structured `MessagingStyle` messages/Person fields, source shortcut metadata when present, and documented extras such as title/text/text lines. Parse defensively, handle redaction/unknown templates, and keep nullable fields.
5. Treat original `contentIntent` and `RemoteInput` actions as short-lived opaque capabilities. Verify their creator package/profile against the source; do not invent replacement routes.
6. Apply deduplication/reducer update; notify host UI and optional mirrored notifications.

Neither a chat title nor the message body is guaranteed. Some notifications have only “new message”, summary counts, attachment descriptions, or no content. Ranking callbacks are not new messages. Multiple messages in a notification update may be a repeated rolling snapshot, not newly arrived distinct messages. Active-notification enumeration after reconnect does not recover dismissed notifications or messages never notified.

### 10.2 Account-aware presentation

Use actual application branding, not impersonation. Android will identify host notifications as **TwoAccMess**, even when content reads:

```text
Messenger — Account A · Personal
Alex: Hey, are you free?

Messenger — Account B · Work profile
Mom: Did you eat yet?
```

- Channel groups: one per account for settings organization.
- Base channels: separate A/B alert channels plus a low-importance hub-control channel; optional per-conversation channels only when a stable route exists.
- Notification `groupKey`: account-scoped, e.g. `hub:<AccountId>`; distinct account summary notifications with `setGroupSummary(true)`.
- Child identity: collision-safe `notify(tag, id)` where the tag includes account + conversation/local alert ID; do not trust hash uniqueness alone.
- Host PendingIntents/shortcuts: explicit component + unique action/data URI and persisted unique route ID, incorporating account/conversation/generation. **Extras alone do not distinguish PendingIntents.** [S17]
- `MessagingStyle`/Person only when actual observed sender/message metadata supports it; otherwise use a normal privacy-safe notification.
- Lock screen default: private visibility plus generic public version; expose previews only by explicit choice and permitted source policy.

**Conversation bubbles:** Publish host-owned, account-qualified long-lived shortcuts only for real observed conversations. Bubble content is the hub's partial notification view. Different accounts' identical source shortcut strings must become different host shortcut IDs. Users may choose multiple bubbles; this mode cannot guarantee exactly one hub bubble. Keep it optional.

### 10.3 Duplicate notification strategy

Default MVP: retain original Messenger notifications and make mirrored host notifications silent, with account labels. This avoids double sound but can leave both original and mirrored entries in the shade. A pure hub-badge mode can avoid reposting entirely if the user prefers, at the cost of no host alert cards.

Do not automatically cancel originals: they may be the only live chat/reply capability, may carry Messenger bubble state, and cancellation can change source behavior without marking a chat read. Do not turn off Messenger's notification permission/channels just to avoid duplication; that can remove the source the hub needs. An optional user-directed configuration can silence original sounds while leaving them posted; test per installation. Exactly-once alert sound and exclusive unified notification ownership across two different apps cannot be guaranteed.

## 11. Realtime event architecture and latency

### 11.1 What each mechanism actually supplies

| Mechanism | Full realtime chat content? | Realtime notification signal? | Practical latency and restrictions |
|---|---|---|---|
| Messenger-owned push | Content usable by Messenger; not a host data API | Yes, if Messenger posts an accessible notification | Usually prompt under favorable conditions; provider/network/Doze/app policy determine delay; no host SLA |
| Notification listener | **No full stream/history**; only supplied snippets/snapshots | **Yes**, posted/updated/removed notifications | Event-driven after post; low local overhead while bound; disconnected gaps, policy/redaction and OEM effects |
| Messenger-owned persistent connection | Real app can update active chats | Indirectly, if it notifies | App-owned transport; host cannot legitimately reuse its credentials/connection |
| Host persistent connection | No published personal Messenger protocol/API | Not for this scope | An FGS/socket creates no access right or stream; adds battery/lifecycle burden |
| App lifecycle/profile observations | No | No new-message signal by themselves | Detect availability/restart context, not inbox changes; host cannot generally observe another app's lifecycle in detail |
| Accessibility events | Only exposed currently visible UI, partial and potentially stale | Some events may signal visible changes | Event-driven but no concurrent complete hidden chat feed; user permission/policy/UI changes dominate |
| Official Meta webhook | Scoped business/Page content/status events, **not personal inboxes or universally complete history** | Yes for subscribed business events | Server event delivery/retries; needs HTTPS backend + Android delivery path; outside chosen scope [S27] |
| Polling | No supported personal endpoint to poll | Could rescan active notifications, without recovering missed data | Adds interval/battery delay; do not use as message transport |

### 11.2 Normalized event contract

```text
NormalizedEvent {
  eventId: UUID
  accountId: AccountId
  installationId: InstallationId
  routeGeneration: Long
  conversationId: ConversationId?          // unknown is valid
  sourceNotificationKey: OpaqueKey
  sourceRevision: LocalRevision
  kind: Posted | Updated | Removed | CoverageChanged
  sender: ObservedParticipant?             // unknown is valid
  message: ObservedContent?                // redacted/absent is valid
  sourceMessageTime: Instant?              // only if published
  notificationPostTime: Instant
  receivedAtMonotonic: Duration
  unread: ObservedAlertState               // not Messenger read state
  coverage: Partial | Disconnected | Redacted | PolicyBlocked
  provenance: Notification | UserAction
}
```

Every accepted event has a resolved account. Unresolved events enter a separate quarantine/diagnostics bucket without send authority; do not guess A/B. Do not require invented sender/message/conversation fields to satisfy normalization. Distinguish notification time, published message time, and local observation time.

### 11.3 Inbound pipeline and backpressure

Source → verified installation/account binding → normalization → bounded local event channel → account-specific serialized reducer → transactional metadata store → Compose state → notification layer.

Keep listener callbacks short (modern callbacks arrive on the main thread); move parsing/encryption/storage off it. Persist routing/dedup state before acknowledging UI state where needed. A transient event bus is not a durable store. Coalesce repeated revisions of the same source snapshot where safe, but do not discard distinct message observations. On overload, explicitly set coverage to degraded and reconcile active notifications; never claim zero data loss.

Normalize group summaries without counting their already represented children twice. Dedup by source installation/key/revision and structured source information; content-only hashes must never merge messages across accounts. Source message fingerprints may only reduce repeated snapshot entries; identical messages can legitimately repeat. If canonical source IDs are absent, **exactly-once message reconstruction is impossible**; preserve uncertainty.

Use a local `pendingObservedAlertCount` (for example, unique unresolved notification/conversation alert entries), not a complete `unreadMessages` total. Grouped/redacted sources may show a dot or “unknown”. Dismissal, cancellation, opening the hub, or switching accounts does not establish a Messenger read receipt. Clear local acknowledgement separately from source notification presence.

### 11.4 Lowest practical latency and measurement

There is **no measured latency** in this investigation and no finite guaranteed end-to-end upper bound when offline, force-stopped, profile-paused, disconnected, or notifications are suppressed. Favorable-condition notification-to-hub latency can plausibly be sub-second, but only device measurements can establish a practical floor/distribution.

Proposed engineering budget: p95 <250 ms from listener callback receipt to updated host badge/preview while the host is running. This is an acceptance target, not a claim about Messenger delivery speed. Measure separately:

1. Test sender's send action → receiver notification observed (synchronized device/test timestamps; record clock error).
2. Listener callback monotonic timestamp → store commit → first UI frame/host post.
3. Account switch action → first correct account frame.
4. Native Messenger launch hot/cold/profile-unlock times.

Report p50/p95/p99, missing observations and reconnect gaps, screen-on/locked/Doze, both accounts, ordinary background transitions, and OEM conditions. Do not omit muted/foreground conversations: they demonstrate why notifications are not a complete message stream. No polling loop, exact-alarm wakeup, or permanent wakelock is proposed.

## 12. Message routing and critical send invariant

### 12.1 Reverse path

User types → capture immutable account/conversation/generation → verify a current source reply capability → explicit send confirmation showing account and target → submit via original Messenger action → record **submitted, delivery unverified** → update from later observed information if available.

For the supported native handoff path: user chooses account/chat → profile-qualified launcher or original click action → user reads/sends in the real Messenger UI. Messenger remains responsible for authentication, encryption, persistence, network retries, and delivery status.

### 12.2 Conditional quick reply

Only enable quick reply after target-version/device validation:

- Original source notification exposes an appropriate free-form text `RemoteInput` action (semantic reply where available).
- Action's `PendingIntent` creator package and creator user match the vetted source installation/profile. Check `getCreatorUserHandle()` as well as package; package-only verification is inadequate for profiles. Android documents PendingIntents as delegated operations under the creator's identity, not as proof of who passed the token or of the hidden logged-in Messenger account. [S33]
- Account binding/generation/source revision remain current; source action remains available and profile is enabled/unlocked.
- The original action is not modified to substitute a package, recipient, or profile. Populate only the documented RemoteInput result keys and submit using the original token.
- A replaced/cancelled/stale action causes failure/refresh or native handoff, never account fallback.
- Account switching does not mutate a previously captured command. Drafts and command IDs remain scoped; do not retry an ambiguous send automatically.

Sending a PendingIntent without error—or its `OnFinished` callback—only establishes action submission, **not server delivery, not a canonical MessageId, not receipt, and not even proof of successful Messenger processing**. A cancelled action is an error; a later notification is not automatically a delivery acknowledgement. Outgoing UI should say “Submitted to Messenger; delivery unverified.”

No quick reply to arbitrary contacts, old threads without current actions, attachments, calls, or new conversations is promised. Read/typing/online state is not supplied by this mechanism. Cross-profile execution of delegated actions is subject to platform/policy behavior and needs real-device verification, not a blanket permission assumption.

### 12.3 Invariants and honest residual risk

1. A host send command never resolves from the globally selected account; it owns its explicit context.
2. A/B composite keys, drafts, notifications, and route tokens cannot collide.
3. Profile/package/action mismatch, uncertain conversation routing, generation change, or unavailable capability → **no send**.
4. Never silently use A because B is unavailable; never choose a recipient by display name.
5. Rebind/logout declaration removes drafts, cached actions, observed snippets, and shortcuts for that binding.
6. Surface delivery uncertainty and prevent background retries that can duplicate a message.

These prevent **host-induced installation/conversation cross-routing**. The host cannot independently prove the hidden current Facebook login or private Messenger action semantics. Absolute “Account A must never send as any other real Facebook identity” cannot be guaranteed if Messenger's account changes invisibly. For a strict deployment, use native Messenger sending only and require user verification there; do not hide this feasibility limit behind local type safety.

## 13. Local-first data model

Conceptual schema, not implementation code or an assertion that all upstream fields exist:

| Entity | Minimal fields and ownership |
|---|---|
| Account | `accountId`, user label/avatar reference, color, current installation binding, generation, enabled state; no Meta credentials |
| Installation | Vetted package, profile serial, user-confirmed installation source, binding generation, capabilities, last capability check |
| Conversation | Composite account/conversation key, nullable source shortcut/reference, observed display title, provenance, coverage, last observation; **not complete inbox** |
| Participant | Composite account/conversation/participant key; observed name/icon if supplied; no contact scrape |
| Message | Composite key, direction/observed sender, nullable text/attachment description, source/local timestamps, provenance, partial/uncertain status; default transient |
| UnreadState | Composite account/conversation key, source-present state, local acknowledgement, observed pending count/unknown; never authoritative Messenger unread |
| NotificationEvent | Account/install/source key/revision, event type, metadata fingerprint, timestamps, removal reason, coverage; raw Bundles not persisted |
| ActionCapability | In-memory original click/reply PendingIntent plus provenance, generation/revision and expiry; refreshed from active source notifications |
| Draft / SendAttempt | Scoped command/context; text transient by default; submitted/failed/unverified; no automatic cross-restart send |
| BubbleState | Collapsed/selector/selected account/conversation, normalized edge position, per-account navigation snapshot, user-enabled session preference |
| CapabilityState | Listener access, posting permission/channels, profile access, overlay allowance, reply availability, coverage gaps |

Composite foreign keys are mandatory. Queries and reducers require `AccountId`; avoid unscoped convenience APIs. Notifications without a stable chat identity are local alert cards, not merged canonical threads. Data loss from unavailable source information remains visible.

**Storage strategy:** Keep default message previews/actions/drafts in bounded memory. Persist encrypted routing, user labels, dedup/coverage metadata and bubble placement in the app sandbox. If optional retained previews are approved, encrypt sensitive payloads and labels with Android Keystore-backed AEAD keys (e.g. platform AES-GCM), using unique nonces and account/conversation/generation as authenticated context. Keystore stores **keys**, not an encrypted database by itself. SQLite/Room plaintext rows, WAL, indexes, backup copies and logs must not leak payloads; either encrypt fields before storage or select and audit a suitable full-database strategy later. Room is not currently a project dependency. [S18]

Use per-account encryption namespaces/keys if persisted payloads exist; no key per message. Authentication-gated keys provide stronger locked-state protection but may prevent background preview processing—choose explicit metadata-only locked behavior rather than weakening authentication silently. Deletion/key destruction is best-effort cryptographic erasure of host copies, not a claim of physical secure deletion from flash or deletion from Messenger.

## 14. Failure and recovery strategy

| Failure | Detection/limitations | Recovery behavior |
|---|---|---|
| Messenger process killed | Host cannot reliably monitor all private lifecycle events | Leave OS/Messenger push/restart path intact; user can launch correct profile; do not restart-loop or promise push when force-stopped |
| Messenger Force Stop | Actions/push may stop; Android 15+ cancels PendingIntents | Disable stale actions, request user launch; no bypass of stopped state |
| Host process killed | Listener reconnect/UI restart; optional exit information on supported API | Restore encrypted bindings/settings; rebuild transient state from current notifications; show missed-coverage interval |
| Host Force Stop/user Stop | No reliable background operation | Respect stop; resume only on explicit user action; Messenger originals still operate |
| Android memory reclamation | UI/activity recreation or process death; Android 17 memory limits | Bounded caches, transactional metadata; no guest engine; reconstruct partial state, never pending sends |
| Session expired/logged out | No supported host authentication status endpoint | Show source capability/coverage, not fabricated login health; user opens correct Messenger to repair and confirms rebind if account changed |
| In-app account switch | Can be invisible to host | Require “Account changed/Rebind”; invalidate context. Strict identity-guarantee users must send in native app |
| Source notification permission/channel disabled | No source events; silence is not proof of no messages | Warn during setup/diagnostics; ask user to check that instance's settings; retain “coverage unknown” |
| Host `POST_NOTIFICATIONS` revoked | Public host permission/channel checks | Do not post mirrored cards; show in-app status; overlay may remain separately permitted; no claim that FGS UI/task-manager presence substitutes for alert permission |
| Notification access revoked/disconnected | Access check/listener callbacks/reconciliation | Invalidate all actions, purge private transient snippets, mark coverage unavailable; explain settings, bounded `requestRebind` only when allowed |
| Work-policy listener denial | B notifications absent despite A functioning; onboarding test/admin policy | Mark B unsupported, no alternate work listener/secret relay; request admin-permitted setup or certified OEM alternative |
| Bubble disabled/dismissed | Notification settings/bubble state are user-controlled | Normal host notification and Activity; do not override user choice |
| Overlay permission revoked | Permission/window failure | Remove windows, stop overlay session service; ordinary Activity/notification fallback |
| Work profile paused/locked/removed | Profile broadcasts/accessible profile state; policy may limit observation | Disable B routes; hide/purge B private mirrored/transient content; prompt user/admin to enable; removal destroys binding generation |
| Background/battery restrictions | Capability tests; some OEM restrictions only user-visible | Explain per-instance/host troubleshooting after measured failure; no mandatory broad battery exemption or endless wakeups |
| Network unavailable | Host has no direct Messenger connectivity oracle | Keep existing snippets explicitly stale; native Messenger handles network/offline send; no fabricated online status or delivery confirmation |
| Messenger UI changes | Only relevant if private/UI automation were used | Core avoids selectors; unknown notification templates degrade to generic alert, native inbox remains fallback |
| Preview missing/redacted | Nullable extraction/capability | Account-specific generic alert; no scraping to recover protected text |
| Two messages simultaneously | Source events may be snapshots/updates/out of order | Per-account serialized reducer, transactional dedup; preserve source timestamps and uncertainty |
| Both accounts receive simultaneously | Separate resolved identities | Independently update A/B groups; active screen/composer stays unchanged |
| Account switch while event arrives | Selection and reducers are separate | Update event's account only; selection transition uses immutable keys, not global routing state |
| Duplicate/update/summary notifications | Source key/revision/grouping metadata | Replace source snapshot, avoid summary+child double counting; no global text dedup |
| Stale conversation/action | Age/source removal/generation change | Show last observed time; disable reply; exact source click if valid else same-profile inbox |
| PendingIntent cancelled/submission ambiguous | Exception or absent confirmation | Explicit failure/unverified state; no automatic resend; user checks native chat |
| Host storage key invalidated/restored backup | Decryption fails/reinstall or device migration | Clear inaccessible host caches and re-onboard; never log ciphertext/plaintext bundles or reconstruct credentials |
| Device reboot/locked boot | Credential-encrypted store unavailable | Metadata-free locked fallback; restore/reconcile after unlock and permitted listener connection; overlay resume only through compliant user flow |
| Retention/disk quota exceeded | Bounded store metrics, database/storage error | Stop retaining new private payloads, show degraded coverage; preserve routing correctness, don't silently drop and report “synced” |

Reconciliation is on reconnect/foreground/profile transitions, not periodic message polling. Notification removal reasons such as lockdown/profile-stop must remove mirrored content, not leak it in a personal-profile archive. [S4, S13]

## 15. Privacy and security model

- **No passwords, tokens, cookies, E2EE keys, credential interception, traffic MITM, private database access, rooted helpers, integrity bypass, or session copying.** Authentication takes place only in official Messenger.
- **Local-only by default.** The hub has no message server, analytics, advertising, remote telemetry or message-content network path. The notification-only MVP need not request `INTERNET`; Messenger handles its own network traffic.
- **Minimal retention defaults:** previews/actions/drafts memory-only, bounded (initial design: up to 100 recent alert cards/account and 15-minute idle draft expiry); no transcript archive. Persist only encrypted routing/settings/dedup metadata with short TTL (initial design: 24 hours for dedup), not content. User-enabled encrypted retained previews, if ever added, need explicit duration/size and deletion controls.
- Treat displayed sender names, avatars, labels, titles, notification keys and URIs as sensitive too. Encrypt retained fields, avoid plaintext indexes containing names, and use keyed local fingerprints if necessary rather than exporting readable keys.
- Exclude sensitive host state from cloud backup and device-transfer rules. The starter currently allows backup; change this before implementing persistence, not as an incidental change during this report.
- Never dump notification Bundles, RemoteInput contents, PendingIntents, message bodies, screenshots, or URLs to logs/crash reports. Diagnostics contain capability state, event counts, coarse timing and opaque local IDs only. No third-party crash service in MVP.
- User permission screens explain notification access broadly, work-profile export, overlay visibility, host notification permission, and each fallback. Granting host notification posting is not granting notification reading; those are separate controls.
- Work-profile content mirrored into the personal host creates an additional personal-profile copy with different lock/DLP protections. Administrator permission is necessary but not enough to ignore privacy. Hide/remove work previews and disable actions when profile unavailable or device locked; process lockdown removals. Public observation of every policy/lock transition cannot be assumed instantaneous or complete: if that cannot be validated, use metadata-only work alerts and no work quick reply. Strict managed deployments should remain metadata-only unless export is explicitly approved.
- Use private/public notification versions and host-window `FLAG_SECURE` where appropriate. These reduce casual leaks, not absolute protection from a compromised OS, another authorized notification listener, or a user photographing the screen. Prefer namespaced neutral icon/label so the app does not impersonate Meta.
- Make action handlers explicit/non-exported except necessary system-bound entry points; validate all inbound IDs. Immutable host navigation PendingIntents; mutable only where a documented RemoteInput flow requires it, with explicit destination and unique identity. Treat original source actions as sensitive capabilities and never share them.
- Overlay is small and visibly host-branded, never used to cover login/security controls or capture credentials. Respect platform tapjacking/overlay-hiding protections.
- Account deletion wipes host state, removes host notifications/shortcuts and destroys applicable payload keys. It does not log out/delete the official Messenger account or delete its history.

## 16. Modern Android constraints and compatibility

| Version/API | Material consequences |
|---|---|
| Android 5/API 21+ | Managed profiles and public profile-aware launcher APIs exist, subject to device/admin support |
| Android 7/API 24+ | Notification inline replies; matches project minSdk but source-app actions are optional |
| Android 8/API 26+ | Notification channels, `TYPE_APPLICATION_OVERLAY`, cross-profile notification-listener policy control; recommended initial supported overlay baseline |
| Android 10/API 29 | Background Activity Launch restrictions; notification bubbles introduced but not a reliable legacy-baseline requirement; low-RAM listener limitations on Android 10 and older |
| Android 11/API 30+ | Targeted package visibility; conversation bubbles need shortcut/conversation metadata; don't declare broad package-query access unnecessarily |
| Android 12/API 31+ | FGS background-start limits, PendingIntent mutability rules, overlay/touch security; special-access setup may be constrained for sideloaded apps |
| Android 13/API 33+ | Host/source notification runtime permissions; cross-app Activity embedding requires target opt-in; an ordinary host has no unrestricted cross-user permissions |
| Android 14/API 34+ | FGS types/permissions, stricter BAL sender opt-in; safer dynamic code loading and non-SDK dependencies burden virtual engines |
| Android 15/API 35+ | Force Stop cancels PendingIntents; private-space lock stops its apps; sensitive/OTP notification redaction; visible-overlay requirement for relevant FGS start exemption; 16 KB native-library compatibility |
| Android 16/API 36+ | More granular visible-only BAL allowance/diagnostics; adaptive UI requirements; verify OEM/background behavior rather than treating earlier versions' behavior as universal |
| Android 17/API 37 | User-managed App Bubbles; per-app memory limits; cross-profile loopback blocked by default; harder reflection/static-final/native dynamic loading; additional IntentSender/activity protections. No new personal Messenger data entitlement |

The workspace targets SDK 37, so Android 17 behavior must be considered from the outset. Android 17 all-app and target-specific changes were checked separately. [S29, S30] Do not lower the target to dodge restrictions. Initial product/device certification should focus on Android 13–17; retain API guards if supporting minSdk 24. If the supported product minimum becomes 26, that is a later explicit build/product change, not performed by this report.

**Reliable native foundations:** profile sandboxing, profile-qualified main-app launch where accessible, account-qualified local state, own UI/notification channels, user-driven notification actions as opaque capabilities.

**Conditional foundations:** permitted listener binding and work notification export; source payload fields; source reply/click actions; enabled/unlocked profiles; overlay/system bubbles; OEM background behavior.

**Fragile/unsupported foundations:** complete chat reconstruction from notifications, private intents/protocols/database access, activity reparenting, arbitrary third-party embedded UI, simultaneous background accessibility scraping, keeping other apps immortal.

**Permission summary:** notification reading → Settings special notification access; host alert posting → `POST_NOTIFICATIONS` on API 33+ plus channels; exact custom global bubble → overlay special access; persistent overlay lifetime → legitimate FGS declaration and policy basis. AccessibilityService is **not needed or requested**. Cross-profile restrictions cannot be bypassed with a manifest declaration of signature/privileged permissions. A managed profile should be provisioned only with explicit consent and ownership compatible with existing device policy.

## 17. MVP implementation plan, priorities, and release levels

### 17.1 Stage 0: smallest real integration proof

Before building a polished shell, create a foreground diagnostic Activity and personal-profile listener that identifies both official installations, records **content-free** capability/timing data, and performs user-driven profile launches. With two user-owned accounts, send test messages to A/B and validate actual source handles, notification templates, policy, background behavior, and optional original reply actions. This is the integration go/no-go gate; fake/demo events are not evidence that Messenger works.

Use a consented existing profile/TestDPC lab setup to validate Android behavior; a production profile-management product is a separate responsibility. Do not build a full DPC or generic installer unless the chosen deployment demonstrably needs it. Do not assume third-party profile managers' current compatibility without evaluating their documentation/licensing and actual target device.

### 17.2 Ordered MVP priorities

| Priority | Deliverable | Honest acceptance condition |
|---|---|---|
| 1 | Main floating bubble | One draggable/dismissible hub overlay on certified device, or explicitly chosen Android 17 App Bubble; graceful no-permission Activity fallback |
| 2 | Two-account selector | Distinct labels/avatars/profile badges; verified independent source bindings |
| 3 | Account unread indicators | Correct observed pending-alert state; “unknown” on coverage loss; no claim of full unread count |
| 4 | Conversation list | Notification-derived recent entries + full-inbox native handoff, clearly labeled partial |
| 5 | Conversation view | Observed snippets only; no generated full transcript; correct account header |
| 6 | Notification aggregation | Account-specific groups/channels, silent mirrors, privacy-safe lock screen, no self-loop |
| 7 | Account switching | Cached A/B UI switches without route/draft mutation; measured warm-switch timing |
| 8 | Realtime handling | Source callback-driven updates + reconnect reconciliation; report measured latency/gaps |
| 9 | Sending | Native Messenger launch is MVP baseline; enable hub quick reply only after separate source/action/account tests |
| 10 | Persistence/recovery | Encrypted minimal metadata, transient content/actions, restoration after ordinary process death with partial-coverage warning |

Do not introduce a virtualization SDK, hidden APIs, credentials, app scraping, or a custom Messenger transport to “complete” a missing row.

### 17.3 MVP success definition

On explicitly supported device/policy configuration:

- A and B are separate official Messenger environments with independently maintained sessions/data.
- One host entry opens the correct account environment without falling back to the other.
- Every observed alert/snippet/local conversation is associated with the correct profile/account binding.
- Visible account badges count observed pending alerts without cross-contamination or inflated summary counting.
- Switching host context is fast and measured; simultaneous events do not redirect drafts or sends.
- Original Messenger reading/sending works in the selected native environment; conditional hub quick reply is clearly marked if supported.
- Ordinary foreground/background and host process-death transitions preserve bindings/settings, reconstruct current alerts and expose coverage gaps.
- Permission/profile denial produces a useful disabled state, not a falsely functioning two-account UI.

This succeeds as a **notification-and-navigation MVP**. It does not prove embedded full conversations or reliable observation of every message.

### 17.4 V1, V2, Advanced

**V1 — Harden the cockpit:** validated conditional quick reply, robust original-action refresh, privacy modes, per-account mute settings, improved redacted/grouped notification handling, measured reconnect/recovery, diagnostics and certified Android/OEM matrix.

**V2 — Better supported floating/native access:** Android 17 App Bubble onboarding, adaptive large-screen cockpit, optional proper per-conversation bubbles, explicit account/profile health and keyboard/accessibility polish. Test managed-profile Messenger floating windows without promising a merged task. Optional notification-derived search only over retained approved snippets, clearly not full Messenger search.

**Advanced — Only with a materially different supported contract:** Meta partner/cooperative embedding and personal messaging entitlement if ever offered, or a separately approved Page/business inbox product using official APIs/webhooks. Neither is assumed to exist for the current personal-account requirements. Do not quietly escalate to private protocol reverse engineering or accessibility automation as a version upgrade.

### 17.5 Verification plan through the real user interface

Implementation must run Gradle compilation, JVM tests, lint, and device instrumentation against the final changed files. Those validate host code, not Messenger integration. Device acceptance includes:

- A/B receive visibly identifiable test messages; inspect both source and mirrored cards, then open from bubble/account list.
- Identical conversation titles/shortcut IDs and identical message texts across accounts remain separate; repeated identical messages within one chat are not accidentally erased.
- A/B replies use distinct source actions; verify receiver-observed sending account in real Messenger. No source action → reply disabled. No source content → generic alert.
- Swap accounts while both receive and while a draft exists; replace/remove source notification during confirmation; invalidate binding generation before submission.
- Test logout/in-app account change and document inability to detect it automatically; strict configuration disables hub sending.
- Test grouped/summary updates, muted chat, active foreground chat, outgoing messages on another device, attachments, deleted/unsent/disappearing messages, read on another device, redacted OTP notifications. These must not be presented as fully synchronized history.
- Revoke each permission/channel separately; deny work notification policy; pause/lock/remove profile; reconnect listener; reboot; device lock/lockdown; kill versus Force Stop; overlay Stop; network loss/Doze/overnight battery conditions.
- Verify private work content is removed from mirrors/cache when unavailable and never included in logs/backups; fuzz nullable/malformed/large Bundles without logging payloads.
- Measure callback-to-render and user-switch distributions plus missing source events; inspect real device screen/notifications, not just a successful APK build.

Acceptance threshold for local routing tests: **zero cross-installation/cross-conversation dispatches** under generated interleavings; fail closed on every ambiguous route. This does not remove the separate hidden-Facebook-identity limitation.

## 18. Risks, legal/platform questions, and go/no-go conditions

| Risk | Severity | Mitigation / stopping condition |
|---|---|---|
| No supported personal-account inbox/stream API | Critical | Publish reduced notification scope; stop if full embedded inbox remains mandatory |
| Work export/admin restriction | Critical | Capability gate; no bypass; configuration unsupported if B unavailable |
| Wrong hidden login vs configured label | Critical | Explicit rebind/one-account operating rule; native-only send if strict identity verification required |
| Reply token identity/semantics or expiry | High | Original token + verified creator/profile + generation/revision; conditional device validation; disable on uncertainty |
| Notification gaps/redaction/grouping | High | Partial coverage/unknown counts; original Messenger fallback; no fake full history |
| Overlay/FGS/Play eligibility | High | Explicit user session, correct type/disclosure; Android 17 user-bubbled hub/ordinary Activity fallback |
| User expects embedded Messenger | High | UX language and product boundary shown before permissions; do not disguise native handoff |
| Work plaintext copied into personal host | High | Policy/consent, metadata-only strict mode, no persistent previews by default, purge on lock/unavailability |
| Messenger update changes notifications/actions | Medium–High | Structured parser, capability matrix, unknown-template fallback, canary account tests |
| OEM/profile/push differences | Medium–High | Certified devices, measured overnight tests, no broad guarantee |
| Proprietary cloning/license obligations | High if added | Do not integrate; old public source is evidence, not approved dependency or proof of compatibility |

Technical feasibility is separate from legality. Using public Android APIs with informed user/admin permission does not by itself establish a legal right to redistribute modified Meta software, scrape private messaging, use Meta branding, or violate applicable platform terms. Local law, account eligibility, privacy consent, contractual terms and store review need separate qualified review. **No legal certification is made here.** The selected approach avoids modified APK distribution and security bypasses, reducing—not eliminating—these risks.

## 19. Maintenance considerations

Keep the maintenance surface in supported host APIs rather than guest-framework interception:

- Version source parsing/capability behavior by measured Messenger version and Android/OEM configuration. Never log message content for remote diagnosis.
- Re-test account-qualified launch and actions after Messenger, Android, profile policy, targetSdk, and dependency changes.
- Watch Android 17+ App Bubble behavior, FGS/overlay rules, notification redaction, profile availability and Activity/PendingIntent hardening.
- Preserve route-generation migrations; stale intents/shortcuts after reinstall/profile recreation must not attach to a new account.
- Limit channels/shortcuts/caches; prune expired host data while respecting user-pinned conversation preferences.
- Keep the actual instance running official updates; do not pin a vulnerable old APK to preserve a private integration.
- Maintain an explicit support matrix and degraded mode, rather than declaring all modern Android devices compatible.
- Re-evaluate Meta's **published** API scope if it changes; business feature availability is not evidence of personal API access.
- If future design introduces network services, databases or integration vendors, evaluate their documentation/privacy/credentials separately; no such service is selected or provisioned here.

The principal remaining Messenger coupling is its **notification payload and original action semantics**. There is no dependence on internal database schema, private Activities, UI selectors, decrypted protocol traffic, or a cloning runtime.

## 20. Final feasibility verdict: six explicit answers

### Question 1 — Can a third-party Android app legally/technically provide a fully embedded, independently functioning UI for two personal Messenger accounts?

**Not as a reliably supported solution under the investigated public interfaces.** Two independently authenticated official instances are technically achievable with profile isolation. A full third-party embedded personal-account Messenger client is not: private sandbox data/transport is unavailable, cross-app embedding requires target cooperation, and none was verified. Android 17 allows **system-managed** floating apps; that is not host-controlled embedded UI. Experimental virtualization/web/UI observation may demonstrate portions but cannot establish the requested reliability or legal authorization. Legality is jurisdiction/terms dependent and requires review; absence of an API is not itself a universal statement of illegality.

### Question 2 — Can it reliably obtain the COMPLETE conversation list and COMPLETE realtime message stream from both personal accounts?

**No through the documented mechanisms investigated.** Notifications expose selected app-published content, not full history, all chats, muted/foreground events, outgoing events, deletions, edits, receipts, or authoritative unread state. Accessibility sees exposed visible UI, not a complete concurrent background stream. Official published messaging APIs target Pages/professional business contexts, not these personal inboxes. E2EE/session storage remains within Messenger; the host does not extract keys/tokens. Meta explicitly distinguishes private personal E2EE messaging from business/non-personal messaging. [S31]

### Question 3 — Can it send messages through both accounts?

**Yes via user interaction in each correctly launched official Messenger instance. Conditionally from the hub via a live original notification `RemoteInput` reply action**, if Messenger and the device/policy expose and execute that action correctly. No general personal-account Send API, arbitrary-thread send, or delivery acknowledgement is established. The hidden-account-change limitation means the host cannot independently guarantee the configured Facebook identity at each send; strict deployments use native Messenger sending.

### Question 4 — Which parts can be implemented reliably using Android-native mechanisms?

Native profile data/process isolation; independent official login; explicit account-qualified host state; account selector; custom overlay when permitted; own Compose UI; profile-specific main-app launch where accessible; account-aware own notification groups/channels; permitted notification callbacks; observed-alert badges; local persistence and ordinary recovery. Each special permission/profile policy remains an explicit condition, and no background permanence or full message coverage is guaranteed.

### Question 5 — Which parts depend on Messenger internals and may break after updates?

In the selected approach, notification structure, shortcut/thread metadata, preview availability, notification creation/suppression, action presence, action semantics, and cancellation behavior remain Messenger-dependent. The approach deliberately avoids private UI selectors, database schemas, protocols, APK rewriting, and framework hooks; adding those would sharply increase breakage/security/policy risks. Complete host conversation identity or send confirmation is not inferred from internal behavior.

### Question 6 — Which architecture gives the closest UX without building a full virtualization platform?

**Two official profile-isolated Messenger installations + one personal-profile notification/navigation cockpit + one overlay hub bubble, with optional validated notification replies and Android 17 system-bubble support.** Full inbox/history stays in the official app. If reading/sending in a floating window is more important than exactly one host-owned bubble, the user can evaluate Android 17 system-bubbled Messenger A/B on a compatible device; it still does not produce one merged host-controlled inbox.

### Final simplified architecture

```text
                    ONE TWOACCMESS HUB BUBBLE
                selector · observed alerts · previews
                     no complete chat transcript
                           /             \
                  Account slot A       Account slot B
                  personal binding     managed-profile binding
                           \             /
                     account-qualified router
                    /                       \
          original click/reply        original click/reply
          or profile launcher         or profile launcher
                    |                       |
          OFFICIAL MESSENGER A      OFFICIAL MESSENGER B
          personal-profile UID     managed-profile UID
          private session/data A   private session/data B
                    \                       /
                     ANDROID SYSTEM / POLICY
                  sandbox · lifecycle · notifications
                              |
                   PERSONAL-PROFILE HOST LISTENER
                   permitted notifications only
                              |
                       hub state + account groups
```

**Bottom line:** Build a small two-account cockpit, not a Parallel Space clone. The OS can isolate the sessions. The hard boundary is supported access to personal Messenger data and cooperative UI integration, not how much app cloning code can be removed.

---

## Sources and evidence ledger

Sources were accessed during this investigation. Documentation may change; release/device claims require checking the actual shipping configuration. API-reference pages exceeding the fetch limit were cross-checked using official guides and AOSP source; no inaccessible page is treated as runtime validation.

- **S1 — Android work-profile behavior, storage/intents, listener location and work-notification allowlisting:** https://developer.android.com/work/managed-profiles
- **S2 — AOSP multi-user/profile types, clone-profile OEM requirements, full-user notification differences:** https://source.android.com/docs/devices/admin/multi-user
- **S3 — AOSP `LauncherApps` public main-activity/profile APIs versus shortcut/hidden-profile restrictions:** https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/content/pm/LauncherApps.java
- **S4 — AOSP `NotificationListenerService`, binding lifecycle, work-profile/low-RAM exceptions and lockdown removal:** https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/service/notification/NotificationListenerService.java
- **S5 — Meta Messenger Platform scope/prerequisites/permissions:** https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview
- **S6 — Meta Conversations API, Page/professional scope and documented history limitations:** https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversations
- **S7 — Meta Send API scope, Page token/scoped recipients and messaging window:** https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages
- **S8 — Android cross-application Activity embedding opt-in/trust model:** https://developer.android.com/develop/ui/views/layout/activity-embedding#cross-app-embedding
- **S9 — Android notification bubble requirements/lifecycle and Android 17 windowing note:** https://developer.android.com/develop/ui/compose/notifications/bubbles
- **S10 — Android 17 release/App Bubbles, memory and runtime changes:** https://developer.android.com/blog/posts/android-17-is-here
- **S11 — Android Activity security, BAL/PendingIntent/IntentSender opt-ins:** https://developer.android.com/guide/components/activities/secure-bal
- **S12 — Foreground-service background-start restrictions, including visible overlay on Android 15+:** https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- **S13 — Android 15 stopped state/PendingIntent cancellation, private space, notification redaction, native page-size changes:** https://developer.android.com/about/versions/15/behavior-changes-all
- **S14 — Android AccessibilityService purpose, visible UI observation and actions:** https://developer.android.com/guide/topics/ui/accessibility/service
- **S15 — Google Play AccessibilityService disclosure/declaration and automation policy:** https://support.google.com/googleplay/android-developer/answer/10964491?hl=en
- **S16 — Foreground-service type definitions, specialUse review, remoteMessaging scope:** https://developer.android.com/develop/background-work/services/fgs/service-types
- **S17 — Android notification permission, inline reply, PendingIntent collision warning:** https://developer.android.com/develop/ui/compose/notifications/create-notification
- **S18 — Android Keystore key protection and authentication/security trade-offs:** https://developer.android.com/privacy-and-security/keystore
- **S19 — Equivalent VirtualApp architecture and public-code maintenance disclaimer:** https://github.com/asLody/VirtualApp/blob/master/README_eng.md
- **S20 — VirtualApp storage namespaces:** https://raw.githubusercontent.com/asLody/VirtualApp/master/VirtualApp/lib/src/main/java/com/lody/virtual/os/VEnvironment.java
- **S21 — VirtualApp virtual UID/user identity:** https://raw.githubusercontent.com/asLody/VirtualApp/master/VirtualApp/lib/src/main/java/com/lody/virtual/os/VUserHandle.java
- **S22 — VirtualApp application binding, I/O redirect, provider and receiver handling:** https://raw.githubusercontent.com/asLody/VirtualApp/master/VirtualApp/lib/src/main/java/com/lody/virtual/client/VClientImpl.java
- **S23 — VirtualApp manifest stub-slot naming:** https://raw.githubusercontent.com/asLody/VirtualApp/master/VirtualApp/lib/src/main/java/com/lody/virtual/client/stub/VASettings.java
- **S24 — VirtualApp virtual-user-qualified Activity launch and stub wrapping:** https://raw.githubusercontent.com/asLody/VirtualApp/master/VirtualApp/lib/src/main/java/com/lody/virtual/server/am/ActivityStack.java
- **S25 — VirtualApp guest process startup, service records and provider routing:** https://raw.githubusercontent.com/asLody/VirtualApp/master/VirtualApp/lib/src/main/java/com/lody/virtual/server/am/VActivityManagerService.java
- **S26 — VirtualApp notification tag/user mapping:** https://raw.githubusercontent.com/asLody/VirtualApp/master/VirtualApp/lib/src/main/java/com/lody/virtual/server/notification/VNotificationManagerService.java
- **S27 — Meta webhook content/events, server requirements and retry behavior (business scope only):** https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks
- **S28 — Android conversation notifications and long-lived shortcut requirements:** https://developer.android.com/develop/ui/views/notifications/conversations
- **S29 — Android 17 all-app changes including memory limits and cross-profile loopback restrictions:** https://developer.android.com/about/versions/17/behavior-changes-all
- **S30 — Android 17 target-specific runtime/dynamic-loading/Activity changes:** https://developer.android.com/about/versions/17/behavior-changes-17
- **S31 — Messenger privacy/E2EE distinction between personal and business messages:** https://www.messenger.com/privacy
- **S32 — AOSP work-profile implementation, native UID/data and account separation:** https://source.android.com/docs/devices/admin/managed-profiles
- **S33 — AOSP PendingIntent delegated identity, creator identity and Intent matching semantics:** https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/app/PendingIntent.java

## Verification record and unresolved evidence

**Verified for this report:** workspace starter/configuration inspected; official Android/Meta guides read; named equivalent-engine source mechanisms inspected; architecture compared across A–H; scope, routing/privacy invariants, failure cases, all six verdict questions and diagrams documented. This report's artifact/coverage/link structure is checked separately before delivery.

**Not verified:** current Parallel Space binary implementation; actual Messenger version/templates/action behavior; real two-account login/push; work-profile policy on the intended phone; cross-profile click/reply execution; Android 17/OEM App Bubble behavior for managed apps; Play approval; latency, battery, memory or complete integration tests. No APK build, typecheck, emulator/device tests or application implementation are claimed for this documentation-only task.

**Engineering recommendation:** approve the honest notification-cockpit scope, then run the real-device capability proof before committing to the UI MVP. If complete embedded personal-account chat is mandatory, the correct result is **no-go under the currently documented supported interfaces**, not a larger cloning engine.
