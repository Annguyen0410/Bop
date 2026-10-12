# Bop — the 10-second round-robin unread scan

The request this round answers: sweep every space on a 10-second cycle, **ignore chats the user muted
on the website**, keep a real per-space unread number, and post a card only for new *unmuted* unread.

This round delivers the **scan core and its rules**, unit-tested on the JVM. It does **not** deliver an
end-to-end badge or card yet, and the reason is architectural, not effort: see *What is still missing*.

## Implemented

[`SpaceScan`](../app/src/main/java/com/example/twoaccmess/SpaceScan.kt) — no Android types, so the whole
decision path is testable without a device (same split as `HubReducer`, `WebSessionReport`,
`HubReliability`).

- **Tick and sweep.** `TICK_MS = 10_000`. One space is read per tick, round-robin, so a tick costs one
  page's work instead of N. `sweepMs(N) = N * 10_000`: **a full sweep over N spaces takes N ticks, so
  each space is re-read inside that window — 10 seconds is the tick, not the per-space interval.**
- **Round-robin by identity.** `Cursor` remembers the last space by `AccountId`, not by index. With
  `[A, B, C]` stopped at B and A removed, an index cursor lands back on B and leaves C unread for a whole
  turn; identity resumes at C. Pinned by `removingASpaceMidSweepNeitherSkipsNorRepeatsAnother`.
- **Mute filtering before any comparison.** `Reading(unread, muted)`; `unmuted = max(unread - muted, 0)`,
  and every rule runs on `unmuted`. A message arriving in a muted thread is `NONE` — no card. A source
  that *cannot* see the mute state reports `muted = null` and the reading is labelled
  `mute state unknown` instead of passing a raw total off as filtered.
- **The unread rules**, mirroring `WebUnread.Watch` deliberately: first reading `BASELINE`, growing
  `RAISED` (the only move that may raise a card), zero after unread `CLEARED`, shrinking `UPDATED`,
  identical `NONE`. Cap `WebUnread.MAX`.
- **Per-space memory.** One `Watch` per space inside `Sweep`; `forget(space)` drops one baseline when its
  page is replaced (reload, sign-in, app switch) without disturbing the others.
- **Reader seam with failure isolation.** `interface Reader { fun read(space): Reading? }` is the
  per-site adapter contract. `null` means "cannot see the page right now" (signed out, suspended, no
  adapter) and changes nothing. A thrown `Exception` is caught, recorded **by class name only** and
  reported as `UNAVAILABLE`; one broken adapter cannot stop the other spaces from being checked.
  Only a class name crosses into the status line, never a message that could carry page text.
- **Diagnostics line** (`SpaceScan.detail`), one line, no `=`, ≤ 400 chars, shaped like
  `WebUnread.detail`, so it can go into the same session status file.

### Tests

15 JVM tests in
[`SpaceScanTest`](../app/src/test/java/com/example/twoaccmess/SpaceScanTest.kt) cover the sweep order, the
identity cursor with a shrinking slot list, the unmuted baseline rules, a muted arrival staying quiet, a
source that admits it cannot see mute state, an unreadable page leaving the baseline alone, a throwing
adapter, per-space isolation, `forget`, the cap, rejected negative counts, and the status-line shape.

```
./gradlew :app:testDebugUnitTest      # full suite: 121 tests, 0 failures/errors/skips
./gradlew :app:testDebugUnitTest --tests "com.example.twoaccmess.SpaceScanTest"   # 15 tests
```

Raw log: [jvm-tests.txt](evidence/scanning/jvm-tests.txt). No APK was assembled this round.

## The in-page reader and its descriptor for every app

[`unread-reader.js`](../app/src/main/assets/unread-reader.js) is a dependency-free file injected into a
space's own page with `evaluateJavascript`. It answers one question — *how much unread, and how much of
that sits in threads the user muted* — and it carries **one descriptor per catalog app** (all 19 ids in
[`HubApps`](../app/src/main/java/com/example/twoaccmess/HubApps.kt)). A descriptor says where to look
(`row`, `unread`, `muted`, `count`, optional `empty`); the file only decides how to count. Adding a site
is therefore a data edit, not a new code path.

**The refusal rule is the part that matters.** A descriptor carries `evidence`. While evidence is null
the reader returns **null** and never tries the selectors anyway, because a guessed selector does not
fail loudly — it matches nothing and reports `0 unread`, which is indistinguishable from "everything is
fine" in a product whose entire job is not missing a message. `null` means "cannot see right now"; the
sweep keeps the previous baseline and raises nothing. That is why every one of the 19 catalog apps is
currently registered as `mode: 'title'` (the honest signal it already has, read natively by
[`WebUnread`](../app/src/main/java/com/example/twoaccmess/WebUnread.kt)) and **no** app claims DOM
readiness without evidence. A test enforces exactly that.

The reading travels back in the same `key=value` shape the rest of the app uses (`unread=7\nmuted=2`),
parsed by [`SpaceScan.decode`](../app/src/main/java/com/example/twoaccmess/SpaceScan.kt). The literal is
pinned by a test on **each** side, so a silent format mismatch cannot look like "no unread anywhere".

### How the DOM path is verified without a signed-in account

[`unread-fixture.html`](../desktop/test/fixtures/unread-fixture.html) is a local chat page implementing
exactly one descriptor's markup, including the case no real site can be asked to demonstrate on demand:
**a message arriving in a muted thread**. [Its tests](../desktop/test/unread-reader.test.js) run the
real reader against the real HTML through a real DOM (jsdom — added as a dev dependency for this file,
because a hand-written fake DOM would only prove the fake):

