# FundFinder AI — Newsletter Automation Architecture (Scoped)

**Supersedes the Gemini CRM/Workflow plan for now.** Decided with Dayo on 2026-07-15:
- Supabase stays the single source of truth. Zoho Campaigns is a delivery layer only — it never becomes a second live database.
- No Zoho CRM, no Workflow Rules, no Blueprints. Those require a paid CRM tier and create two systems of record that can drift out of sync.
- The "Action B" one-click SPV/NGX submission flow is **out of scope for now** — SEC Nigeria Capital Market Operator registration hasn't started (per `FUNDFINDER-AI-GROWTH-SUITE-STRATEGY.md`'s own regulatory note), so there's nothing lawful to route a submission *to* yet. Revisit this section once that registration is filed or completed.

---

## What this covers

Just Flow 1 from the Gemini brief — the daily/periodic newsletter — rebuilt to actually work with what exists today, plus a corrected domain (**fundfinder.ng**, not the old `opportunities.a2fpartners.com`).

## What already exists and gets reused

- `user_profiles` (Supabase): `business_sector`, `business_location`, `business_stage`, `notify_email`, `notify_whatsapp` — real segmentation fields already captured at signup, no new schema needed for a first version.
- `newsletter_subscribers`: email-only leads (no profile yet) captured via the hub's 3 forms → `/api/subscribe` → optionally pushed to Zoho Campaigns (see `ZOHO-SETUP.md`, already built).
- `program_principals` / program listings: the actual opportunity data that would populate the newsletter content.

**Important asymmetry:** raw leads in `newsletter_subscribers` have no sector/location — they only gave an email. Real segmentation (matching someone to sector-specific opportunities) is only possible once they create a full account and fill their profile. That's actually the honest selling point of the Autoresponder email already drafted in `ZOHO-SETUP.md` ("create an account so we can match you precisely") — it's not a gap to hide, it's the CTA.

## Two levels of "personalized," and which one to build first

1. **List-level segmentation (Zoho Campaigns native, no CRM needed):** sync `business_sector` and `business_location` as custom contact fields on signed-up users only, create Zoho Campaigns segments off those two fields (e.g. "Lagos + Agric"), and send a shared campaign per segment. This is what Zoho's own Segments feature is built for — cheap, no CRM tier required, matches what Gemini's plan asked for structurally, just without inventing a second CRM database.
2. **True 1:1 personalization (per-subscriber matched list):** requires generating each subscriber's specific match list server-side (a Cloudflare Function querying Supabase for open opportunities matching their exact sector/location/stage) and sending it as an individually-composed email. Zoho's "RSS Campaign" feature — which the Gemini plan proposed for this — actually sends the *same* feed content to an entire list; it doesn't do row-level personalization per recipient. Real 1:1 matching means either using Zoho's mail-merge/dynamic-content blocks (available on paid Campaigns tiers, still simpler than CRM) or sending through a transactional path instead of a bulk campaign.

**Recommendation: ship (1) first.** It's buildable on the free/current Campaigns tier, requires no new infrastructure, and covers most of the value ("people in my sector/state get relevant alerts"). Revisit (2) once there's a real base of signed-up, profiled users worth the extra engineering.

## Build steps (once Zoho Campaigns account/list exist — see ZOHO-SETUP.md)

1. Extend the signup flow (`fundfinder-auth.html` → Supabase) so that when a user completes their profile, `business_sector` and `business_location` also get pushed to Zoho Campaigns as custom contact fields (small addition to the existing Zoho push logic in `functions/api/subscribe.js`'s sibling code path — profile completion, not just newsletter signup).
2. In Zoho Campaigns → Contacts → Segments, create segments by sector and/or location combinations that matter most (start with 2–3, not an exhaustive matrix).
3. Manually send (or schedule) a segment-targeted campaign to start, before automating anything — validates the content and segments actually make sense before wiring a daily auto-send.
4. Once validated, automate via Zoho's own scheduled/recurring campaign feature, sourced from a simple daily export or feed of new open opportunities (still no CRM Workflow Rules needed for this).

## Explicitly deferred (not this build)

- Zoho CRM, Blueprints, Workflow Rules.
- The `https://api.a2fpartners.com/submit-app` webhook — doesn't exist, would need to be built against the existing `program_applications` Supabase table if/when this is revisited.
- Internal one-click SPV/NGX submission automation — blocked on SEC Nigeria CMO registration status.
- True per-subscriber 1:1 matched emails — possible later, not v1.

## Domain correction

Every template, link, and CTA must use **fundfinder.ng** — not `opportunities.a2fpartners.com`, which appears throughout the internal strategy docs but is not the live site.
