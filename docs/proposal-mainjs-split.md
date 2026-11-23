# Proposal — how to split `desktop/src/main/main.js`

**Status:** proposed, **deferred** to a session of its own. Measured 23 November 2026; nothing was moved.

## Why it is not a file-scissors job

`main.js` is 3 660 lines and every region of it closes over module-level state. Measured closure
surface (symbols a region reads or writes from the module scope) for the largest functions:

| Function | Lines | Closes over | Of which mutable |
| --- | --- | --- | --- |
| `smokeRun` | 918 | 52–84 | 15 (`state`, `alerts`, `shellWindow`, `uiView`, `bubbleWindow`, `notesSync`, …) |
| `registerIpc` | 371 | 60 | 11 |
| `spaceView` | 193 | 30 | 2 |
| `saveSettings` | 101 | 53 | 4 |
| `startPortableJanitor` | 97 | 54 | 7 |
| rest cycle (its own block) | ~120 | 16 | 3 (`openSpaceId`, `shellWindow`, `restTimer`) |

Cutting any of these out as-is produces a module with a 30-to-80-member parameter list, and the
mutable ones cannot be parameters at all — `openSpaceId` and `shellWindow` are *reassigned* in
`main.js` and read by the regions, so they would have to become accessor functions on whatever seam
exists. That is the refactor. The file split is what follows it.

Doing it at the end of a long change session is exactly how a "pure refactor" quietly stops being
one, and this repository's standard for the claim is the 51-step real-Electron smoke plus the
1 167-case suite, both green on both sides of the change.

## The order that keeps every step provable

1. **Introduce the seam.** A single `context` object built in `main.js` and passed down: `{ state,
   getOpenSpaceId, setOpenSpaceId, spaceViews, shellWindow, uiView, alerts, saveSettings,
   broadcast, spaces, watcher, retryTimers, notes, tray, bubble }` plus getters for the mutable
   members. No behavior change; the suite and the smoke both stay green as the seam is threaded
   through one region at a time.
2. **Extract the rest cycle first** (~120 lines, 16-symbol closure, its own state maps: `restRunStart`,
   `restUntil`, `restUrls`). It has a natural boundary and one inbound edge from `openSpace` (waking a
   resting space). New module: `desktop/src/main/rest-cycle.js`.
3. **Extract the watcher runner** (`runWatcher`, `scheduleWatcher`, the tick, the alert debounce) into
   `desktop/src/main/watch-runner.js`. `watched-page.js` (the page reading) is already out.
4. **Extract window management** (`createShellWindow`, `layout`, `applyLayoutMode`, the bubble/dock
   glue) into `desktop/src/main/windows.js`. This is the widest one; do it last and in two commits.
5. **Extract IPC registration** (`registerIpc`, 371 lines) into `desktop/src/main/ipc.js` once the
   regions it calls are modules of their own.
6. **Move `smokeRun` (918 lines) out of the product file** into `desktop/verify/source-smoke.js`.
   It is verification machinery and belongs with the other harnesses; after this, `main.js` carries no
   smoke code at all, which is also the sharpest form of the "packaged build contains no smoke
   harness" guarantee.

Each step is its own commit, with the suite and the smoke green before and after it, and the file
sizes recorded in the commit message so the direction is visible.

## What is deferred, and the trigger

All of it, in this session. The measured reason is the closure table above: there is no small first
cut, and the seam in step 1 must exist before any cut is honest. The trigger is a session that can
run the 51-step smoke and the full suite on both sides of each step without rushing —
roughly half a day.

Until then `main.js` keeps working the way it does now, and the tests and docs written in this round
keep pinning its behavior.