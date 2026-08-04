# FundFinder — signup alerts + tiered funnel

**Built 3 August 2026.** Code is written and deploy-safe. Four things need you.

---

## What was actually broken

Worth stating plainly, because it's worse than "no funnel":

**Nothing notified you of anything.** No admin email anywhere in `functions/` or
`scripts/` — no Resend, no SendGrid, no Mailgun, no code path that told you a human
had arrived.

And there were **two different signups**, only one of which reached Zoho:

| Door | What happened before | Reached Zoho? | Told you? |
|---|---|---|---|
| Newsletter form on the hub | `subscribe.js` → `newsletter_subscribers` + Zoho list | Yes | No |
| **Full account signup** | Supabase Auth → profile row + empty wallet | **No** | **No** |

The second is the leak that mattered. Someone creating a real account — password,
verified email, higher intent than any newsletter signup — entered a completely
silent path. No sequence could reach them because they were never in the list.

---

## The five stages

A person sits at the highest stage they've reached. The view computes this from real
product signals, not from what was true when they signed up.

| Stage | Meaning | Exit condition |
|---|---|---|
| `0_lead_no_account` | Email captured, never created an account | They create an account |
| `1_account_no_profile` | Account exists, business profile empty | Profile complete |
| `2_profile_no_action` | Profile done, hasn't applied or raised a JV | Any application or JV interest |
| `3_engaged_unpaid` | Took a real action, never paid | A successful transaction |
| `4_converted` | **Exit.** Sequence stops entirely | — |

Stage 4 leaves the nurture series completely. Nothing damages trust faster than being
sold something you already bought.

---

## What you need to do — four steps, about 40 minutes

### 1. Pick an email provider (10 min)

Cloudflare Functions can't open raw SMTP sockets, so this has to be an HTTPS API. The
notifier supports either; set one.

- **Resend** — resend.com, 3,000 emails/month free. Add `fundfinder.ng`, drop the DKIM
  records into Cloudflare DNS, copy the API key. Fastest path.
- **ZeptoMail** — Zoho's transactional product, same vendor as Campaigns, so your domain
  is already known to them. Copy the "Send Mail Token".

> Don't reuse the Zoho **Campaigns** credentials — Campaigns is bulk marketing and
> won't send a one-off operational alert. Different product, different token.

### 2. Set the Cloudflare env vars (5 min)

Pages → FundFinder → Settings → Environment variables → **Production**:

| Variable | Value |
|---|---|
| `NOTIFY_SECRET` | A long random string. Generate once, you'll paste it again in step 3. |
| `NOTIFY_TO` | `access2fundtools@gmail.com` |
| `NOTIFY_FROM` | `alerts@fundfinder.ng` (must be on the verified domain) |
| `RESEND_API_KEY` *or* `ZEPTOMAIL_TOKEN` | From step 1 |
| `FUNNEL_SYNC_SECRET` | A second long random string |

`SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and the four `ZOHO_*` vars should already exist
from `subscribe.js`. If `SUPABASE_SERVICE_KEY` isn't there, that's the same missing key
blocking the deadline backfill — worth adding now, it unblocks both.

### 3. Run the SQL (5 min)

`supabase-migration-2026-08-03-signup-notify.sql` in the Supabase SQL Editor.

**Edit line 41 first** — replace `REPLACE_WITH_THE_SAME_LONG_RANDOM_STRING_AS_CLOUDFLARE`
with the exact `NOTIFY_SECRET` from step 2. If they don't match, the trigger fires and
gets 401'd silently.

Then verify:

```sql
SELECT stage, COUNT(*) FROM public.funnel_stage GROUP BY stage ORDER BY stage;
```

That query is also your funnel dashboard. Run it any time.

### 4. Add the GitHub secret (2 min)

Repo → Settings → Secrets and variables → Actions → New secret:
`FUNNEL_SYNC_SECRET`, same value as the Cloudflare var.

Then Actions → **Funnel stage sync** → Run workflow → tick *dry run* first. It reports
stage counts without writing anything. When the numbers look right, run it live.

---

## Test before trusting it

```bash
curl -X POST https://fundfinder.ng/api/notify-signup \
  -H "Authorization: Bearer <NOTIFY_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"type":"account","email":"you@example.com","name":"Test lead"}'
