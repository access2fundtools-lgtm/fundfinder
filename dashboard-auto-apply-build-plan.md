# FundFinder AI — Dashboard Auto-Apply: Build Plan

## The constraint that shapes everything

There's no universal API to "submit" a grant application through. Every program uses something different — a Google Form, a JotForm, an org's own custom portal, a PDF you email back, sometimes just a WhatsApp number. Real examples already live in the hub right now: `forms.gle/...` (Google Form), `form.jotform.com/...` (JotForm), `careers.se.com/...` (a corporate ATS), `lsetf.ng/content/...` (a bespoke org page).

So "apply with one click from any program, fully automatically" isn't achievable without a small army of per-site integrations. What *is* achievable, and covers the real pain point (retyping the same business/personal facts into a different form every time), is: **the AI drafts every answer from the stored profile, the user reviews and sends it in one click wherever possible, and nothing is ever submitted without the user's final action.**

## Data model additions (Supabase)

The existing `user_profiles` table already covers a good baseline (full_name, whatsapp, city, gender, annual_revenue, funding_purpose, cac_number, bank_name, nin, bvn_last4). Three additions make it usable as an "apply anywhere" source:

**`user_profiles` — add a flexible facts column.** Scalar columns can't keep up with how differently programs phrase things ("years in operation" vs "business age" vs "date founded"). Add `profile_facts JSONB DEFAULT '{}'` — a growing key→value store (e.g. `{"years_operating": "3", "num_employees": "12", "sector": "agritech", "export_ready": false}`) that the AI both reads from and writes to (when a user answers a question in one application that isn't yet in their profile, save it back so the next application benefits too).

**`user_documents` table (new).** `id, user_id, doc_type (cac_certificate | id_card | pitch_deck | financials | business_plan | photo), file_url (Supabase Storage), uploaded_at`. Many programs ask for these as uploads; the answer-draft step can at least tell the user which saved document to attach.

**`opportunity_questions` table (new).** `id, opportunity_id (FK), question_text, field_type (text|textarea|select|number|file|date), options (JSONB, for selects), required (bool), extracted_at`. Populated once per opportunity, not per user — see pipeline below.

**`applications` table (new).** `id, user_id, opportunity_id, status (draft|reviewed|sent), answers JSONB, gaps JSONB (questions the AI couldn't answer from the profile), prefill_url (nullable), created_at, updated_at`. This is the user's draft/history — lets the dashboard show "3 applications in progress."

## Pipeline

