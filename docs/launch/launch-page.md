# Launch page copy

Fields for a Product Hunt / "show the world" style launch form.

## Name

`Bop`

If the form wants a longer project title:
`Bop — One hub, separate browser sessions per account`

## Tagline (aim 45–55 characters)

Marketing:
> Many accounts, one quiet window. Each space keeps its own browser session.

Tighter:
> Keep several messaging accounts apart on one device — never log out.

Technical:
> A Windows desktop hub and an Android app that run parallel web logins per account.

## Links

- App / project page: `https://github.com/Annguyen0410/Bop`
- Docs / how it works: `https://github.com/Annguyen0410/Bop/blob/main/docs/desktop.md`
- Privacy policy: `https://github.com/Annguyen0410/Bop/blob/main/docs/PRIVACY.md`
- Download: publish the portable build as a GitHub Release asset and link that. The EXE is not
  committed to the repo (`desktop/dist/` is ignored), so there is no direct file link today.

## Open source?

Honest answer for a strict reading: **no licence is granted.** The repo is public on GitHub, but
`README.md` states no licence is granted by default. If the form means "publicly viewable source",
mark it yes; if it means "has a permissive public licence", the answer is not yet. Add a licence file
(and review Play Store / SmartScreen requirements) before claiming otherwise.

## Tags (pick up to three, ranked)

1. `Productivity` — multiple accounts, background monitoring, task panels.
2. `Utilities` — a desktop/phone utility, not a game or mainstream consumer app.
3. `Privacy` — no server, no account, no analytics, no telemetry.
4. `Developer Tools` — only if the audience is developers and the angle is "built from source".

Do **not** lead with `Social`, `Messaging`, or `Communications`: those read as "an app you message
people with", and Bop is not that. It manages parallel sessions; it does not host a chat UI.

## Description

> **Bop keeps several messaging and web accounts apart on one device.**
>
> The problem is not notifications — it is switching. The moment you care about more than one account
> of the same kind (two Messenger logins, a study board and a job feed), your options are to log out
> and back in, juggle browser profiles, or accept that everything bleeds together. Bop treats
> separation as the primary thing to get right.
>
> **On Windows**, one hub window gives each account its own browser session. Messenger in A, Facebook
> in B, a survey board in C. Every space has its own cookies, storage and cache, so the accounts never
> see each other. The hub hides into the tray and keeps listening, and a small floating bubble tells
> you which account moved. The bubble's size, transparency and double-click action are yours to set,
> right down to using your own picture.
>
> **On Android**, add one space per account, grant notification access, and Bop turns the phone's
> notifications into cards with a per-account badge on the bubble. Each web session keeps its own login
> without sharing cookies with the others.
>
> **What Bop is not:** it is not a messaging client and it does not host a chat UI. It tells you
> something happened and opens the real conversation. It cannot recover a notification that was never
> posted, an unread marker is a count rather than a message, and background delivery is best-effort on
> both platforms. Nothing leaves your device — no Bop account, no server, no analytics.
>
> Free and independent. A Windows portable build and the Android source are in the repo.

## First comment / maker note

> Maker here. I built Bop because I live in the multi-account problem and no tool treated
> "same app, different accounts, same device, fully separate sessions" as the thing to get right.
>
> Two honest things: neither build is code-signed (Windows will warn on first launch; the release APK
> is unsigned), and I have not yet exercised a real signed-in account — the verification in the repo
> covers the app's own behaviour, not a live provider. What is verified: 100 desktop unit tests, 124
> Android unit tests, a 47-step smoke run by the portable EXE itself, an 18/18 live check against that
> EXE — including a real OS-pointer drag of the bubble landing exactly and the live-page budget returning
> about 90 MB for each sleeping page. Raw output is linked in the README.
>
> Feedback welcome — especially on whether the separation model matches how you actually juggle
> accounts.
