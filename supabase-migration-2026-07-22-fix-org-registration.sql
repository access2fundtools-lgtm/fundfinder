-- ============================================================================
-- FundFinder — FIX: program-organizer registration never creates a matchable
-- program. Run once in Supabase → SQL Editor → paste → Run.
--
-- Bug: handle_new_user() (org branch) creates only the program_principals
-- (org identity) row. It never inserts into principal_programs — but the
-- sync-to-opportunities trigger (trg_sync_principal_program) fires on
-- principal_programs. So an organizer's program is never published/matchable.
-- (The 5 A2F programs work only because their principal_programs rows were
-- hand-inserted by the a2f migration.)
--
-- This CREATE OR REPLACE keeps the existing behaviour (user_profiles + wallet
-- + program_principals) and ADDS a principal_programs insert from signup
-- metadata, which fires the sync trigger and publishes the opportunity.
-- ============================================================================

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
