-- FundFinder AI — Fix Auth: RLS Policies + Auto-confirm + Trigger
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run All
-- ====================================================================

-- 1. TURN OFF EMAIL CONFIRMATION (users can login immediately after signup)
--    Go to: Supabase Dashboard → Authentication → Settings → Email Auth
--    Toggle OFF "Enable email confirmations"
--    OR run this (may not work on all Supabase tiers):
-- UPDATE auth.config SET mailer_autoconfirm = true WHERE id = 1;

-- 2. FIX user_profiles RLS — allow authenticated users to read/write their own profile
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist
DROP POLICY IF EXISTS "Users can read own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;

-- Create proper policies
CREATE POLICY "Users can read own profile"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON public.user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- 3. FIX wallets RLS
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own wallet" ON public.wallets;
DROP POLICY IF EXISTS "Users can update own wallet" ON public.wallets;

CREATE POLICY "Users can read own wallet"
  ON public.wallets FOR SELECT
  USING (auth.uid() = user_id);

-- 4. AUTO-CREATE profile + wallet on signup via trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, full_name, whatsapp, notify_email, notify_whatsapp)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'whatsapp',
    COALESCE((NEW.raw_user_meta_data->>'notify_email')::boolean, true),
    COALESCE((NEW.raw_user_meta_data->>'notify_whatsapp')::boolean, true)
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.wallets (user_id, balance_credits, total_credits_purchased)
  VALUES (NEW.id, 20, 0)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 5. Backfill: create profiles/wallets for users who signed up before the trigger
INSERT INTO public.user_profiles (user_id, full_name)
SELECT id, raw_user_meta_data->>'full_name'
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM public.user_profiles)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.wallets (user_id, balance_credits, total_credits_purchased)
SELECT id, 20, 0
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM public.wallets)
ON CONFLICT (user_id) DO NOTHING;

-- 6. Verify
SELECT 'user_profiles count' as table_name, COUNT(*) FROM public.user_profiles
UNION ALL
SELECT 'wallets count', COUNT(*) FROM public.wallets
UNION ALL
SELECT 'auth users count', COUNT(*) FROM auth.users;
