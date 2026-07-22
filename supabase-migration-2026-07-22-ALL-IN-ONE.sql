-- ============================================================================
-- FundFinder — ALL PENDING MIGRATIONS, IN ONE FILE (2026-07-22)
-- Run once in Supabase → SQL Editor → New query → paste ALL of this → Run.
-- Safe & idempotent. Order matters (handle_new_user fix is last so it wins).
-- NOTE: this does NOT cover the "Confirm email" toggle — that's a dashboard
-- switch: Auth → Providers → Email → turn OFF "Confirm email".
-- ============================================================================


-- ############################################################################
-- SECTION 1 of 4 — Profile fields exist (so every profile field saves)  [#19]
-- ############################################################################
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


-- ############################################################################
-- SECTION 2 of 4 — Matches columns + upsert key (fixes empty matches)   [#16]
-- ############################################################################
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

-- ############################################################################
-- SECTION 3 of 4 — A2F program descriptions                            [#27]
-- ############################################################################
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

-- ############################################################################
-- SECTION 4 of 4 — Org-registration fix (handle_new_user) — MUST BE LAST [#29]
-- ############################################################################
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_principal_id UUID;
  v_prog_name    TEXT := NEW.raw_user_meta_data->>'program_name';
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
    -- 1) org identity
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
      v_prog_name,
      NEW.raw_user_meta_data->>'capital_type',
      NEW.raw_user_meta_data->>'target_beneficiary',
      NEW.raw_user_meta_data->>'eligibility_notes',
      COALESCE((NEW.raw_user_meta_data->>'ngx_pathway_active')::boolean, FALSE),
      NEW.raw_user_meta_data->>'ngx_pathway_notes',
      TRUE, 4
    )
    ON CONFLICT (user_id) DO NOTHING;

    -- 2) the actual program → this INSERT fires trg_sync_principal_program,
    --    which publishes a public opportunities row. Guard against duplicates.
    SELECT id INTO v_principal_id FROM public.program_principals WHERE user_id = NEW.id;

    IF v_principal_id IS NOT NULL AND v_prog_name IS NOT NULL AND v_prog_name <> '' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.principal_programs
        WHERE principal_id = v_principal_id AND program_name = v_prog_name
      ) THEN
        INSERT INTO public.principal_programs (
          principal_id, program_name, program_category, capital_type,
          funding_min_ngn, funding_max_ngn, target_geography,
          target_beneficiary, eligibility_notes, program_open, deadline
        )
        VALUES (
          v_principal_id,
          v_prog_name,
          'funding',
          NEW.raw_user_meta_data->>'capital_type',
          NULLIF(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'funding_min',''), '[^0-9]', '', 'g'), '')::bigint,
          NULLIF(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'funding_max',''), '[^0-9]', '', 'g'), '')::bigint,
          CASE WHEN COALESCE(NEW.raw_user_meta_data->>'target_geography','') = '' THEN '{}'::text[]
               ELSE ARRAY[NEW.raw_user_meta_data->>'target_geography'] END,
          NEW.raw_user_meta_data->>'target_beneficiary',
          NEW.raw_user_meta_data->>'eligibility_notes',
          TRUE,
          NULLIF(NEW.raw_user_meta_data->>'deadline','')::date
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- trigger already exists (on_auth_user_created); no need to recreate.

-- Cleanup for the QA test submission (safe to run):
-- DELETE FROM public.principal_programs WHERE program_name = 'QA TEST PROGRAM - DELETE ME';
-- DELETE FROM public.program_principals WHERE org_name = 'QA TEST ORG - DELETE ME';
-- (the auth user access2fundtools+orgtest@gmail.com can be deleted from Auth → Users)
