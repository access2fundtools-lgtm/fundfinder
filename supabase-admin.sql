-- ============================================================
-- FundFinder AI — Admin backend + security hardening
-- Idempotent. Run in Supabase SQL Editor.
-- ============================================================

-- 1) ADMINS TABLE + is_admin() helper -----------------------
CREATE TABLE IF NOT EXISTS public.admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins can read own admin row" ON public.admins;
CREATE POLICY "admins can read own admin row" ON public.admins
  FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.is_admin(uid UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.admins WHERE user_id = uid);
$$;

-- Designate the admin account
INSERT INTO public.admins (user_id)
SELECT id FROM auth.users WHERE email = 'fluersdigitalmedia@gmail.com'
ON CONFLICT DO NOTHING;

-- 2) EMAIL ON user_profiles (so admin can identify people) ---
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS email TEXT;
UPDATE public.user_profiles p
  SET email = u.email
  FROM auth.users u
  WHERE u.id = p.user_id AND p.email IS NULL;

-- Keep email in sync on new signups (extends existing trigger fn)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, email, full_name, whatsapp, notify_email, notify_whatsapp)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'whatsapp',
          COALESCE((NEW.raw_user_meta_data->>'notify_email')::boolean, TRUE),
          COALESCE((NEW.raw_user_meta_data->>'notify_whatsapp')::boolean, TRUE))
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.wallets (user_id, balance_credits, total_credits_purchased)
  VALUES (NEW.id, 20, 0) ON CONFLICT (user_id) DO NOTHING;

  IF NEW.raw_user_meta_data->>'account_type' = 'org' THEN
    INSERT INTO public.program_principals (
      user_id, org_name, org_type, registration_number, website, contact_name,
      contact_email, contact_phone, program_name, capital_type, target_beneficiary,
      eligibility_notes, ngx_pathway_active, ngx_pathway_notes, onboarding_complete, onboarding_step)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'org_name', NEW.raw_user_meta_data->>'org_type',
      NEW.raw_user_meta_data->>'registration_number', NEW.raw_user_meta_data->>'website',
      NEW.raw_user_meta_data->>'contact_name', COALESCE(NEW.raw_user_meta_data->>'contact_email', NEW.email),
      NEW.raw_user_meta_data->>'contact_phone', NEW.raw_user_meta_data->>'program_name',
      NEW.raw_user_meta_data->>'capital_type', NEW.raw_user_meta_data->>'target_beneficiary',
      NEW.raw_user_meta_data->>'eligibility_notes',
      COALESCE((NEW.raw_user_meta_data->>'ngx_pathway_active')::boolean, FALSE),
      NEW.raw_user_meta_data->>'ngx_pathway_notes', TRUE, 4)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

-- 3) ADMIN READ/UPDATE POLICIES -----------------------------
DROP POLICY IF EXISTS "Admins read all profiles"     ON public.user_profiles;
CREATE POLICY "Admins read all profiles"     ON public.user_profiles     FOR SELECT USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins read all wallets"      ON public.wallets;
CREATE POLICY "Admins read all wallets"      ON public.wallets           FOR SELECT USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins read all transactions" ON public.transactions;
CREATE POLICY "Admins read all transactions" ON public.transactions      FOR SELECT USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins read all orgs"         ON public.program_principals;
CREATE POLICY "Admins read all orgs"         ON public.program_principals FOR SELECT USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins update orgs"           ON public.program_principals;
CREATE POLICY "Admins update orgs"           ON public.program_principals FOR UPDATE USING (public.is_admin(auth.uid()));

-- 4) SECURITY: users must NOT be able to credit themselves ---
REVOKE EXECUTE ON FUNCTION public.add_credits(uuid, integer)    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deduct_credits(uuid, integer) FROM anon, authenticated;

-- 5) ADMIN credit adjustment (checked, callable from admin UI)
CREATE OR REPLACE FUNCTION public.admin_adjust_credits(p_user_id UUID, p_delta INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_bal INTEGER;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  UPDATE public.wallets
     SET balance_credits         = GREATEST(0, balance_credits + p_delta),
         total_credits_purchased = total_credits_purchased + GREATEST(p_delta, 0),
         updated_at              = NOW()
   WHERE user_id = p_user_id
   RETURNING balance_credits INTO new_bal;
  IF new_bal IS NULL THEN RAISE EXCEPTION 'wallet not found'; END IF;
  RETURN new_bal;
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer) TO authenticated;

-- 6) Verify: who is admin now
SELECT u.email FROM public.admins a JOIN auth.users u ON u.id = a.user_id;
