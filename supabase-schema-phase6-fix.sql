-- ============================================================
-- FundFinder AI — Phase 6 Policy Fix
-- Run this if you get "policy already exists" errors.
-- Drops and recreates all Phase 6 RLS policies safely.
-- Tables are left untouched (already created).
-- ============================================================

-- ── program_principals ──────────────────────────────────────
DROP POLICY IF EXISTS "PPs can view own record"   ON public.program_principals;
DROP POLICY IF EXISTS "PPs can update own record" ON public.program_principals;
DROP POLICY IF EXISTS "PPs can insert own record" ON public.program_principals;

ALTER TABLE public.program_principals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PPs can view own record"   ON public.program_principals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "PPs can update own record" ON public.program_principals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "PPs can insert own record" ON public.program_principals FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── program_applications ────────────────────────────────────
DROP POLICY IF EXISTS "Applicants can view own applications" ON public.program_applications;
DROP POLICY IF EXISTS "Applicants can insert applications"   ON public.program_applications;

ALTER TABLE public.program_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Applicants can view own applications" ON public.program_applications FOR SELECT USING (auth.uid() = applicant_user_id);
CREATE POLICY "Applicants can insert applications"   ON public.program_applications FOR INSERT WITH CHECK (auth.uid() = applicant_user_id);

-- ── execution_briefs ─────────────────────────────────────────
ALTER TABLE public.execution_briefs ENABLE ROW LEVEL SECURITY;
-- (No public policies — admin only via service-role)

-- ── brief_leads ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can submit brief lead" ON public.brief_leads;

ALTER TABLE public.brief_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit brief lead" ON public.brief_leads FOR INSERT WITH CHECK (TRUE);

-- ── outreach_drafts ──────────────────────────────────────────
ALTER TABLE public.outreach_drafts ENABLE ROW LEVEL SECURITY;

-- ── partnership_conversations ────────────────────────────────
ALTER TABLE public.partnership_conversations ENABLE ROW LEVEL SECURITY;

-- ── newsletter_subscribers ───────────────────────────────────
DROP POLICY IF EXISTS "Anyone can subscribe" ON public.newsletter_subscribers;

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can subscribe" ON public.newsletter_subscribers FOR INSERT WITH CHECK (TRUE);

-- ── Indexes (safe — IF NOT EXISTS) ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_pp_user_id             ON public.program_principals(user_id);
CREATE INDEX IF NOT EXISTS idx_pp_org_type            ON public.program_principals(org_type);
CREATE INDEX IF NOT EXISTS idx_pa_principal_id        ON public.program_applications(principal_id);
CREATE INDEX IF NOT EXISTS idx_pa_applicant           ON public.program_applications(applicant_user_id);
CREATE INDEX IF NOT EXISTS idx_briefs_risk            ON public.execution_briefs(risk_rating);
CREATE INDEX IF NOT EXISTS idx_briefs_status          ON public.execution_briefs(publish_status);
CREATE INDEX IF NOT EXISTS idx_briefs_partnership     ON public.execution_briefs(partnership_status);
CREATE INDEX IF NOT EXISTS idx_brief_leads_brief      ON public.brief_leads(brief_id);
CREATE INDEX IF NOT EXISTS idx_brief_leads_email      ON public.brief_leads(email);
CREATE INDEX IF NOT EXISTS idx_outreach_brief         ON public.outreach_drafts(brief_id);
CREATE INDEX IF NOT EXISTS idx_outreach_status        ON public.outreach_drafts(status);
CREATE INDEX IF NOT EXISTS idx_partnerships_brief     ON public.partnership_conversations(brief_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_email       ON public.newsletter_subscribers(email);

-- ── Helper function (CREATE OR REPLACE — always safe) ────────
CREATE OR REPLACE FUNCTION public.log_brief_download(
  p_brief_id UUID,
  p_email    TEXT,
  p_name     TEXT DEFAULT NULL,
  p_org      TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.brief_leads (brief_id, email, full_name, organisation)
  VALUES (p_brief_id, p_email, p_name, p_org)
  ON CONFLICT DO NOTHING;

  UPDATE public.execution_briefs
  SET
    download_count = download_count + 1,
    leads_captured = leads_captured + 1,
    updated_at     = NOW()
  WHERE id = p_brief_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- DONE — you should see: "Success. No rows returned."
-- ============================================================
