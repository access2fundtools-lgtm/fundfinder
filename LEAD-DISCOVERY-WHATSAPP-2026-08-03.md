# Clearing the funnel — WhatsApp discovery script

**3 August 2026 · for the 3–4 live leads · goal: find out who they are and what they need. No pitch.**

---

## Before you send anything (10 minutes)

**Install WhatsApp Business on `08062085464`.** Free, from the Play Store / App Store.
Not WhatsApp Business API — the ordinary Business *app*. It gives you:

- a business profile (name, fundfinder.ng, category) so you don't look like a stranger
- **Labels** — tag each chat `New lead` / `Replied` / `Qualified` / `Dead`
- **Quick replies** — save the messages below as `/open`, `/nudge` so you're not retyping
- your personal `08060972236` stays out of it entirely

You said you might use your personal WhatsApp. Don't — once a lead has your personal
number you can never hand that relationship to anyone else, and it follows you into
every future deal.

---

## The one rule that decides whether they reply

**First message asks exactly one question.** Not two. Not a paragraph about FundFinder.

Nigerian business owners get blasted daily; the tell for a blast is a message that
explains itself before it asks anything. A short, specific, single-question message
from a human reads completely differently — and it's the only kind that gets answered.

---

## Message 1 — the opener

Pick by where the lead came from. Send between **9–11am or 4–6pm** on a weekday.

### If they signed up for funding alerts

> Good morning — Dayo here, I run FundFinder (fundfinder.ng). You signed up for the
> funding alerts, so I'd rather reach out properly than leave you on a mailing list.
>
> What's the business, and what are you trying to fund right now?

### If they came in through JV / SPV interest

> Good morning — Dayo from FundFinder. You put in a JV interest on the platform, and I
> review those personally before anyone gets introduced to anyone.
>
> Before I look for a match: what does your business actually do, and what's the gap
> you're hoping a partner fills?

### If they're a programme organiser / partner

> Good morning — Dayo from FundFinder (fundfinder.ng). We list funding calls for
> Nigerian businesses and yours came up.
>
> Are you currently getting enough qualified applicants, or is that a problem worth
> talking about?

---

## Message 2 — the follow-up

Only if no reply after **48 hours**. Send once. Then stop.

> Morning — just bumping this in case it got buried. If the timing's wrong, no
> problem at all, just say so and I'll leave you be.

If still nothing after that: label the chat `Dead`, move on. Do not send a third.
A third message converts nobody and gets numbers reported.

---

## What to listen for

You're not selling, so your job in the reply is to hear four things. Don't ask them as
a checklist — they come out naturally if you follow up on what they say.

| What you want | How it usually shows up |
|---|---|
| **What the business actually does** | Sector, whether they're trading now or pre-revenue |
| **What the money is for** | Equipment, stock, working capital, "expansion" (push on vague answers — "expansion into what?") |
| **Whether they're real** | CAC registration, how long trading, any customers named |
| **Whether money is even the answer** | Often the honest answer is a partner, a distributor, or just formalisation — not capital |

That last row is the valuable one. Your own JV protocol says it: *"the founder who needs
money for marketing may actually need a marketing partner."* Telling someone that
plainly, for free, is what makes them trust you later.

---

## After each conversation

Log four lines in the chat labels or a note — name, business, what they need, next step.
Four leads doesn't need a CRM. It needs you to remember what they said.

When you've done all four, you'll know something you don't know now: **what these people
actually want.** That is the thing worth encoding into templates and automation later —
and the reason doing this by hand first is not a detour.

---

## Guardrails

**Do not message anyone from `contacts.csv`.** That's a 19,710-row export of your
personal Google Contacts sitting in this folder. Messaging those numbers would be
unsolicited business messaging — it gets the number reported and banned within days,
and under the Nigeria Data Protection Act it's using personal data for a purpose it was
never given for. Only message people who came in through the platform and opted in.

**Honour STOP immediately** if anyone sends it, even in a one-to-one chat.

**Keep the number consistent.** If you start on `08062085464`, every future
conversation with that lead stays on `08062085464`.

---

## On the API question — for the record

You said Meta verification "won't eventually come", so better to use an API. Worth
knowing before you spend money on that: **verification was never the blocker at your
volume.**

An unverified WhatsApp Cloud API account already allows **250 unique contacts per
rolling 24 hours** and up to 2 phone numbers. You have four leads. Verification exists
to lift that ceiling from 250 to 1,000+ — it's a scaling gate, not an access gate.

Also worth knowing: **no provider bypasses Meta.** Twilio, 360dialog, Wati, Sendchamp,
Termii — all of them are Meta Business Solution Providers sitting on the same WhatsApp
Business Platform. They resell access and handle paperwork; they can't route around
Meta because there is no route around Meta for official WhatsApp. Anything advertising
otherwise is running an unofficial library against WhatsApp's terms, and those numbers
get banned.

Your Cloud API build (`functions/api/whatsapp-broadcast.js`) is already written and
deployed dormant. It stays there. Turn it on when you have enough subscribers that
sending by hand hurts — that's the signal, not a date.

---

## The X campaign

Parked safely. It never published — it stopped at the funding-source screen, so no card
was added and nothing has spent. The build is documented in
`X-ADS-CAMPAIGN-BRIEF-2026-08-03.md` and can be rebuilt in about ten minutes whenever
you want it.

Your reasoning for pausing it is sound: paid traffic into a funnel you can't service
yet just buys you leads that go cold. Clear these four, learn what the conversation
needs, then open the tap.
