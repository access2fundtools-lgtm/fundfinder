# A2F / FundFinder — JV Deal Protocol
**Internal playbook · 2026-07-31 · applies to every JV originated on FundFinder**

The one-line rule that governs everything below:

> **A JV must be worth doing at ₦0 raised.** If the partnership alone doesn't create revenue, savings, or contracted demand, it is not introduced to anyone — least of all an investor.

---

## Stage map: who pays what, when

| Stage | What happens | Fee | When paid |
|---|---|---|---|
| **0. Interest** | Business expresses JV interest on FundFinder. Lands as `pending_admin_review`. Anonymous. | **Free** | — |
| **1. Admin vetting + Pre-JV Diagnostic** | A2F runs the diagnostic (admin portal → JV Interests → Analyze): each entity's strengths, gaps, **individual actions and funding paths it should explore alone**, plus united strategies, a suggested first joint transaction, and a verdict against the Synergy Test. Only passing pairs proceed. | **Free** | — |
| **2. Introduction** | A2F personally introduces both sides. Facilitated first meeting. | **Free** | — |
| **3. MOU + exclusivity** | Both sides sign Heads of Terms with an exclusivity window (30–60 days) and each posts a **commitment deposit** held by A2F. | Deposit: ₦100k–₦250k each, or ~0.5% of target raise (whichever is greater, capped sensibly) | On signing MOU. **Refundable / credited** — see break-fee rules |
| **4. Structuring** | SPV incorporation, JV agreement, shareholders'/contract-rights agreements, clean books setup. | **Structuring fee** (flat, quoted per deal; deposits credited against it) | On engagement, before work starts |
| **5. Raise + close** | Licensed CMO executes the private raise. Funds disburse to the SPV. | **Origination fee: 2–5% of funds raised** | **Deducted at disbursement.** Never before. |

Why the success fee sits at the end: (a) it aligns A2F with the outcome, (b) it is the market standard for origination, and (c) in Nigeria any upfront "connection fee" reads as advance-fee fraud and destroys the brand. A2F's pitch line: *"We only earn our biggest fee when your money lands."*

---

## The Synergy Test (admin approval criteria — Stage 1)

Score each proposed pairing. **A JV needs a YES on at least one of 1–3, plus YES on 4 and 5, before introduction.**

1. **Revenue synergy** — does the pairing directly create sales? (e.g. Kano supplier + Lagos offtaker = contracted demand; product business + proven marketer = distribution solved)
2. **Cost synergy** — does it remove a major cost? (shared logistics, shared processing capacity, bulk input purchasing)
3. **Capability synergy** — does one side supply what the other would otherwise have to buy? (the founder who "needs money for marketing" may actually need a marketing partner — the JV replaces the spend)
4. **Both sides are real** — CAC status checkable, verifiable trading history, no strike-off list hits, no unresolved compliance red flags.
5. **The raise has a job** — after synergy, there remains a specific, deployable funding gap (equipment, working capital for a signed order, expansion stock) that the JV itself cannot self-fund. *Money must have somewhere productive to go on day one.*

If a pairing fails: tell each side what would make them fundable instead (often a different partner, or no partner — just formalisation). That advice is free and it is the funnel.

**Sequencing principle:** partnership first, money second. Where possible, let the JV run one real transaction together inside the exclusivity window (one shipment Kano→Lagos, one campaign) before the raise. A JV with even one completed joint transaction prices far better than a paper JV.

---

## Break fee (the "back-out" clause) — how and when

**What it's called:** in M&A, a *break fee* (or reverse break fee). In our JV context we implement it as a **commitment deposit with a liquidated-damages forfeiture clause** inside the MOU.

**When it enters:** ONLY at Stage 3 (MOU signing). Never at introduction — asking for money before the two sides have chosen each other poisons the well and filters out no one useful. By MOU stage, both sides have met, seen each other's numbers, and are asking the other to stop talking to alternatives — *that* is what the deposit protects.

**Mechanics:**
- Both parties post equal deposits into an A2F-held account (A2F acts as stakeholder). Mutuality is non-negotiable — a one-sided break fee signals a one-sided deal.
- **Refunded or credited** against the structuring fee if the deal closes, or if it collapses for a *permitted reason*: material adverse finding in diligence, regulatory block, or both parties agreeing to walk.
- **Forfeited to the other party** (less a small A2F admin retention, e.g. 10%) only on defined triggers:
  - walking away during exclusivity without a permitted reason;
  - negotiating with a third party during exclusivity;
  - material misrepresentation discovered in diligence (the misrepresenting party forfeits).

**Legal framing (Nigeria):** courts enforce **liquidated damages** — a genuine pre-estimate of the innocent party's wasted time and costs — but will strike down a **penalty** designed to punish. So the clause is drafted as cost recovery, the amount is kept proportionate to real costs incurred, and the MOU records *why* that number was chosen (diligence costs, advisor time, opportunity cost of exclusivity). Modest and enforceable beats scary and void.

**Is it always right to charge it?** No — and the protocol says so explicitly. Skip or reduce the deposit when: the parties are micro-businesses where ₦100k is itself a barrier (use a smaller symbolic amount — commitment psychology matters more than the sum); or the exclusivity window is very short. The deposit's real job is a **seriousness filter**, not revenue.

---

## Firewall rules (unchanged, restated for completeness)

- No two entities ever meet until admin approves (`pending_admin_review` gate, live since 2026-07-31).
- FundFinder never publicly advertises JV/SPV *investment* opportunities — introductions and raises stay private, through licensed CMOs (CAMA ≤50-member limit; CIS trap).
- User-facing word is **JV**; the vehicle formed at Stage 4 is the **SPV**; all deal documents use SPV terminology.
- Each founder keeps their own company. The SPV holds contractual cash-flow rights / the joint venture's assets — never a forced merger.

---

## What Dayo still needs to run
- `supabase-migration-2026-07-31-jv-admin-gate.sql` — adds the `status` columns that make the pending-review gate real in the database.