- the fixture reports `unread: 5, muted: 2`, so the unmuted number a card may use is 3;
- a muted arrival moves the total and leaves the unmuted number unchanged — no card;
- a descriptor without evidence refuses, a page with no rows refuses unless an `empty` selector proves
the inbox is empty, and an unparseable selector refuses instead of throwing;
- a dot badge counts once, an attribute-carried count is read from the attribute, and an absurd badge is
  capped at `WebUnread.MAX`;
- the payload literal matches the one Kotlin decodes, and **every catalog app has exactly one descriptor**
  (drift between the JS table and `HubApps.kt` fails the test).

13 Node tests, and the whole desktop suite is 64/64. Raw output:
[reader-tests.txt](evidence/scanning/reader-tests.txt). The asset is packaged (`:app:mergeDebugAssets`,
exit 0) and the Kotlin side is 124 JVM tests, 0 failures.

### The real-engine experiment

jsdom proves the counting rules; it cannot prove that the file which actually ships loads and answers
inside a browser engine. [`reader-smoke.js`](../desktop/src/main/reader-smoke.js) (`npm run smoke:unread`)
does that: it starts a real Electron/Chromium window, loads the fixture page, injects **the shipped asset
read from the app** (never a copy that can drift) through the same `executeJavaScript` call shape the app
uses, and checks the answers. Result: **7/7 steps**, exit 0,
[report](evidence/scanning/reader-smoke.json).

**Two real bugs this found, both in the shipped asset and both fixed:**

1. A descriptor asking for the number in an attribute (`count: 'attr:data-count'`) fell back to the
   dot rule when the attribute was gone, so missing markup was reported as **"1 unread" — an invented
   message**. Now a promised-but-absent number refuses the whole page: markup drift must look like
   "cannot read", never like a message.
2. `encode` turned a reading that had lost its muted count into the string
   `unread=5\nmuted=undefined`, which parses as nothing and travels as garbage. It now refuses to
   encode a partial reading at all.

Both fixes are pinned by tests (Node side) and by the Chromium run, and one more test now reads
`WebUnread.MAX` out of the Kotlin source to make sure the two caps cannot disagree.

This proves the mechanism, the counting rules and the refusal rule. It proves **nothing** about any real
service's markup.

## Conflicts to resolve before anything ships

The four places below currently promise the *opposite* of a continuously-checking web watchdog and are
user-visible or legally binding — they must be rewritten deliberately, not quietly:

| Where | What it promises today |
| --- | --- |
| [`PRIVACY.md`](PRIVACY.md) | "not an injected script, JavaScript bridge, **DOM observer, repeating timer** or network poll" |
| In-app Guide, [MainActivity.kt](../app/src/main/java/com/example/twoaccmess/MainActivity.kt) | "never from background web polling" |
| [`WebUnread.kt`](../app/src/main/java/com/example/twoaccmess/WebUnread.kt) header | "No script, timer, DOM scan or network request" |
| [`AndroidManifest.xml`](../app/src/main/AndroidManifest.xml) FGS subtype | "**no background scraping** or Messenger process keepalive" |

Shipping the reader also means re-declaring the foreground-service purpose and answering Data safety
accordingly, since a repeating in-page check is exactly what those four lines disclaim.

## What is still missing

**Nothing is wired, and it cannot be wired the obvious way.** Each web slot runs in its own process
(`:messenger_o`, `:messenger_p`, and `DynamicWebActivity` in the hub's own process; see
[`AndroidManifest.xml`](../app/src/main/AndroidManifest.xml)). A hub-process timer cannot read another
process's `WebView`, and a reading needs the page's own DOM. So the shape has to stay:

1. the space's own process produces a `Reading` (an adapter that can actually see that site's markup),
2. it crosses the process boundary as a slot plus numbers — exactly the path `WebAlertReceiver` already
   uses for tab titles,
3. the hub merges it through `SpaceScan` and decides the badge/card.

Missing pieces, in order of what blocks what:

| Missing | Consequence today |
| --- | --- |
| No *verified* selectors for any real site | every app is `mode: 'title'`, so `muted` is unknown for all of them and **mute filtering does not actually run** |
| No 10-second driver in the space process | no sweep happens at all; the hub still runs on `WebUnread` title events |
| No IPC for scan readings | a reading cannot reach the hub process |
| No per-space unread badge / card from `Outcome` | `HubReducer.webReading` still builds the card from the title path |
| No logged-in account, no validated markup | any selector written now would be a guess; the repo's rule is not to guess |

Also unchanged: **10 seconds is not a schedule Android guarantees while the screen is off.** Doze
suspends CPU and network, so a screen-off sweep is best-effort at best. Nothing here claims otherwise.

## Acceptance criteria for the next round

1. One real site's descriptor is filled in from a signed-in page, marked with the evidence that
   promoted it, and pinned by a fixture captured from that page (never against live network in a test).
   The mechanism it plugs into is already verified: 11 DOM tests, all 19 apps registered, refusals tested.
2. A space process drives `Sweep.step(slots)` every 10 s while its page is alive and posts each `Step`
   across the boundary; the hub applies it through the existing `mutate` path.
3. A message in a website-muted thread produces **no** card, and an unmuted one produces exactly one.
4. Screen-off behaviour is measured and reported: how many of the expected ticks actually happen inside
   15 minutes with the screen off, and what the per-space freshness turns out to be.
5. The badge shows the per-space unmuted number, and the card says what it is: an aggregate count, not
   message IDs.

A local fixture page (chat list with mute, unread and read states) is the cheapest way to satisfy 1–3
without a real account, and it is the only way to test mute filtering on purpose rather than by luck.
