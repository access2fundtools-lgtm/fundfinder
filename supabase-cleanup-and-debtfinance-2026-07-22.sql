-- ============================================================================
-- FundFinder — (A) remove the QA test submissions, (B) finalize A2F Debt
-- Finance wording. Run once in Supabase → SQL Editor → paste → Run.
-- ============================================================================

-- (A) CLEANUP — delete the two QA dogfood test submissions
DELETE FROM public.opportunities      WHERE title ILIKE 'QA TEST PROGRAM%';
DELETE FROM public.principal_programs WHERE program_name ILIKE 'QA TEST PROGRAM%';
DELETE FROM public.program_principals WHERE org_name ILIKE 'QA TEST ORG%';
-- Then delete the two org auth users in the dashboard:
--   Auth → Users → remove access2fundtools+orgtest@gmail.com and access2fundtools+orgtest2@gmail.com

-- (B) A2F Debt Finance — standalone credit for an individual entity
UPDATE public.opportunities SET
  summary = $$Standalone debt financing for a single business or individual that simply wants to access credit — a loan for growth or working capital — without joining any of the other A2F programs (SPV, M&A, MREIF, or Agricthon). A2F matches the applicant to the right lender/loan product and helps them prepare to approach the backer.$$,
  eligibility = $$Individual businesses or entities seeking standalone credit / a loan — not as part of an SPV or any other A2F program.$$
WHERE slug = 'a2f-a2f-debt-finance';

-- (C) A2F Agricthon — correct name + FarmID is OPTIONAL (not the program name)
UPDATE public.opportunities SET
  title = 'A2F Agricthon',
  summary = $$A2F Agricthon — funding support for agricultural entrepreneurs. A2F helps agripreneurs approach backers for agricultural funding. Applicants may optionally provide a FarmID — a confirmation of verified physical farmland ownership. A FarmID is NOT required, but is strongly encouraged as the single source of truth for confirming an applicant's farm.$$,
  eligibility = $$Agricultural entrepreneurs. A FarmID (proof of farmland ownership) is optional but strongly encouraged; it is not a requirement to apply.$$
WHERE slug = 'a2f-agrithon-farmid-';