**Step 1 — Question extraction (runs once per opportunity, at scrape time or on first "Apply" click, not per user).**
Extend `scripts/scraper.js` (or a new Cloudflare Function, since this needs to run server-side against a live URL) to look at the resolved `apply_url`:
- If it's `forms.gle` or `docs.google.com/forms/...` → fetch the form and parse its field list (Google Forms exposes field structure in the page's embedded JSON — no auth needed for a public form).
- If it's `form.jotform.com/...` → same idea; JotForm's public form HTML exposes field metadata.
- Otherwise (org's own page) → fetch the page text and ask Gemini to extract the list of application questions from the visible content (reuse the same Gemini call pattern already in `functions/api/chat.js`, new prompt).
Store the result in `opportunity_questions`. If extraction fails or the page requires login, mark the opportunity `auto_apply_supported = false` and the dashboard just shows the normal "Apply Now" link.

**Step 2 — Answer generation (on demand, when a logged-in user clicks "Apply from my profile").**
New Cloudflare Function `functions/api/auto-apply.js`, modeled directly on the existing `chat.js` (same auth check via Supabase session token, same credit-deduction pattern — this is a natural paid action, e.g. 2–3 credits given it's higher-value than a chat message):
1. Load the user's `user_profiles` + `profile_facts` + `user_documents` + the opportunity's `opportunity_questions`.
2. Send both to Gemini with a strict instruction: answer only from the supplied data; for anything not covered, return `"gap": true` rather than inventing an answer.
3. Save the result to `applications` (status `draft`) and return it to the browser.

**Step 3 — Review UI (new section in `fundfinder-profile.html` or a new `fundfinder-applications.html`).**
Shows each generated answer next to its question, a "copy" button per field, gaps highlighted in a distinct color with an inline input so the user can fill them right there (and that value gets saved back to `profile_facts`), and the relevant document names for anything requiring an upload. Where the source is a Google Form or JotForm, generate a **prefill deep link** (both platforms support `?entry.123=value` / `?field[3]=value` style URL prefilling) so clicking "Continue to official form" opens it already filled in — the user still clicks their own Submit button on the org's site. This is the single biggest win for the least engineering risk, and covers a real chunk of current sources already.

**Step 4 — status tracking.** Once the user says "I submitted this," flip `applications.status` to `sent` so the dashboard shows a running list instead of the user losing track of what they've applied to.

## Explicitly out of scope for v1 (flag, don't build yet)

Headless-browser auto-submission (e.g., driving a real browser to fill and click Submit on an arbitrary org's HTML form) is possible in theory but fragile per-site, and carries real liability if it submits something wrong or gets flagged as bot traffic by the org. If it's ever worth doing, it should be a phase-2 add for a handful of specific high-volume sources with manual per-site adapters — and it should still end at a "review, then you click submit" checkpoint, never a blind autosubmit.

## Rollout order

1. Profile facts + documents (data model + a short "complete your profile" flow) — this alone makes every future step possible.
2. Question extraction wired into the scraper for the two form platforms (Google Forms, JotForm) — fastest to ship, directly usable via prefill links, no LLM extraction needed for those two.
3. Gemini-based extraction + answer drafting for everything else (org's own pages).
4. Applications tracking UI in the dashboard.
## Decisions (2026-07-16)

**Profile filling/updating is free, always.** Saving `user_profiles` / `profile_facts` / `user_documents` is a plain database write — no AI call happens at save time, so there's nothing to charge for. The AI only ever touches the data at the moment a user clicks "Apply from my profile" on a *specific* opportunity — that's when it reads the stored facts and drafts answers shaped for that program's actual questions. Profile completeness (or later edits) never triggers an AI call on its own.

**Credit charge = the auto-apply draft generation step only** (Step 2 in the pipeline above, `functions/api/auto-apply.js`). This is the one place a Gemini call actually happens, so it's the one paid action — same pattern as `chat.js` charging 1 credit per AI message. Proposed: 2 credits per auto-apply run (higher than a chat message since it reads more context and produces a full drafted application, not a short reply) — flag if you'd rather keep it at 1.

**Gap autosave:** defaulting to auto-save silently — if a user fills in something during review that wasn't in their profile, it's written back to `profile_facts` immediately so the next application benefits, no extra prompt. Low risk (it's their own data, they just typed it themselves) and matches "don't make them retype things" being the whole point. Say so if you'd rather confirm each time before saving.

**Document uploads:** Supabase Storage (same project) — unchanged from the original plan.

## Phase 2/3 idea: a standing auto-apply agent (raised 2026-07-16)

Dayo's ask: since browser-automation agents (like the one driving this Zoho Campaigns work) can now navigate and fill in arbitrary web forms, could FundFinder run one continuously — watching for newly-qualified users x newly-scraped opportunities and filling applications on their behalf automatically?

Directionally right, and the browser-automation piece is real and already in use elsewhere in this project. Two things keep it from being "constantly auto-fill and submit, fully unattended," and they're not arbitrary caution — they're the same limits that apply to any agent handling personal data on someone's behalf:

- These forms carry NIN, BVN, CAC numbers, bank details — submitting one wrong, duplicated, or malformed is a real harm to a real applicant's chance at funding, not a reversible mistake. A human should see the filled form before it goes anywhere, every time.
- It's fragile per-site: CAPTCHAs (can't be bypassed — a hard line, not a technical gap), logins, file uploads, and orgs that change their form layout without notice all break blind automation silently.

The version of this worth building: a background watcher that, whenever a user newly qualifies for an opportunity, auto-drafts the application immediately (same Step 2 logic) and *notifies* the user (email/WhatsApp, reusing the existing Zoho pipe) that it's ready for one-click review-and-send — rather than the user having to remember to check the dashboard. Same proactive value ("stop making me hunt for this"), same one-click final step, no blind submission. Worth scoping properly once the core drafting pipeline (Steps 1-3) is live and proven on real applications — flagging here so it doesn't get lost, not building it yet.
