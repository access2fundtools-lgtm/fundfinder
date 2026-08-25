-- FundFinder AI — source tracking on user profiles (2026-08-25)
-- Run once in Supabase → SQL Editor.
--
-- Adds user_profiles.source and populates it at signup from the metadata the
-- auth page now captures (utm_source/utm_medium/utm_campaign, else referring
-- hostname, else 'direct').
--
-- SAFE TO RE-RUN. Additive only — no column is dropped or retyped, and
-- handle_new_user() keeps its existing behaviour of never failing a signup.

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS source TEXT;

COMMENT ON COLUMN public.user_profiles.source IS
  'Acquisition source captured at signup: "utm_source/utm_medium", "ref:<host>", or "direct".';

-- Reporting on this column is the whole point, so index it.
CREATE INDEX IF NOT EXISTS idx_user_profiles_source
  ON public.user_profiles (source);


-- ---------------------------------------------------------------------------
-- 2. Populate it at signup
-- ---------------------------------------------------------------------------
-- Rewritten in full rather than patched, so the profile+wallet behaviour stays
-- explicit and readable. The only change is the two extra columns.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Create profile, carrying through what the signup form already knows.
  INSERT INTO public.user_profiles (user_id, full_name, whatsapp, source)
  VALUES (
    NEW.id,
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'full_name',
                         NEW.raw_user_meta_data->>'name', '')), ''),
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'whatsapp',
                         NEW.raw_user_meta_data->>'phone', '')), ''),
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'source', 'direct')), '')
  )
  ON CONFLICT (user_id) DO UPDATE
    SET source    = COALESCE(public.user_profiles.source, EXCLUDED.source),
        full_name = COALESCE(public.user_profiles.full_name, EXCLUDED.full_name),
        whatsapp  = COALESCE(public.user_profiles.whatsapp,  EXCLUDED.whatsapp);

  -- Create wallet with 0 credits
  INSERT INTO public.wallets (user_id, balance_credits)
  VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------------------------------------------------------------------------
-- 3. Where signups actually come from
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.signup_sources AS
SELECT
  COALESCE(NULLIF(TRIM(source), ''), 'unknown') AS source,
  COUNT(*)                                       AS signups,
  MIN(created_at)                                AS first_seen,
  MAX(created_at)                                AS last_seen
FROM public.user_profiles
GROUP BY 1
ORDER BY signups DESC;


-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'user_profiles' AND column_name = 'source';
-- SELECT * FROM public.signup_sources;
--
-- NOTE: existing rows keep source = NULL and show as 'unknown'. That is
-- correct — we genuinely do not know where they came from, and backfilling a
-- guess would poison the only channel data you have.
