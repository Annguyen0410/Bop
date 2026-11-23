# Proposal — auto-update and code signing for the desktop build

**Status:** proposal only. Nothing here is implemented; there is no updater code in the repository today
and this document does not add any. The desktop build already carries the `repository` field so
electron-builder can write its update metadata (`app-update.yml`) after packaging — that is the one
piece of groundwork that exists.

## What exists today

- Two publish targets: an NSIS installer (`Bop-Setup-x.y.z.exe`) and a portable EXE
  (`Bop-x.y.z-portable.exe`).
- Neither is code-signed. Windows SmartScreen therefore has no publisher identity to learn, and a
  user who already trusts one build is asked again by the next.
- Updates are manual: the user downloads a new build from the repository. The wording in the app is
  version-agnostic on purpose, so it makes no promise about update checking.

## Proposal

**1. `electron-updater`, GitHub Releases as the feed.** Electron-builder already publishes
`latest.yml` next to the release assets; `electron-updater` reads it, downloads the NSIS installer,
and verifies the signature before applying. Checks happen on launch and every 6 hours, never on a
metered connection if the user has said "not now", and the result is a quiet badge in the app — not a
dialog that interrupts a work account.

**2. Portable is a link, not an update.** `electron-updater` does not update a portable EXE. The
portable build should say "a new version is available: <url>" and keep working. That is already how
users of that build behave.

**3. Signing options, cheapest first.**

| Option | Cost | What it buys |
| --- | --- | --- |
| Self-signed certificate, pin the public key in the app | free | Detects a tampered installer. Does **nothing** for SmartScreen, which judges publishers, not integrity. |
| OV code-signing certificate | ~US$100–400/yr | Real publisher identity. SmartScreen reputation still builds slowly. |
| EV certificate or **Azure Trusted Signing** | ~US$300+/yr or ~US$9.99/mo | Immediate or fast SmartScreen reputation. Azure Trusted Signing is the practical route for a solo maintainer today. |

Recommendation: start with Azure Trusted Signing and wire it into electron-builder
(`azureSignOptions`), because the whole point of signing is that the *next* dialog disappears.

**4. Rollout.** Publish release assets first, then flip `latest.yml` (electron-builder can do this in
two steps: `--publish never` for the artifacts, then a small publish step). Keep the previous release's
assets available for a rollback that does not need a new build.

## Risks, named

- **Unsigned updates are the whole problem, twice.** An unsigned installer asked into a machine by an
  update channel is a worse shape than one the user deliberately downloaded. Signing is a
  *prerequisite*, not an add-on.
- **This app phones home.** Checking GitHub for updates is the first network request Bop would make on
  its own. That contradicts "nothing leaves the device" as it stands and must be added to
  `docs/PRIVACY.md` (exactly what is sent — a version and a request to a public repo — and an
  opt-out), or the check must be user-initiated only. Prefer the opt-out switch in settings.
- **A compromised GitHub account is a compromised update channel.** Signing is the mitigation:
  `electron-updater` verifies the signature of the downloaded installer on Windows. Protect the
  account with a hardware key and release-tagged publishing only.
- **Full-install payloads.** Every update ships the whole installer. That is fine at this size
  (~90 MB) and is what the NSIS differential work is for if it ever matters.
- **Downgrade/partial failure.** The updater must leave the old build running if the new one does not
  start; electron-updater's NSIS flow already applies atomically.

## Rollout steps when someone decides to do it

1. Get a signing identity (Azure Trusted Signing), wire it into `build.win` in `desktop/package.json`.
2. Add `electron-updater` as the first runtime dependency of the desktop app — this changes the
   "zero runtime dependencies" statement in `README.md` and that documentation must move in the same
   commit as the code.
3. Implement the check behind a settings switch (default on, with the privacy text updated the same
   day).
4. Test the loop with a private prerelease channel before pointing users at it.
5. Update `README.md`, `docs/PRIVACY.md` and `desktop/guide/` in the same change; update the
   verification transcript with the build and check that were actually run.