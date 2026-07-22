-- ============================================================================
-- FundFinder — Accurate descriptions for the 5 A2F programs
-- Run once in Supabase → SQL Editor → paste → Run. Updates summary + eligibility
-- on the existing opportunities rows so matches/applications show what each is for.
-- (Dollar-quoted strings so apostrophes need no escaping.)
-- ============================================================================

-- A2F MREIF — residential home-ownership financing (MOFI), strictly residential
UPDATE public.opportunities SET
  summary = $$Residential home-ownership financing delivered under MOFI's Real Estate Investment Fund (MREIF). For private individuals seeking funds to buy a house for residential use. Strictly residential — commercial use of the property is not permitted under MREIF/MOFI; any commercial angle would require separate legal exploration.$$,
  eligibility = $$Private individuals buying a home for residential purposes. Residential use only.$$
WHERE slug = 'a2f-a2f-mreif';

-- A2F M&A — merge, be acquired, or exit
UPDATE public.opportunities SET
  summary = $$For businesses looking to merge with or be acquired by another company — to become a bigger market player or to exit the business. A2F provides M&A advisory and deal structuring; no capital is disbursed directly.$$,
  eligibility = $$Businesses exploring a merger, acquisition, or exit.$$
WHERE slug = 'a2f-a2f-m-a';

-- A2F SPV — consolidate 2 to 5 businesses/JVs into one vehicle
UPDATE public.opportunities SET
  summary = $$Consolidates 2 to 5 fragmented businesses / joint ventures into a single Special Purpose Vehicle so they can approach funders and backers together as one stronger proposition. Qualification is based on the combined strength of their joint value proposition and the market impact of their pooled capabilities — not on the number of members (minimum 2, maximum 5).$$,
  eligibility = $$2 to 5 businesses/JVs willing to consolidate into a joint SPV. Assessed on combined value proposition and market impact.$$
WHERE slug = 'a2f-a2f-spv';

-- Agrithon (FarmID) — agric entrepreneurs; FarmID required, bundled for backers
UPDATE public.opportunities SET
  summary = $$For agricultural entrepreneurs. Every applicant must hold a FarmID (digital enrollment: verified NIN identity + GPS-mapped farm). A2F bundles FarmID-verified farmers together to approach backers for agricultural funding.$$,
  eligibility = $$Agricultural entrepreneurs with a valid FarmID. A FarmID is required to apply.$$
WHERE slug = 'a2f-agrithon-farmid-';

-- A2F Debt Finance — loan/debt capital (DRAFT wording — confirm with Dayo)
UPDATE public.opportunities SET
  summary = $$Debt financing for businesses that need growth or working capital through loans rather than giving up equity. A2F matches applicants to the appropriate lender/loan product and helps them prepare to approach backers.$$,
  eligibility = $$Businesses seeking debt/loan capital.$$
WHERE slug = 'a2f-a2f-debt-finance';

-- Verify:
-- SELECT title, left(summary,80) FROM public.opportunities WHERE slug LIKE 'a2f-%';
