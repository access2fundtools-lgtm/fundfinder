-- ============================================================================
-- FundFinder — SPV Consolidation MVP (discover partners + express interest)
-- Run once in Supabase → SQL Editor → paste → Run.
-- ============================================================================

-- Expressions of interest in forming / joining a consolidated SPV.
CREATE TABLE IF NOT EXISTS public.spv_interests (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  opportunity_id TEXT,                         -- optional: an SPV aimed at a specific opportunity (slug)
  kind           TEXT NOT NULL DEFAULT 'open'  -- 'open' = open to consolidating
                   CHECK (kind IN ('open','candidate','invite')),
  candidate_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- a specific suggested partner they liked
  invited_email  TEXT,                         -- for the manual "invite a partner" path
  note           TEXT,
  status         TEXT NOT NULL DEFAULT 'interested'
                   CHECK (status IN ('interested','matched','withdrawn')),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spv_interests_user       ON public.spv_interests(user_id);
CREATE INDEX IF NOT EXISTS idx_spv_interests_candidate  ON public.spv_interests(candidate_user_id);

ALTER TABLE public.spv_interests ENABLE ROW LEVEL SECURITY;

-- Users manage only their own interest rows.
DROP POLICY IF EXISTS "Users manage own spv interests" ON public.spv_interests;
CREATE POLICY "Users manage own spv interests" ON public.spv_interests
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Admins can read all (for the admin dashboard / A2F curation).
DROP POLICY IF EXISTS "Admins read all spv interests" ON public.spv_interests;
CREATE POLICY "Admins read all spv interests" ON public.spv_interests
  FOR SELECT USING (public.is_admin(auth.uid()));

-- The Cloudflare Function writes with the service_role key, which bypasses RLS,
-- but grant the authenticated role too (in case of direct client inserts).
GRANT SELECT, INSERT, UPDATE ON public.spv_interests TO authenticated;
