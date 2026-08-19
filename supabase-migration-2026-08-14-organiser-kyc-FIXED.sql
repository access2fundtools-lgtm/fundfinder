-- FundFinder — Organiser KYC gate (FIXED, 2026-08-14)
-- Supersedes supabase-migration-2026-07-30-organiser-kyc.sql.
--
-- WHAT WAS BROKEN: the 30 Jul file referenced public.opportunities.principal_program_id
-- in the trigger function and in steps 4 and 5, but never created that column. The file
-- therefore failed partway through on a clean database.
-- WHAT CHANGED: adds the missing column (step 3b below). Nothing else is altered.
-- STATUS: the corrected SQL has already been applied to Supabase directly — verified
-- 2026-08-19 by PostgREST probe (opportunities.principal_program_id resolves, control
-- column returns 42703). This file is committed so the broken version stops misleading.
-- Safe to run multiple times.

-- 1. Verification columns on the organisation record
ALTER TABLE public.program_principals
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending',  -- pending | verified | rejected
  ADD COLUMN IF NOT EXISTS verified_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by         TEXT,
  ADD COLUMN IF NOT EXISTS verification_notes  TEXT,
  ADD COLUMN IF NOT EXISTS kyc_accepted_at     TIMESTAMPTZ;

-- 2. Same on the programme record
ALTER TABLE public.principal_programs
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending';

-- 3. THE GATE: an opportunity created from an organiser programme starts INACTIVE.
--    Existing A2F/scraped opportunities are untouched.
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS source_type TEXT;  -- 'organiser' | 'scraped' | 'a2f'

-- 3b. MISSING COLUMN — the link from an opportunity back to the organiser programme.
--     Referenced below and in steps 4 and 5; absent from the 30 Jul file.
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS principal_program_id UUID;

CREATE OR REPLACE FUNCTION public.gate_unverified_organiser_opportunity()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  -- only applies to rows that came from an organiser-submitted programme
  IF NEW.principal_program_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pp.verification_status INTO v_status
  FROM public.principal_programs pr
  JOIN public.program_principals pp ON pp.id = pr.principal_id
  WHERE pr.id = NEW.principal_program_id;

  NEW.source_type := COALESCE(NEW.source_type, 'organiser');

  IF v_status IS DISTINCT FROM 'verified' THEN
    NEW.is_active := FALSE;   -- invisible to applicants until verified
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_gate_unverified_opportunity ON public.opportunities;
CREATE TRIGGER trg_gate_unverified_opportunity
  BEFORE INSERT OR UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.gate_unverified_organiser_opportunity();

-- 4. When you verify an organisation, its programmes go live automatically.
CREATE OR REPLACE FUNCTION public.publish_on_verification()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.verification_status = 'verified' AND OLD.verification_status IS DISTINCT FROM 'verified' THEN
    UPDATE public.principal_programs SET verification_status = 'verified' WHERE principal_id = NEW.id;
    UPDATE public.opportunities o SET is_active = TRUE
      FROM public.principal_programs pr
      WHERE pr.principal_id = NEW.id AND o.principal_program_id = pr.id;
    NEW.verified_at := NOW();
  END IF;
  IF NEW.verification_status = 'rejected' AND OLD.verification_status IS DISTINCT FROM 'rejected' THEN
    UPDATE public.opportunities o SET is_active = FALSE
      FROM public.principal_programs pr
      WHERE pr.principal_id = NEW.id AND o.principal_program_id = pr.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_publish_on_verification ON public.program_principals;
CREATE TRIGGER trg_publish_on_verification
  BEFORE UPDATE ON public.program_principals
  FOR EACH ROW EXECUTE FUNCTION public.publish_on_verification();

-- 5. Retro-safety: hide any organiser programme already live but unverified.
UPDATE public.opportunities o SET is_active = FALSE
  FROM public.principal_programs pr
  JOIN public.program_principals pp ON pp.id = pr.principal_id
  WHERE o.principal_program_id = pr.id
    AND pp.verification_status IS DISTINCT FROM 'verified';

-- ── HOW YOU VERIFY (run per organisation, after checking RC + website) ──
-- UPDATE public.program_principals
--    SET verification_status = 'verified', verified_by = 'Dayo', verification_notes = 'RC confirmed on CAC register; website live'
--  WHERE org_name = 'THE ORG NAME';
--
-- To reject:
-- UPDATE public.program_principals
--    SET verification_status = 'rejected', verification_notes = 'RC not found on register'
--  WHERE org_name = 'THE ORG NAME';
