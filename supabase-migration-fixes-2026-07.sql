-- ============================================================
-- FundFinder AI — Fix migration (July 2026)
-- Fixes: profile "Save failed", organisation signup, and makes
-- signup work correctly once email confirmation is enabled.
--
-- HOW TO RUN:
--   Supabase Dashboard -> SQL Editor -> New query -> paste all -> Run.
--   Safe to run more than once (idempotent).
-- ============================================================

-- ------------------------------------------------------------
-- 1) PROFILE SAVE FIX
--    The profile page saves these columns but they were missing
--    from user_profiles, so every save was rejected. Add them.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 2) ORGANISATION TABLE — make sure it exists (no-op if present)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.program_principals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  org_name            TEXT,
  org_type            TEXT,
  registration_number TEXT,
  website             TEXT,
  contact_name        TEXT,
  contact_email       TEXT,
  contact_phone       TEXT,
  verified            BOOLEAN DEFAULT FALSE,
  program_name        TEXT,
  capital_type        TEXT,
  target_beneficiary  TEXT,
  eligibility_notes   TEXT,
  ngx_pathway_active  BOOLEAN DEFAULT FALSE,
  ngx_pathway_notes   TEXT,
  onboarding_complete BOOLEAN DEFAULT FALSE,
  onboarding_step     INTEGER DEFAULT 1,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- One organisation record per account (lets the trigger upsert safely)
CREATE UNIQUE INDEX IF NOT EXISTS uq_program_principals_user
  ON public.program_principals(user_id);

ALTER TABLE public.program_principals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PPs can view own record"   ON public.program_principals;
DROP POLICY IF EXISTS "PPs can update own record" ON public.program_principals;
DROP POLICY IF EXISTS "PPs can insert own record" ON public.program_principals;
CREATE POLICY "PPs can view own record"   ON public.program_principals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "PPs can update own record" ON public.program_principals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "PPs can insert own record" ON public.program_principals FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3) SIGNUP TRIGGER
--    Creates profile + wallet (20 free credits) on every signup,
--    now copying full_name / whatsapp from signup metadata.
--    If the person signed up as an organisation
--    (metadata.account_type = 'org') their program_principals row
--    is created here too — so the browser never has to write while
--    unauthenticated. This is what makes org signup work once email
--    confirmation is turned on.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, full_name, whatsapp, notify_email, notify_whatsapp)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'whatsapp',
    COALESCE((NEW.raw_user_meta_data->>'notify_email')::boolean, TRUE),
    COALESCE((NEW.raw_user_meta_data->>'notify_whatsapp')::boolean, TRUE)
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.wallets (user_id, balance_credits, total_credits_purchased)
  VALUES (NEW.id, 20, 0)
  ON CONFLICT (user_id) DO NOTHING;

  IF NEW.raw_user_meta_data->>'account_type' = 'org' THEN
    INSERT INTO public.program_principals (
      user_id, org_name, org_type, registration_number, website,
      contact_name, contact_email, contact_phone, program_name,
      capital_type, target_beneficiary, eligibility_notes,
      ngx_pathway_active, ngx_pathway_notes, onboarding_complete, onboarding_step
    )
    VALUES (
      NEW.id,
      NEW.raw_user_meta_data->>'org_name',
      NEW.raw_user_meta_data->>'org_type',
      NEW.raw_user_meta_data->>'registration_number',
      NEW.raw_user_meta_data->>'website',
      NEW.raw_user_meta_data->>'contact_name',
      COALESCE(NEW.raw_user_meta_data->>'contact_email', NEW.email),
      NEW.raw_user_meta_data->>'contact_phone',
      NEW.raw_user_meta_data->>'program_name',
      NEW.raw_user_meta_data->>'capital_type',
      NEW.raw_user_meta_data->>'target_beneficiary',
      NEW.raw_user_meta_data->>'eligibility_notes',
      COALESCE((NEW.raw_user_meta_data->>'ngx_pathway_active')::boolean, FALSE),
      NEW.raw_user_meta_data->>'ngx_pathway_notes',
      TRUE, 4
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------
-- 4) BACKFILL — give existing 0-credit users their 20 free credits
-- ------------------------------------------------------------
UPDATE public.wallets
SET balance_credits = 20
WHERE balance_credits = 0 AND total_credits_purchased = 0;
