-- ============================================================================
-- FundFinder — FIX: matches never appear
-- Run this once in Supabase → SQL Editor → New query → paste → Run.
--
-- Root cause: the matching engine (profile page runMatching()) and every read
-- (dashboard + profile loadMatches) use three columns on opportunity_matches
-- that were never created: opportunity_title, capital_type, deadline.
-- The upsert therefore failed silently and matches stayed empty at any profile %.
-- This adds the missing columns and guarantees the upsert's unique key exists.
-- Safe to run multiple times (idempotent).
-- ============================================================================

-- 1) Add the three missing columns the app reads & writes
ALTER TABLE public.opportunity_matches
  ADD COLUMN IF NOT EXISTS opportunity_title TEXT,
  ADD COLUMN IF NOT EXISTS capital_type      TEXT,
  ADD COLUMN IF NOT EXISTS deadline          DATE;

-- 2) Make sure the (user_id, opportunity_id) unique key exists so the
--    app's upsert(onConflict: 'user_id,opportunity_id') works.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_opportunity'
  ) THEN
    ALTER TABLE public.opportunity_matches
      ADD CONSTRAINT uq_user_opportunity UNIQUE (user_id, opportunity_id);
  END IF;
END $$;

-- 3) (Optional) quick sanity check — should return the 3 new columns:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'opportunity_matches'
--     AND column_name IN ('opportunity_title','capital_type','deadline');
