-- ============================================================
-- FundFinder AI — Phase 7 Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── 1. Add missing columns to user_profiles ─────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS city                  TEXT,
  ADD COLUMN IF NOT EXISTS gender                TEXT,
  ADD COLUMN IF NOT EXISTS annual_revenue        TEXT,
  ADD COLUMN IF NOT EXISTS funding_purpose       TEXT,
  ADD COLUMN IF NOT EXISTS scholarship_countries TEXT,
  ADD COLUMN IF NOT EXISTS cac_number            TEXT,
  ADD COLUMN IF NOT EXISTS bank_name             TEXT,
  ADD COLUMN IF NOT EXISTS nin                   TEXT,
  ADD COLUMN IF NOT EXISTS bvn_last4             TEXT;

-- ── 2. Opportunities table ───────────────────────────────────
-- Structured storage for scraped funding opportunities.
-- The scraper writes here in addition to generating HTML files.
CREATE TABLE IF NOT EXISTS public.opportunities (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Core info
  title          TEXT NOT NULL,
  slug           TEXT UNIQUE,                   -- matches the HTML filename slug
  source_url     TEXT,                          -- original article/post URL
  apply_url      TEXT,                          -- direct application link (if found)
  organiser      TEXT,                          -- e.g. Tony Elumelu Foundation
  summary        TEXT,                          -- 2-3 sentence description

  -- Matching fields (set by scraper or manually)
  capital_type   TEXT DEFAULT 'grant'           -- grant | loan | equity | training | fellowship
                   CHECK (capital_type IN ('grant','loan','equity','training','fellowship','scholarship','other')),
  sectors        TEXT[] DEFAULT '{}',           -- e.g. ['agriculture','technology']
  amount_min     BIGINT,                        -- minimum amount in Naira (0 if unknown)
  amount_max     BIGINT,                        -- maximum amount in Naira
  amount_text    TEXT,                          -- human-readable amount string

  -- Eligibility (plain text for fuzzy matching + structured)
  eligibility    TEXT DEFAULT '',               -- raw eligibility text for scoring
  gender_target  TEXT DEFAULT 'all'             -- all | female | male
                   CHECK (gender_target IN ('all','female','male')),
  age_min        INTEGER,
  age_max        INTEGER,
  requires_cac   BOOLEAN DEFAULT FALSE,
  requires_student BOOLEAN DEFAULT FALSE,
  target_states  TEXT[] DEFAULT '{}',           -- empty = nationwide
  target_sectors TEXT[] DEFAULT '{}',           -- empty = all sectors

  -- Dates
  deadline       DATE,                          -- NULL = rolling / no deadline
  opens_at       DATE,
  scraped_at     DATE DEFAULT CURRENT_DATE,
  is_active      BOOLEAN DEFAULT TRUE,          -- false when deadline passed

  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opp_active     ON public.opportunities(is_active);
CREATE INDEX IF NOT EXISTS idx_opp_deadline   ON public.opportunities(deadline);
CREATE INDEX IF NOT EXISTS idx_opp_type       ON public.opportunities(capital_type);
CREATE INDEX IF NOT EXISTS idx_opp_gender     ON public.opportunities(gender_target);
CREATE INDEX IF NOT EXISTS idx_opp_scraped    ON public.opportunities(scraped_at);

-- RLS
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active opportunities"
  ON public.opportunities FOR SELECT
  USING (is_active = TRUE);

-- Allow the scraper (anon key) to insert/upsert new opportunities
CREATE POLICY "Anon can insert opportunities"
  ON public.opportunities FOR INSERT
  TO anon
  WITH CHECK (TRUE);

-- Allow the scraper to update existing rows (for upsert on slug conflict)
CREATE POLICY "Anon can update opportunities"
  ON public.opportunities FOR UPDATE
  TO anon
  USING (TRUE)
  WITH CHECK (TRUE);

-- ── 3. Update opportunity_matches to add apply_url + status ─
ALTER TABLE public.opportunity_matches
  ADD COLUMN IF NOT EXISTS apply_url          TEXT,
  ADD COLUMN IF NOT EXISTS matched_at         TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS application_draft  TEXT,        -- AI-drafted application text
  ADD COLUMN IF NOT EXISTS applied_at         TIMESTAMPTZ, -- when user clicked Apply
  ADD COLUMN IF NOT EXISTS notes              TEXT;

-- Unique constraint so upsert works cleanly
ALTER TABLE public.opportunity_matches
  DROP CONSTRAINT IF EXISTS uq_user_opportunity;
ALTER TABLE public.opportunity_matches
  ADD CONSTRAINT uq_user_opportunity UNIQUE (user_id, opportunity_id);

-- ── 4. Auto-deactivate opportunities past their deadline ─────
CREATE OR REPLACE FUNCTION public.deactivate_expired_opportunities()
RETURNS void AS $$
  UPDATE public.opportunities
  SET is_active = FALSE, updated_at = NOW()
  WHERE deadline < CURRENT_DATE AND is_active = TRUE;
$$ LANGUAGE sql SECURITY DEFINER;

-- ── DONE ─────────────────────────────────────────────────────
-- Run steps:
--   1. Paste this entire file into Supabase SQL Editor
--   2. Click Run
--   3. No data will be lost — this only adds new columns/tables
-- ============================================================
