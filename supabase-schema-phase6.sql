-- ============================================================
-- FundFinder AI — Phase 6 Schema Additions
-- Run this ONLY if you already ran supabase-schema.sql before.
-- These are the NEW tables added for:
--   • Program Principals (supply-side)
--   • Execution Brief Engine (Phase 6)
--   • Newsletter subscribers
-- ============================================================

-- Enable UUID extension (safe to run again)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PROGRAM PRINCIPALS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.program_principals (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  org_name            TEXT NOT NULL,
  org_type            TEXT NOT NULL CHECK (org_type IN (
                        'government_federal','government_state','dfi','corporate_csr',
                        'international_dev','foundation','vc_fund','other')),
  registration_number TEXT,
  website             TEXT,
  contact_name        TEXT,
  contact_email       TEXT NOT NULL,
  contact_phone       TEXT,
  verified            BOOLEAN DEFAULT FALSE,
  verification_doc    TEXT,
  verified_at         TIMESTAMPTZ,
  verified_by         UUID,
  program_name        TEXT,
  capital_type        TEXT CHECK (capital_type IN (
                        'grant','soft_loan','empowerment','credit_guarantee',
                        'blended_finance','equity','mixed')),
  funding_min_ngn     BIGINT,
  funding_max_ngn     BIGINT,
  target_sectors      TEXT[],
  target_geography    TEXT[],
  target_beneficiary  TEXT CHECK (target_beneficiary IN ('individuals','smes','both','ngos')),
  eligibility_notes   TEXT,
  disbursement_notes  TEXT,
  program_open        BOOLEAN DEFAULT TRUE,
  deadline            DATE,
  ngx_pathway_active  BOOLEAN DEFAULT FALSE,
  ngx_pathway_notes   TEXT,
  onboarding_complete BOOLEAN DEFAULT FALSE,
  onboarding_step     INTEGER DEFAULT 1,
  subscription_tier   TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free','starter','pro','enterprise')),
  subscription_fee_ngn INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.program_principals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PPs can view own record"   ON public.program_principals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "PPs can update own record" ON public.program_principals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "PPs can insert own record" ON public.program_principals FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- PROGRAM APPLICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.program_applications (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  principal_id        UUID REFERENCES public.program_principals(id) ON DELETE CASCADE,
  applicant_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  applicant_name      TEXT,
  applicant_email     TEXT,
  applicant_phone     TEXT,
  business_name       TEXT,
  application_data    JSONB,
  ai_eligibility_score INTEGER,
  ai_notes            TEXT,
  status              TEXT DEFAULT 'submitted' CHECK (status IN (
                        'submitted','screening','shortlisted','selected',
                        'waitlisted','rejected','disbursed')),
  rejection_reason    TEXT,
  submitted_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.program_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Applicants can view own applications" ON public.program_applications FOR SELECT USING (auth.uid() = applicant_user_id);
CREATE POLICY "Applicants can insert applications"   ON public.program_applications FOR INSERT WITH CHECK (auth.uid() = applicant_user_id);

-- ============================================================
-- EXECUTION BRIEFS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.execution_briefs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_number        SERIAL,
  title               TEXT NOT NULL,
  what_happened       TEXT,
  what_numbers_show   TEXT,
  execution_gap       TEXT,
  a2f_alternative     TEXT,
  converted_outcome   TEXT,
  risk_rating         TEXT NOT NULL DEFAULT 'amber' CHECK (risk_rating IN ('red','amber','green')),
  sector              TEXT,
  institution_name    TEXT,
  partnership_status  TEXT DEFAULT 'none' CHECK (partnership_status IN (
                        'none','outreach_sent','mou_signed','co_branded')),
  partnership_notes   TEXT,
  conversation_opened BOOLEAN DEFAULT FALSE,
  publish_status      TEXT DEFAULT 'draft' CHECK (publish_status IN (
                        'draft','pending_approval','approved','published','archived')),
  managing_partner_approved       BOOLEAN DEFAULT FALSE,
  managing_partner_approved_at    TIMESTAMPTZ,
  managing_partner_approved_by    UUID,
  published_at        TIMESTAMPTZ,
  published_url       TEXT,
  download_count      INTEGER DEFAULT 0,
  leads_captured      INTEGER DEFAULT 0,
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.execution_briefs ENABLE ROW LEVEL SECURITY;
-- Admin access only — no public policy (use service-role key from admin dashboard)

-- ============================================================
-- BRIEF LEADS (email captures from PDF downloads)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.brief_leads (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brief_id            UUID REFERENCES public.execution_briefs(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  full_name           TEXT,
  organisation        TEXT,
  ip_address          TEXT,
  added_to_pp_queue   BOOLEAN DEFAULT FALSE,
  pp_queue_added_at   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.brief_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can submit brief lead" ON public.brief_leads FOR INSERT WITH CHECK (TRUE);

-- ============================================================
-- OUTREACH DRAFTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.outreach_drafts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brief_id            UUID REFERENCES public.execution_briefs(id) ON DELETE CASCADE,
  institution_name    TEXT NOT NULL,
  contact_email       TEXT,
  contact_name        TEXT,
  subject_line        TEXT,
  draft_body          TEXT,
  status              TEXT DEFAULT 'pending' CHECK (status IN (
                        'pending','approved','sent','replied','converted')),
  approved_by         UUID REFERENCES auth.users(id),
  approved_at         TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  reply_received      BOOLEAN DEFAULT FALSE,
  reply_notes         TEXT,
  mou_resulted        BOOLEAN DEFAULT FALSE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.outreach_drafts ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PARTNERSHIP CONVERSATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.partnership_conversations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brief_id            UUID REFERENCES public.execution_briefs(id) ON DELETE CASCADE,
  outreach_id         UUID REFERENCES public.outreach_drafts(id) ON DELETE SET NULL,
  institution_name    TEXT NOT NULL,
  contact_name        TEXT,
  contact_email       TEXT,
  first_contact_date  DATE,
  latest_contact_date DATE,
  conversation_stage  TEXT DEFAULT 'initial' CHECK (conversation_stage IN (
                        'initial','active','mou_negotiation','mou_signed','co_branded','stalled','closed')),
  outcome_notes       TEXT,
  converted_to_partner BOOLEAN DEFAULT FALSE,
  converted_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.partnership_conversations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- NEWSLETTER SUBSCRIBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       TEXT UNIQUE NOT NULL,
  source      TEXT DEFAULT 'hub',
  confirmed   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can subscribe" ON public.newsletter_subscribers FOR INSERT WITH CHECK (TRUE);

-- ============================================================
-- INDEXES
-- ============================================================
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

-- ============================================================
-- HELPER FUNCTION: log brief download + increment counters
-- ============================================================
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
-- DONE
-- You should see: "Success. No rows returned."
-- Then go to Table Editor to confirm the new tables appear.
-- ============================================================
