# Decisions log

Product and engineering decisions taken while working on this repository, with the reasoning and what
would change the answer. Newest last.

## 2026-11-23 — Desktop: which Electron the app runs on

The app runs **Electron 45.4.1, pinned exactly** (Chromium 156, Node 24.22.3). Chromium *is* the
security boundary here — every web account runs inside it — and the supported window is the release
train, not a version from which the window has passed. The pin is exact rather than a range because
"a new major appears" is an event a maintainer should see, not one that should arrive silently.
Choreographer, the Electron-free screenshot oracle, is version-agnostic and stays.
*Changed by:* an Electron or Chromium advisory against 156, or 45 leaving the supported window.

## 2026-11-23 — Which page titles wake the desktop

`social` and `mail` titles feed title monitoring; `ai` titles do not, because the AI tool has no
unread badge and the desktop would be woken for nothing. This matches the Android behavior
(`MessengerWebActivity` reports both kinds); before this round the desktop only looked at `social`.
*Changed by:* a mail kind that stops carrying unread state in the title, or an AI kind that starts.

## 2026-11-23 — What a watch actually reads

An empty or dead selector falls back to the whole page text, capped at 20 000 characters, and phrase
matching is case-insensitive against the title plus that text. The narrow reading ("only inside a
matching selector") is the safer theory, but changing it would silence every quiet watch that already
exists and teach people that saved filters have an expiry date. The semantics are documented in the
Edit dialog, the Guide and the README, and are pinned by tests instead.
*Changed by:* evidence that the wide read causes the false alarms it was suspected of.

## 2026-11-23 — The notes server is a local citizen

The LAN notes listener binds loopback plus this machine's private interfaces — never `0.0.0.0`, and a
public bind is refused — and accepts a bounded number of connections per peer and in total. The wire
protocol is unchanged, so the Android client needs no change. Windows may show a firewall prompt the
first time; the README and `docs/PRIVACY.md` say so rather than leaving users to meet it alone.
*Changed by:* nothing foreseeable; this is the shape the feature should have had from the start.

## 2026-11-23 — Verification tooling is not part of the product

The source tree can run smoke, monitor and retry harnesses through `--bop-*` flags; a packaged build
cannot — the flags are ignored with a log line, the harness files are not in the release set, and the
settings codec refuses to write plaintext while packaged. A build people install should not carry
test machinery that speaks to `shell` and captures windows.
*Changed by:* a product decision to ship a diagnostic mode on purpose, which would need its own
review.

## 2026-11-23 — Where `experiments/**/evidence` should live — deferred

19 MB of lab captures live in `experiments/bubble-waitroom/evidence/`, tracked in git and therefore
also in history. The plan is in `docs/proposal-evidence-storage.md`: publish the captures as a release
asset, link them from the folder, stop the next lab run from re-adding 10 MB, and leave history alone
until a coordinated rewrite is worth it. **Not done in this session** — moving or rewriting anything
here would break the audit baseline and the commit hashes quoted in the evidence.
*Changed by:* the decision to actually do step 1 of that plan.

## 2026-11-23 — Splitting `main.js` — deferred with its measured plan

`docs/proposal-mainjs-split.md`. Every region of the 3 660-line file closes over module-level state
(16 to 84 symbols, up to 15 of them mutable and reassigned behind the region's back), so the file
split cannot honestly precede the context seam. The plan is ordered so each step is provable by the
51-step smoke and the suite: seam, rest cycle, watcher runner, windows, IPC, and finally the smoke
runner out of the product file. **Not done in this session** — a rushed extraction is exactly how a
"pure refactor" stops being one.
*Changed by:* a session that can run both verifications on both sides of every step.

## 2026-11-23 — Auto-update and signing — proposal only

`docs/proposal-update-signing.md`. Signing first, then `electron-updater` on GitHub Releases, portable
users get a link not an update, and the privacy text gains the update check in the same commit as the
code. Not implemented: adding the first runtime dependency to the desktop app is a product decision.