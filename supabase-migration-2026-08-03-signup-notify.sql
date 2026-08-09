-- FundFinder AI — Signup notification + funnel staging (2026-08-03)
-- Run this once in Supabase → SQL Editor.
--
-- Two things:
--   PART 1  every new auth.users row calls /api/notify-signup so the operator
--           gets an email and the contact lands in Zoho. Account signups were
--           previously silent — they created a profile and an empty wallet and
--           told nobody, including Zoho.
--   PART 2  a funnel_stage view that classifies every user from real conversion
--           signals, so the tiered email sequence has something to segment on.
--
-- SAFETY: the notify trigger is wrapped in its own EXCEPTION block. If pg_net
-- is missing, the endpoint is down, or the secret is wrong, the signup still
-- succeeds. A broken notification must never cost you a user.

-- ===========================================================================
-- PART 0 — prerequisites
-- ===========================================================================

-- pg_net gives us http_post from inside Postgres. Supabase ships it; it just
-- needs enabling once.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Somewhere to keep the endpoint + secret. Vault would be tidier, but a
-- one-row private table is easier to read back and rotate by hand.
CREATE TABLE IF NOT EXISTS private_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);
ALTER TABLE private_config ENABLE ROW LEVEL SECURITY;
-- No policies at all = no anon/authenticated access. Only SECURITY DEFINER
-- functions and the service role can read it.

-- >>> EDIT THESE TWO LINES <<<
-- NOTIFY_SECRET must match the Cloudflare env var of the same name exactly.
INSERT INTO private_config (key, value) VALUES
  ('notify_url',    'https://fundfinder.ng/api/notify-signup'),
  ('notify_secret', '9PrOBngltBoJz5vgbjcvKfACv6sO0ApoF3wEnZfLt4SBRiq0XYGP0_fb2lBKeJAV')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;


-- ===========================================================================
-- PART 1 — notify on every new account
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.notify_new_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  BEGIN
    SELECT value INTO v_url    FROM private_config WHERE key = 'notify_url';
    SELECT value INTO v_secret FROM private_config WHERE key = 'notify_secret';

    IF v_url IS NULL OR v_secret IS NULL THEN
      RETURN NEW;   -- not configured yet; stay quiet
    END IF;

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || v_secret
                 ),
      body    := jsonb_build_object(
                   'type',    'account',
                   'email',   NEW.email,
                   'user_id', NEW.id::text,
                   'name',    COALESCE(NEW.raw_user_meta_data->>'full_name',
                                       NEW.raw_user_meta_data->>'name', ''),
                   'phone',   COALESCE(NEW.raw_user_meta_data->>'whatsapp',
                                       NEW.raw_user_meta_data->>'phone', ''),
                   'source',  COALESCE(NEW.raw_user_meta_data->>'source', 'signup')
                 )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Swallow everything. The user's signup is more important than our email.
    NULL;
  END;

  RETURN NEW;
END;
$$;

-- Separate trigger rather than editing handle_new_user(), so a change here can
-- never break profile/wallet creation.
DROP TRIGGER IF EXISTS on_auth_user_created_notify ON auth.users;
CREATE TRIGGER on_auth_user_created_notify
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_signup();


-- ===========================================================================
-- PART 2 — funnel_stage: one row per person, with the stage they're stuck at
-- ===========================================================================
--
-- Stages, in order. A user sits at the highest one they've reached.
--
--   0_lead_no_account      email captured, never created an account
--   1_account_no_profile   account exists, business profile still empty
--   2_profile_no_action    profile done, but hasn't applied / drafted / raised
--   3_engaged_unpaid       took a real action, never paid
--   4_converted            paid — credits bought or a service transacted
--
-- "Profile complete" = the four narrative fields the AI matcher actually needs.
-- Adjust the column list here if the profile schema changes.

CREATE OR REPLACE VIEW public.funnel_stage AS
WITH profile_done AS (
  -- Column names verified against the live schema 2026-08-03: the profile
  -- fields are business_* prefixed, and profile_score already exists as the
  -- product's own completeness measure. Either signal counts.
  SELECT
    p.user_id,
    (
      (NULLIF(TRIM(p.business_name), '')     IS NOT NULL
       AND NULLIF(TRIM(p.business_sector), '')   IS NOT NULL
       AND NULLIF(TRIM(p.business_stage), '')    IS NOT NULL
       AND NULLIF(TRIM(p.business_location), '') IS NOT NULL)
      OR COALESCE(p.profile_score, 0) >= 80
    ) AS is_complete
  FROM public.user_profiles p
),
engagement AS (
  SELECT u.id AS user_id,
         -- program_applications keys on applicant_user_id, not user_id.
         EXISTS (SELECT 1 FROM public.program_applications a WHERE a.applicant_user_id = u.id) AS applied,
         EXISTS (SELECT 1 FROM public.spv_interests s        WHERE s.user_id = u.id)           AS jv
  FROM auth.users u
),
paid AS (
  SELECT t.user_id, SUM(t.amount_ngn) AS total_paid
  FROM public.transactions t
  WHERE t.status = 'success'
  GROUP BY t.user_id
)
SELECT
  u.id                                   AS user_id,
  u.email,
  u.created_at                           AS signed_up_at,
  CASE
    WHEN COALESCE(pd.total_paid, 0) > 0                       THEN '4_converted'
    WHEN e.applied OR e.jv                                    THEN '3_engaged_unpaid'
    WHEN COALESCE(pf.is_complete, false)                      THEN '2_profile_no_action'
    ELSE                                                           '1_account_no_profile'
  END                                    AS stage,
  COALESCE(pf.is_complete, false)        AS profile_complete,
  COALESCE(pd.total_paid, 0)             AS total_paid,
  GREATEST(0, DATE_PART('day', NOW() - u.created_at))::int AS days_since_signup
FROM auth.users u
LEFT JOIN profile_done pf ON pf.user_id = u.id
LEFT JOIN engagement   e  ON e.user_id  = u.id
LEFT JOIN paid         pd ON pd.user_id = u.id

UNION ALL

-- Email leads who never opened an account. Excluded once they do, so nobody
-- appears twice and nobody gets two sequences at once.
SELECT
  NULL::uuid,
  n.email,
  n.created_at,
  '0_lead_no_account',
  false,
  0,
  GREATEST(0, DATE_PART('day', NOW() - n.created_at))::int
FROM public.newsletter_subscribers n
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users u WHERE LOWER(u.email) = LOWER(n.email)
);

-- Admins read it from the dashboard; the sync job uses the service key.
REVOKE ALL ON public.funnel_stage FROM anon, authenticated;
GRANT SELECT ON public.funnel_stage TO service_role;


-- ===========================================================================
-- Verify
-- ===========================================================================
-- SELECT stage, COUNT(*) FROM public.funnel_stage GROUP BY stage ORDER BY stage;
--
-- To test the notifier without creating a real user, call the endpoint directly:
--   curl -X POST https://fundfinder.ng/api/notify-signup \
--     -H "Authorization: Bearer <NOTIFY_SECRET>" \
--     -H "Content-Type: application/json" \
--     -d '{"type":"account","email":"you@example.com","name":"Test"}'
