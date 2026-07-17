-- ============================================================
-- FundFinder AI — A2F Partners as Program Principal
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- Adds the missing one-principal-to-many-programs structure, auto-
-- verifies A2F Partners as the platform's own program principal
-- (unlike external orgs, which go through program-principal-register.html
-- and manual admin verification), and lists A2F's five in-house
-- programs so they're discoverable through the same hub/matching
-- engine as scraped third-party opportunities.
--
-- FIX (2026-07-16, applied live before this file was updated): the
-- sync trigger was originally an AFTER INSERT/UPDATE trigger that
-- issued a separate UPDATE on the same row to store opportunity_id —
-- that UPDATE re-fired the same AFTER trigger, causing infinite
-- recursion ("stack depth limit exceeded"). Fixed by making it a
-- BEFORE trigger that sets NEW.opportunity_id directly instead of
-- issuing a second UPDATE statement. This file reflects the fixed,
-- actually-applied version.
-- ============================================================

-- ── 1. principal_programs: one principal, many programs ──────
-- program_principals stayed 1-row-per-program (org_name + program_name
-- as sibling columns) — fine for a single-program org, but A2F (and
-- eventually any multi-fund principal like a DFI) needs several
-- programs under one verified identity. This table is that layer;
-- program_principals now represents ORG IDENTITY ONLY going forward.
CREATE TABLE IF NOT EXISTS public.principal_programs (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  principal_id       UUID REFERENCES public.program_principals(id) ON DELETE CASCADE NOT NULL,
  program_name       TEXT NOT NULL,
  program_category   TEXT NOT NULL DEFAULT 'funding'
                       CHECK (program_category IN ('funding','enrollment','advisory','investment_vehicle')),
  -- Superset of program_principals.capital_type — adds categories that
  -- aren't a capital disbursement at all (enrollment, advisory, investment).
  capital_type       TEXT CHECK (capital_type IN (
                       'grant','soft_loan','empowerment','credit_guarantee',
                       'blended_finance','equity','mixed','enrollment','advisory','investment')),
  funding_min_ngn    BIGINT,   -- NULL for enrollment programs (no amount)
  funding_max_ngn    BIGINT,
  amount_text        TEXT,     -- human-readable override, e.g. "Deal size ₦300M–₦10B" or "Min unit ₦500,000"
  target_sectors     TEXT[] DEFAULT '{}',
  target_geography   TEXT[] DEFAULT '{}',
  target_beneficiary TEXT CHECK (target_beneficiary IN ('individuals','smes','both','ngos')),
  eligibility_notes  TEXT,
  disbursement_notes TEXT,
  apply_cta          TEXT DEFAULT 'Apply',  -- 'Apply' | 'Enroll' | 'Invest' — drives hub button copy
  program_open       BOOLEAN DEFAULT TRUE,
  deadline           DATE,     -- NULL = rolling
  opportunity_id     UUID REFERENCES public.opportunities(id) ON DELETE SET NULL, -- synced public listing
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_principal_programs_principal ON public.principal_programs(principal_id);

ALTER TABLE public.principal_programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Principals manage own programs" ON public.principal_programs;
CREATE POLICY "Principals manage own programs"
  ON public.principal_programs FOR ALL
  USING (principal_id IN (SELECT id FROM public.program_principals WHERE user_id = auth.uid()))
  WITH CHECK (principal_id IN (SELECT id FROM public.program_principals WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Anyone can read open programs" ON public.principal_programs;
CREATE POLICY "Anyone can read open programs"
  ON public.principal_programs FOR SELECT
  USING (program_open = TRUE);

-- ── 2. Sync function: principal_programs row → public opportunities row ──
-- BEFORE trigger, mutates NEW.opportunity_id directly — do NOT change
-- this back to an AFTER trigger with a separate UPDATE statement, that
-- causes infinite recursion (confirmed live 2026-07-16).
CREATE OR REPLACE FUNCTION public.sync_principal_program_to_opportunity()
RETURNS TRIGGER AS $$
DECLARE
  v_org_name   TEXT;
  v_opp_id     UUID;
  v_mapped_cap TEXT;
BEGIN
  SELECT org_name INTO v_org_name FROM public.program_principals WHERE id = NEW.principal_id;

  -- opportunities.capital_type uses a different, narrower enum
  -- ('grant','loan','equity','training','fellowship','scholarship','other')
  -- than principal_programs does — map explicitly rather than let a
  -- mismatched value silently fail the insert.
  v_mapped_cap := CASE NEW.capital_type
    WHEN 'soft_loan' THEN 'loan'
    WHEN 'credit_guarantee' THEN 'loan'
    WHEN 'equity' THEN 'equity'
    WHEN 'mixed' THEN 'equity'
    WHEN 'blended_finance' THEN 'equity'
    WHEN 'grant' THEN 'grant'
    WHEN 'empowerment' THEN 'other'
    WHEN 'enrollment' THEN 'other'
    WHEN 'advisory' THEN 'other'
    WHEN 'investment' THEN 'other'
    ELSE 'other'
  END;

  INSERT INTO public.opportunities (
    title, slug, organiser, summary, capital_type, sectors,
    amount_min, amount_max, amount_text, eligibility,
    target_states, target_sectors, deadline, apply_url, is_active, auto_apply_supported
  ) VALUES (
    NEW.program_name,
    'a2f-' || lower(regexp_replace(NEW.program_name, '[^a-zA-Z0-9]+', '-', 'g')),
    v_org_name,
    COALESCE(NEW.disbursement_notes, NEW.eligibility_notes, ''),
    v_mapped_cap,
    NEW.target_sectors,
    NEW.funding_min_ngn, NEW.funding_max_ngn, NEW.amount_text,
    COALESCE(NEW.eligibility_notes, ''),
    NEW.target_geography, NEW.target_sectors, NEW.deadline,
    '/fundfinder-auth.html?program=' || NEW.id,
    NEW.program_open,
    FALSE  -- A2F's own programs don't have a scrapeable external apply_url yet;
           -- question extraction needs its own per-program setup, not the
           -- generic page-scrape path in functions/api/auto-apply.js.
  )
  ON CONFLICT (slug) DO UPDATE SET
    title = EXCLUDED.title, summary = EXCLUDED.summary, capital_type = EXCLUDED.capital_type,
    sectors = EXCLUDED.sectors, amount_min = EXCLUDED.amount_min, amount_max = EXCLUDED.amount_max,
    amount_text = EXCLUDED.amount_text, eligibility = EXCLUDED.eligibility,
    target_states = EXCLUDED.target_states, target_sectors = EXCLUDED.target_sectors,
    deadline = EXCLUDED.deadline, is_active = EXCLUDED.is_active, updated_at = NOW()
  RETURNING id INTO v_opp_id;

  NEW.opportunity_id := v_opp_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_principal_program ON public.principal_programs;
CREATE TRIGGER trg_sync_principal_program
  BEFORE INSERT OR UPDATE ON public.principal_programs
  FOR EACH ROW EXECUTE FUNCTION public.sync_principal_program_to_opportunity();

-- ── 3. A2F Partners as an auto-verified program principal ────
-- Unlike external orgs (which self-register through
-- program-principal-register.html and wait on manual admin
-- verification in admin.html), A2F operates the platform, so it's
-- inserted pre-verified rather than run through its own trust queue.
INSERT INTO public.program_principals (
  org_name, org_type, contact_name, contact_email, verified, verified_at, onboarding_complete
) VALUES (
  'A2F Partners', 'other', 'Dayo Akin', 'access2fundtools@gmail.com', TRUE, NOW(), TRUE
)
ON CONFLICT DO NOTHING;

-- ── 4. The five programs ──────────────────────────────────────
-- Criteria drafted 2026-07-16, confirmed with Dayo as final (Dayo:
-- "you are the CEO, choose the best numbers" — grounded against real
-- Nigerian benchmarks: DBN's own tiers run micro=₦10M/small=₦150M/
-- medium=₦600M, BOI floor=₦5M; NREIT (largest listed Nigerian REIT)
-- trades ~₦103-105/unit with no formal minimum, ₦500K is the standard
-- practical entry ticket for a private/managed Nigerian real estate
-- investment scheme instead):
--   Debt Finance ₦2M–₦150M (fills the gap DBN/BOI's own tiers leave open)
--   SPV ₦150M–₦2B (starts where Debt Finance ends; structured/pooled
--     capital for a specific asset — real estate, infrastructure,
--     agribusiness aggregation, energy)
--   M&A ₦300M–₦10B target DEAL size (not capital raised — an advisory
--     service for established, revenue-generating businesses)
--   MREIF ₦500,000 minimum unit, no ceiling; Lagos/Abuja/Port Harcourt
--     (real estate investment vehicle — applicant invests, doesn't
--     receive funding, so this runs in the opposite direction of
--     every other program here)
--   Agrithon/FarmID: enrollment, not a capital program at all — makes
--     farmers eligible for other financing rather than disbursing any
DO $$
DECLARE v_principal_id UUID;
BEGIN
  SELECT id INTO v_principal_id FROM public.program_principals WHERE org_name = 'A2F Partners' LIMIT 1;

  INSERT INTO public.principal_programs (
    principal_id, program_name, program_category, capital_type,
    funding_min_ngn, funding_max_ngn, amount_text,
    target_beneficiary, target_geography, eligibility_notes, disbursement_notes, apply_cta
  ) VALUES
  (v_principal_id, 'Agrithon (FarmID)', 'enrollment', 'enrollment',
    NULL, NULL, 'No cash disbursed — unlocks eligibility for input financing, off-take, and government programs',
    'individuals', '{}',
    'Any Nigerian smallholder farmer. Valid NIN, or willing to obtain one during enrollment. Identifiable/GPS-mappable farmland. Cooperative membership optional but recorded if present.',
    'Digital enrollment: verified identity (NIN), GPS-mapped farm boundaries, crops, cooperative membership. Every farmer gets a scannable ID card; every record exports in National Digital Farmers Registry format.',
    'Enroll'),
  (v_principal_id, 'A2F Debt Finance', 'funding', 'soft_loan',
    2000000, 150000000, NULL,
    'smes', '{}',
    'Registered (CAC) business, 6+ months operating history, basic financials/bank statements available.',
    'A2F matches applicants to the appropriate lender/loan product rather than lending directly.',
    'Apply'),
  (v_principal_id, 'A2F SPV', 'funding', 'mixed',
    150000000, 2000000000, NULL,
    'smes', '{}',
    'Registered (CAC) business, 2-3+ years operating history, verifiable revenue or management accounts, asset-backed or cash-flow-generating (real estate, infrastructure, agribusiness aggregation, energy).',
    'Structured/pooled capital via a Special Purpose Vehicle for a specific asset or project.',
    'Apply'),
  (v_principal_id, 'A2F M&A', 'advisory', 'advisory',
    NULL, NULL, 'Target deal size ₦300,000,000–₦10,000,000,000',
    'smes', '{}',
    'Established, profitable-or-near-profitable business seeking to be acquired, to acquire, or to consolidate.',
    'Advisory service — no capital is disbursed directly; A2F structures and facilitates the transaction.',
    'Apply'),
  (v_principal_id, 'A2F MREIF', 'investment_vehicle', 'investment',
    500000, NULL, 'Minimum unit ₦500,000, no ceiling',
    'both', ARRAY['Lagos','Abuja','Port Harcourt'],
    'Nigerian individuals or registered businesses wanting to own real estate via a pooled investment structure.',
    'Applicant invests to acquire real estate exposure — this runs in the opposite direction of a funding program (money moves from applicant to the vehicle, not the reverse).',
    'Invest')
  ON CONFLICT DO NOTHING;
END $$;

-- ── DONE ─────────────────────────────────────────────────────
-- Still needed (separate build, not covered by this migration):
--   - Real per-program application questions (opportunity_questions
--     rows) for each of the 5 — functions/api/auto-apply.js can only
--     extract questions from a live external apply_url, and these
--     programs don't have one yet. Needs direct inserts once the
--     actual application questions for each program are drafted.
--   - A real landing/intake page per program (apply_url currently
--     points at a query-string stub on fundfinder-auth.html).
--   - Hub UI: apply_cta ('Apply'/'Enroll'/'Invest') isn't wired into
--     opportunity-hub.html's card rendering yet — currently every
--     card still shows "Apply Now" regardless of this field.
-- ============================================================
