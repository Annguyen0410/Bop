# Founder / investor form answers

Answers for accelerator or grant forms asking about founder fit, motivation and competition. Written
to be honest about the current stage: a working solo prototype, not a funded company.

## Why are you the right founder/team to work on this?

I'm the right person to build this because I've been living inside the problem I'm trying to solve:
keeping several messaging and web accounts apart on one device without constantly logging out and back
in. I built Bop myself because no existing tool treated "same app, different accounts, same device,
completely separated sessions" as the primary thing to get right.

What I bring isn't credentials or funding today — it's a working prototype that proves the core idea is
buildable: a desktop hub with one window, one session per space, and an Android side that turns phone
notifications into cards. The repo already has both apps, the verification notes, and the raw evidence
behind the checks I ran.

I'm not pretending this is a funded company or that I have a growth team behind me. Right now this is a
single founder, a working tool, and a clear sense of the problem. That's the realistic starting point.

## Why did you pick this idea to work on?

I picked it because it's a boring problem with a real pain: the moment you care about more than one of
the same kind of account — two Messenger accounts, two Facebook accounts, a study board and a job feed
— the usual options are bad. You log out, switch browsers, use a web app, use a burner, or accept that
everything bleeds into everything else.

The thing that made me want to build it is that the hard part is not "show me notifications." The hard
part is separation without switching friction. That's why Bop is built around separate browser sessions
per space, not around a clever notification UI. If the sessions are not actually separate, the rest is
just a nicer alert on top of a messy workflow.

It also sits in an awkward place worth building in: useful enough to be a real personal tool for people
who juggle accounts, but not flashy enough to be anyone's roadmap priority. That gap is where an
independent build has a chance.

No real signed-in account has been exercised yet, and neither build is signed. I'm not hiding that. If
I wanted to chase optics, this is the place to lie.

## Who are your competitors, and what do you understand that they don't?

The honest competitor list isn't "other apps" — it's the bag of workarounds people already use:

- Logging out and back in
- Multiple browsers or browser profiles
- A separate phone app per account
- Web tabs, private mode, or burner sessions
- Separate devices
- Notification aggregators that sit on top of the same logged-in account

Most of those are annoying, fragile, or both. They persist because separation and convenience are both
expensive to offer well, especially across devices.

What I think most people miss is that the user's real complaint is usually not "I want more
notifications." It is the cost of switching between accounts and the risk of mixing them up. That's why
Bop is architected around per-space isolation first, with notification and page-watch features built on
top — not the other way round.

## Where this is today, honestly

Working prototype, one founder, desktop portable build and Android source in one public repo. Verified
by the project's own test suites (100 desktop unit tests, 124 Android unit tests, an 18-step live check
against the shipped portable EXE and a 47-step smoke run by that same file); not yet verified with a real
signed-in account, real incoming messages, or on a real phone. Not signed for distribution.

What would make this a business rather than a side project: evidence from real people who actually live
in the multi-account problem, a clearer picture of who pays and why, and a path that doesn't depend on
owned distribution. Without that, the honest label is hobby-to-early-product, not startup.
