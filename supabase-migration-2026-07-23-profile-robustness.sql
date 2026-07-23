-- FundFinder — richer business profile (2026-07-23)
-- Adds the narrative/quantitative fields the auto-apply drafter needs to write strong applications.
-- Safe to run multiple times.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS business_description TEXT,
  ADD COLUMN IF NOT EXISTS website              TEXT,
  ADD COLUMN IF NOT EXISTS funding_amount        TEXT,
  ADD COLUMN IF NOT EXISTS traction              TEXT;