```

Expect `{"success":true,"emailed":"resend",...}` and an email within seconds.
`"emailed":false` means no provider key is set. `401` means the secret doesn't match.

Then create a throwaway account on the live site. That exercises the real path —
Supabase trigger, pg_net, endpoint, email, Zoho push — which the curl test doesn't.

---

## The sequences

Build these in Zoho Campaigns as workflows keyed on the `Funnel_Stage` field. Create
that field first: Contacts → Manage Fields → Add → text, named exactly `Funnel_Stage`.
Add `Days_In_Funnel` too.

Rules that apply to all of them: **plain text, from your own name, no template that
looks like a newsletter.** These have to read like a person wrote them, because at your
volume a person effectively did. And every one exits the moment the stage advances.

---

### Stage 0 → account · two emails

**Day 0 — subject: `The funding list you asked for`**

> You asked for funding alerts, so here they are — the current open calls for Nigerian
> businesses: fundfinder.ng/opportunity-hub.html
>
> One thing worth knowing: the list is the same for everyone, but the *matching* isn't.
> If you create a free account and tell us what your business does, we only show you
> what you're actually eligible for — which for most people cuts a 20-item list down to
> three worth reading.
>
> Takes 90 seconds: fundfinder.ng/business-diagnostic.html
>
> — Dayo

**Day 4 — subject: `Three you'd probably qualify for`**

> Quick follow-up. I can't tell you which of this week's opportunities fit you, because
> I don't know what your business does yet.
>
> If you tell us — sector, stage, location, that's it — the matching does the rest and
> the daily email stops being a list and starts being a shortlist.
>
> fundfinder.ng/business-diagnostic.html
>
> If funding isn't the thing you need right now, just reply and say so. Sometimes the
> honest answer is a partner or a distributor, not capital, and I'd rather tell you that
> than keep emailing you about grants.

---

### Stage 1 → profile complete · two emails

**Day 1 — subject: `Your account's ready — one thing missing`**

> You've got an account, which means the alerts will reach you. But matching is off
> until there's a profile to match against, so right now you're getting the generic list.
>
> Four fields: what the business does, sector, stage, where you're based.
> fundfinder.ng/fundfinder-profile.html
>
> — Dayo

**Day 5 — subject: `Worth 3 minutes?`**

> Still nothing in your profile, so I wanted to check the obvious thing — is the form
> broken for you, or is it just that you haven't got round to it?
>
> If it's the first, reply and tell me what happened and I'll fix it today. If it's the
> second, here it is again: fundfinder.ng/fundfinder-profile.html

That first line is deliberate. Sometimes it *is* broken, and a reply telling you so is
worth more than a conversion.

---

### Stage 2 → engaged · two emails

**Day 2 — subject: `Your matches are live`**

> Your profile's in, so the matching is running. Here's what it found:
> fundfinder.ng/fundfinder-dashboard.html
>
> The AI will help you draft an application for any of them — eligibility check,
> document list, business summary. Nothing gets submitted without you reading it first.
>
> — Dayo

**Day 7 — subject: `Anything worth applying for?`**

> You've had matches for a week and haven't applied to any. Two possibilities and I'd
> like to know which.
>
> Either nothing fit — in which case tell me what you're actually looking for and I'll
> go find it. Or something fit but the application looked like work, in which case
> that's the part we can do with you.
>
> Just reply. This one comes to me directly.

---

### Stage 3 → converted · one email only

Stage 3 people already engaged. They don't need chasing, they need to be useful to.
**One email, then silence** until they act.

**Day 3 — subject: `How did it go?`**

> You put an application in through FundFinder. How did it land?
>
> I ask because outcomes are the only way we know whether the matching works, and
> because if it stalled I might be able to help unstick it.
>
> If you're weighing something bigger — a JV, an SPV, a raise with a real funding gap —
> that's the conversation I'd rather have. The introduction is free; we only take a fee
> when money actually lands.
>
> — Dayo

That last line matters in Nigeria specifically. Any upfront "connection fee" reads as
advance-fee fraud, which is exactly why your JV protocol puts the origination fee at
disbursement. Say it in the email too.

---

## One honest caveat

You have about four leads. A five-stage automated funnel has almost nothing to run on
yet, and the sequences above are guesses about what these people need — informed
guesses, but guesses.

The **notification** half earns its keep from signup number one: you can't respond to
people you don't know arrived. Turn that on now.

The **sequences** get materially better after you've had the WhatsApp conversations from
`LEAD-DISCOVERY-WHATSAPP-2026-08-03.md`, because then the copy reflects what four real
people actually said instead of what I think they'd say. Build them in Zoho now if you
want the machinery ready — but plan to rewrite the copy once you've talked to a human.

That ordering is also what makes turning the X ad back on safe.

---

## Files

| File | What it is |
|---|---|
| `functions/api/notify-signup.js` | Emails you on every funnel entry; pushes account signups into Zoho |
| `functions/api/funnel-sync.js` | Reads stages, writes `Funnel_Stage` into Zoho. Supports `?dry=1` |
| `functions/api/subscribe.js` | *Modified* — now also fires the notifier |
| `supabase-migration-2026-08-03-signup-notify.sql` | pg_net trigger on `auth.users` + the `funnel_stage` view |
| `.github/workflows/funnel-sync.yml` | Daily 05:30 UTC sync, runs before the scraper |

Everything is deploy-safe with no env vars set: the notifier returns 200 and sends
nothing, the sync reports counts and writes nothing. Nothing breaks while you're
part-way through setup.
