# Cowork Task — The Execution Brief Engine
## Content, Partnership Accelerant & Competitive Moat

**Project:** FundFinder AI | A2F Partners
**Phase:** 6 (runs parallel to Phase 4 and 5 — not dependent on them)
**Assigned to:** @DayoAkin / A2F Strategy

---

## What to Build

A simple internal CMS inside the A2F admin dashboard where the team drafts, manages, risk-rates, and publishes **Execution Briefs** — A2F's periodic intelligence notes showing how major Nigerian projects, government programs, and capital deployment initiatives could have been executed better, cheaper, and with stronger conversion outcomes. Each brief demonstrates FundFinder AI's value in real market context without needing a paying client to prove it.

---

## The Six-Field Brief Template

Each brief has exactly six fields:

1. **What Happened** — factual summary from public record only
2. **What the Numbers Show** — key metrics: timeline, cost, output variance. All sourced.
3. **Where the Execution Gap Lives** — process critique only. No named individuals.
4. **What A2F / FundFinder AI Would Have Done** — specific alternative execution with estimated cost saving, timeline improvement, or output gain
5. **The Converted Outcome** — realistic improved result expressed in naira saved, jobs created, contracts converted, or companies made listing-ready
6. **Risk Rating** — internal only, never published. Three values:
   - 🔴 **Red** — hold, do not publish under any condition
   - 🟡 **Amber** — restructure and get Managing Partner approval before publish
   - 🟢 **Green** — clear to publish

---

## Brief Tags (Per Entry)

- Sector
- Institution or asset name
- Partnership Status:
  - `None`
  - `Outreach Sent`
  - `MOU Signed`
  - `Co-branded`

---

## Publishing Rules (Hardcoded)

| Risk Rating | Partnership Status | Action |
|-------------|-------------------|--------|
| 🔴 Red | Any | **Cannot publish — blocked** |
| 🟡 Amber | Any | Requires Managing Partner manual approval before publish is available |
| 🟢 Green | Co-branded | **Auto-publish** to A2F website + push to social distribution queue (@DayoAkin + @A2FPartners) |
| 🟢 Green | None / Outreach / MOU | Manual publish trigger |

---

## Lead Capture & CRM Integration

- Every published brief lives on the A2F website as a **downloadable PDF behind an email capture form**
- Every email captured → automatically added to the FundFinder Program Principal outreach queue as a new lead
- Primary ROI metric: **partnership conversations initiated** (not views or shares)

---

## Pre-Publish Workflow for Every Amber or Red Institution

Before any brief covering a major institution is published:

1. System generates a **private outreach draft** addressed to that institution
2. The draft shares the brief as private intelligence and invites a partnership conversation
3. Draft goes into the Outreach Engine approval queue
4. Institution receives the intelligence **before it is public** — positioned as the solution, not the problem
5. If they sign an MOU before the brief publishes → Partnership Status updates to `MOU Signed` → brief is restructured as a co-branded piece before going live

> **The rule:** Partner first → publish second. Every Amber/Red target becomes Green the moment they're a co-signatory on the solution.

---

## The Five Briefs to Draft First

| Priority | Brief | Institution | Risk Rating | Why |
|----------|-------|-------------|-------------|-----|
| 1 | AGSMEIS — CBN agricultural SME scheme, ₦220B disbursed, low repayment, no capital market exit | CBN / BOI | 🟡 Amber | Frame carefully around CBN — don't name specific officers |
| 2 | LSETF Targeted Credit Facility — conversion rate from credit to sustainable revenue | LSETF | 🟢 Green | LSETF is already a target partner — framing this right could convert them |
| 3 | TEF Entrepreneurship Programme — absence of capital markets exit pathway for alumni | Tony Elumelu Foundation | 🟢 Green | Flatters the programme while extending it — natural partnership |
| 4 | BPP Federal Infrastructure Contract — timeline, cost variance, local content compliance | BPP / NCDMB | 🟢 Green | No named individual, public data only, improves procurement |
| 5 | NGX Growth Board underlisting — platform is nearly empty despite designed for FundFinder's audience | NGX / SEC | 🟢 Green | Positions A2F as the solution to NGX's own problem |

---

## Content Distribution (Each Brief, In Order)

1. **Direct send** to relevant Program Principals and institutional targets before public release — they receive intelligence, not a press release
2. **@DayoAkin personal social media** — thread format on X/Twitter + LinkedIn long-form post
3. **@A2FPartners institutional channel** — full brief as downloadable PDF on A2F website → content library

---

## Success Conditions

- A brief can be drafted, risk-rated, tagged, and queued for partner outreach entirely within the admin dashboard
- No brief reaches the website without passing the Risk Rating publish rule
- Every downloaded brief captures an email that enters the Program Principal outreach queue
- Partnership conversations opened by briefs are tracked in the A2F Platform Intelligence Dashboard

---

## The Execution Brief Format (Published)

**THE EXECUTION BRIEF — [Issue No.]**
*[Project / Program / Asset Name]*
*Sector | Value | Executing Party (if public) | Date*

- **What Happened**
- **What the Numbers Show**
- **Where the Execution Gap Lives**
- **What A2F / FundFinder AI Would Have Done**
- **The Converted Outcome**

> Risk Rating is internal only — never appears in the published version.

---

## Series Name

**The Execution Brief** — A2F's periodic intelligence note on how major Nigerian projects and programs could be executed more efficiently. Positions A2F as a thinking partner to the market, not a critic of specific actors.

---

*FundFinder AI | A2F Partners | opportunities.a2fpartners.com*
