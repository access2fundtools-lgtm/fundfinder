-- ============================================================================
-- FundFinder — FIX: scraped opportunities never reach the database
-- (the opportunities table holds only the 5 A2F programs, so every user only
--  matches A2F). Run once in Supabase → SQL Editor → New query → paste → Run.
--
-- Root cause: phase7 created the RLS POLICIES "Anon can insert/update
-- opportunities", but the anon role was never GRANTed the underlying table
-- privilege. Postgres requires BOTH a policy AND a base-table grant, so every
-- scraper write was rejected with: 42501 "permission denied for table
-- opportunities". This grant completes what phase7 intended.
-- ============================================================================

GRANT INSERT, UPDATE ON public.opportunities TO anon;

-- Verify afterwards (run the next scrape, then):
--   SELECT count(*) FROM public.opportunities WHERE is_active = true;
-- Should jump from 5 to dozens once the scraper can write.

-- ── SECURITY NOTE (optional hardening, later) ────────────────────────────────
-- Granting anon INSERT/UPDATE means anyone holding the public "publishable" key
-- (it ships in the site's JS) could write opportunities. The RLS policy uses
-- WITH CHECK (TRUE), so it does not restrict content. This matches phase7's
-- original design, but the more secure pattern is to have the scraper write with
-- the SERVICE-ROLE key (kept only in GitHub Actions secrets) and REVOKE anon
-- writes. Ask Claude to switch the scraper to the service key when you want to
-- harden this — then run:  REVOKE INSERT, UPDATE ON public.opportunities FROM anon;
