# itch.io page copy

itch.io reads like a game page, but it accepts tools. Translate its template for a free desktop/phone
utility and ignore the "game" language.

## Short description / tagline

> Keep several messaging and web accounts apart on one device — one session per space, no logging out.

## Classification

**Tools** — a software utility.

## Kind of project

**Downloadable** — you only have files to be downloaded.

## Release status

**Released** — usable now, may receive updates. (Not "In development": the desktop build passes its own
packaged and live checks.)

## Pricing

**No payments.** If you want to accept donations, set a suggested amount (e.g. $2.00) rather than a
price wall — the honest default for where this is today is free.

## Uploads

Only attach real build output:

- **Windows:** the portable EXE, `Bop-0.2.1-portable.exe` (77,995,196 bytes, sha256
  `95ed03ba38f599ffe84f9463529cff84bcd4de6169bfac6749d14f1dd714715c`). Build it with
  `npx electron-builder --win portable --x64`, or attach it as a GitHub Release asset and link it.
- **Android:** not a committed binary — it is built from source. If you want it here, export and sign
  an APK/AAB first; the repo's release APK is unsigned.

Do **not** upload the repo, docs, or evidence logs. itch.io is a download page, not code hosting.

Be explicit about signing: this is not code-signed, so first launch on Windows warns
("Windows protected your PC" → **More info → Run anyway**). Framing it as a finished store release
would read as misleading; framing it as "a portable build you can try; first run will warn because it
isn't signed" is honest.

## Description

> **Bop is a small personal hub for keeping several messaging and web accounts apart on one device.**
>
> On Windows, one hub window gives each account its own browser session. Messenger in A, Facebook in B,
> a study board or job feed in another space. Each space has its own cookies, storage and cache, so the
> accounts do not see each other. The hub hides into the tray, keeps listening, and shows a small
> floating bubble that tells you which account moved. You can set the bubble's size, transparency,
> double-click action, and even use your own picture.
>
> On Android, add one space per account, grant notification access, and Bop turns the phone's
> notifications into cards with a per-account badge on the bubble. Each web session keeps its own login
> without sharing cookies with the others.
>
> **What Bop is not:** it is not a messaging client and it does not host a chat UI. It only tells you
> something happened and opens the real conversation. It cannot recover a notification that was never
> posted. An unread marker is a count, not a message. Background delivery is best-effort on both
> platforms — Windows keeps loaded spaces alive while hidden in the tray, and Android may suspend an
> off-screen web session. Nothing leaves your device: no server, no account, no analytics.
>
> **Before you run it:** neither build is signed. Windows shows a SmartScreen warning on first launch;
> choose **More info → Run anyway**, or sign the build yourself. No real signed-in account has been
> exercised yet — everything verified in the repo is the app's own behaviour.
>
> Built independently. Source and the full verification log are on GitHub:
> https://github.com/Annguyen0410/Bop

## Before publishing the page

- [ ] Decide the licence (see [README.md](README.md)) — redistribution without one is not granted.
- [ ] Attach only the signed/portable artifact you intend to distribute, and state that it is unsigned.
- [ ] Point the download at a GitHub Release asset, not a repo path that only exists after a build.
- [ ] Keep the "what it is not" section — it is the part that keeps the page honest.
