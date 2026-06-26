-- ============================================================
-- FundFinder AI — Supabase Database Schema
-- Run this SQL in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- Enable UUID extension (usually already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USER PROFILES
-- Extended info beyond what Supabase Auth stores
-- ============================================================
CREATE TABLE public.user_profiles (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  full_name     TEXT,
  phone         TEXT,
  whatsapp      TEXT,                    -- WhatsApp number (may differ from phone)

  -- Entrepreneur fields
  business_name     TEXT,
  business_sector   TEXT,               -- agric, tech, fashion, food, etc.
  business_stage    TEXT,               -- idea, startup, growth, established
  business_location TEXT,               -- state/city
  years_operating   INTEGER,
  is_registered     BOOLEAN DEFAULT FALSE,
  team_size         TEXT,               -- solo, 2-5, 6-20, 20+
  age_range         TEXT,               -- 18-25, 26-35, 36-45, 46+

  -- Student/Scholar fields
  is_student        BOOLEAN DEFAULT FALSE,
  student_level     TEXT,               -- undergraduate, postgraduate, phd
  field_of_study    TEXT,
  institution       TEXT,
  graduation_year   INTEGER,

  -- Application preferences
  application_mode  TEXT DEFAULT 'alert',  -- 'auto' (auto-submit) or 'alert' (notify+approve)
  notify_email      BOOLEAN DEFAULT TRUE,
  notify_whatsapp   BOOLEAN DEFAULT TRUE,

  -- Profile completeness (0-100)
  profile_score     INTEGER DEFAULT 0,

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- WALLETS
-- One wallet per user, credit balance tracked here
-- ============================================================
CREATE TABLE public.wallets (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                 UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  balance_credits         INTEGER DEFAULT 0 CHECK (balance_credits >= 0),
  total_credits_purchased INTEGER DEFAULT 0,
  total_credits_used      INTEGER DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CREDIT PACKAGES
-- What users can buy — update prices here anytime
-- ============================================================
CREATE TABLE public.credit_packages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,          -- e.g. "Starter Pack"
  credits       INTEGER NOT NULL,       -- credits granted
  price_ngn     INTEGER NOT NULL,       -- price in Naira (not kobo)
  is_active     BOOLEAN DEFAULT TRUE,
  is_popular    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default packages
INSERT INTO public.credit_packages (name, credits, price_ngn, is_active, is_popular) VALUES
  ('Starter',  20,  500,  TRUE, FALSE),
  ('Basic',    50,  1000, TRUE, TRUE),
  ('Pro',      120, 2000, TRUE, FALSE),
  ('Power',    300, 4000, TRUE, FALSE);

-- ============================================================
-- TRANSACTIONS
-- Every Paystack payment that adds credits
-- ============================================================
CREATE TABLE public.transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  paystack_ref    TEXT UNIQUE NOT NULL,
  amount_ngn      INTEGER NOT NULL,      -- amount paid in Naira
  credits_added   INTEGER NOT NULL,
  package_id      UUID REFERENCES public.credit_packages(id),
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  paystack_data   JSONB,                 -- full webhook payload for audit
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  verified_at     TIMESTAMPTZ
);

-- ============================================================
-- CHAT SESSIONS
-- Every AI chat message — for credit deduction and audit
-- ============================================================
CREATE TABLE public.chat_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id      TEXT,                  -- groups messages in one conversation
  message_role    TEXT CHECK (message_role IN ('user','assistant')),
  credits_charged INTEGER DEFAULT 1,
  prompt_tokens   INTEGER,
  completion_tokens INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- OPPORTUNITY MATCHES
-- Stored matches between a user profile and an opportunity
-- ============================================================
CREATE TABLE public.opportunity_matches (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  opportunity_id    TEXT NOT NULL,       -- matches the id field in the JS OPPORTUNITIES array
  opportunity_name  TEXT,
  match_score       INTEGER,             -- 0-100
  status            TEXT DEFAULT 'new'   -- new, applied, rejected, successful
    CHECK (status IN ('new','saved','applied','approved','submitted','rejected','successful')),
  application_mode  TEXT,               -- 'auto' or 'alert' at time of match
  notes             TEXT,
  matched_at        TIMESTAMPTZ DEFAULT NOW(),
  applied_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Each user can only see their own data
-- ============================================================
ALTER TABLE public.user_profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_matches ENABLE ROW LEVEL SECURITY;

-- user_profiles policies
CREATE POLICY "Users can view own profile"   ON public.user_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.user_profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.user_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- wallets policies
CREATE POLICY "Users can view own wallet"    ON public.wallets FOR SELECT USING (auth.uid() = user_id);

-- transactions policies
CREATE POLICY "Users can view own transactions" ON public.transactions FOR SELECT USING (auth.uid() = user_id);

-- chat_logs policies
CREATE POLICY "Users can view own chat logs" ON public.chat_logs FOR SELECT USING (auth.uid() = user_id);

-- opportunity_matches policies
CREATE POLICY "Users can manage own matches" ON public.opportunity_matches FOR ALL USING (auth.uid() = user_id);

-- credit_packages: public read
CREATE POLICY "Anyone can view packages" ON public.credit_packages FOR SELECT USING (TRUE);

-- ============================================================
-- FUNCTIONS
-- Auto-create wallet + profile when a new user signs up
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Create empty profile
  INSERT INTO public.user_profiles (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Create wallet with 0 credits
  INSERT INTO public.wallets (user_id, balance_credits)
  VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: fires when a new user is created in auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- CREDIT FUNCTIONS (called server-side from Netlify functions)
-- ============================================================

-- Deduct credits (called after each AI message)
CREATE OR REPLACE FUNCTION public.deduct_credits(p_user_id UUID, p_credits INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE public.wallets
  SET
    balance_credits      = GREATEST(0, balance_credits - p_credits),
    total_credits_used   = total_credits_used + p_credits,
    updated_at           = NOW()
  WHERE user_id = p_user_id AND balance_credits >= p_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient credits or wallet not found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add credits (called after Paystack payment confirmed)
CREATE OR REPLACE FUNCTION public.add_credits(p_user_id UUID, p_credits INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE public.wallets
  SET
    balance_credits          = balance_credits + p_credits,
    total_credits_purchased  = total_credits_purchased + p_credits,
    updated_at               = NOW()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    -- Wallet doesn't exist yet — create it
    INSERT INTO public.wallets (user_id, balance_credits, total_credits_purchased)
    VALUES (p_user_id, p_credits, p_credits);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- INDEXES (for query performance)
-- ============================================================
CREATE INDEX idx_wallets_user_id          ON public.wallets(user_id);
CREATE INDEX idx_transactions_user_id     ON public.transactions(user_id);
CREATE INDEX idx_transactions_paystack    ON public.transactions(paystack_ref);
CREATE INDEX idx_chat_logs_user_id        ON public.chat_logs(user_id);
CREATE INDEX idx_chat_logs_session        ON public.chat_logs(session_id);
CREATE INDEX idx_matches_user_id          ON public.opportunity_matches(user_id);
CREATE INDEX idx_matches_opportunity      ON public.opportunity_matches(opportunity_id);

-- ============================================================
-- PROGRAM PRINCIPALS (Supply-Side)
-- Organisations that run grant/funding programs on the platform
-- ============================================================
CREATE TABLE public.program_principals (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- linked admin account

  -- Organisation identity
  org_name            TEXT NOT NULL,
  org_type            TEXT NOT NULL CHECK (org_type IN (
                        'government_federal','government_state','dfi','corporate_csr',
                        'international_dev','foundation','vc_fund','other')),
  registration_number TEXT,
  website             TEXT,
  contact_name        TEXT,
  contact_email       TEXT NOT NULL,
  contact_phone       TEXT,

  -- Verification
  verified            BOOLEAN DEFAULT FALSE,
  verification_doc    TEXT,              -- URL to uploaded credential doc
  verified_at         TIMESTAMPTZ,
  verified_by         UUID,              -- admin user who verified

  -- Program configuration
  program_name        TEXT,
  capital_type        TEXT CHECK (capital_type IN (
                        'grant','soft_loan','empowerment','credit_guarantee',
                        'blended_finance','equity','mixed')),
  funding_min_ngn     BIGINT,
  funding_max_ngn     BIGINT,
  target_sectors      TEXT[],            -- array: ['agric','tech','fashion',...]
  target_geography    TEXT[],            -- array of states
  target_beneficiary  TEXT CHECK (target_beneficiary IN ('individuals','smes','both','ngos')),
  eligibility_notes   TEXT,
  disbursement_notes  TEXT,
  program_open        BOOLEAN DEFAULT TRUE,
  deadline            DATE,

  -- NGX Growth Board pathway flag
  ngx_pathway_active  BOOLEAN DEFAULT FALSE,
  ngx_pathway_notes   TEXT,

  -- Platform status
  onboarding_complete BOOLEAN DEFAULT FALSE,
  onboarding_step     INTEGER DEFAULT 1, -- 1=org, 2=program, 3=NGX, 4=done
  subscription_tier   TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free','starter','pro','enterprise')),
  subscription_fee_ngn INTEGER DEFAULT 0,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE public.program_principals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "PPs can view own record"   ON public.program_principals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "PPs can update own record" ON public.program_principals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "PPs can insert own record" ON public.program_principals FOR INSERT WITH CHECK (auth.uid() = user_id);
-- Admins see all — add admin policy when admin role is set up

-- ============================================================
-- PROGRAM APPLICATIONS (submitted through Program Principal)
-- ============================================================
CREATE TABLE public.program_applications (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  principal_id        UUID REFERENCES public.program_principals(id) ON DELETE CASCADE,
  applicant_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  applicant_name      TEXT,
  applicant_email     TEXT,
  applicant_phone     TEXT,
  business_name       TEXT,
  application_data    JSONB,             -- full form responses
  ai_eligibility_score INTEGER,          -- 0-100 from AI screening
  ai_notes            TEXT,              -- AI screening summary
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
-- EXECUTION BRIEFS (Execution Brief Engine — Phase 6)
-- Internal CMS for A2F's intelligence content
-- ============================================================
CREATE TABLE public.execution_briefs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_number        SERIAL,            -- auto-incrementing issue number

  -- Core six-field template
  title               TEXT NOT NULL,
  what_happened       TEXT,              -- Field 1: factual summary, public record only
  what_numbers_show   TEXT,              -- Field 2: key metrics, sourced
  execution_gap       TEXT,              -- Field 3: process critique, no named individuals
  a2f_alternative     TEXT,             -- Field 4: specific alternative execution
  converted_outcome   TEXT,             -- Field 5: realistic improved result

  -- Risk & Classification
  risk_rating         TEXT NOT NULL DEFAULT 'amber' CHECK (risk_rating IN ('red','amber','green')),
  sector              TEXT,
  institution_name    TEXT,             -- target institution (NOT published on red/amber until MOU)

  -- Partnership tracking
  partnership_status  TEXT DEFAULT 'none' CHECK (partnership_status IN (
                        'none','outreach_sent','mou_signed','co_branded')),
  partnership_notes   TEXT,
  conversation_opened BOOLEAN DEFAULT FALSE,  -- primary ROI metric

  -- Publishing workflow
  publish_status      TEXT DEFAULT 'draft' CHECK (publish_status IN (
                        'draft','pending_approval','approved','published','archived')),
  managing_partner_approved  BOOLEAN DEFAULT FALSE,
  managing_partner_approved_at TIMESTAMPTZ,
  managing_partner_approved_by UUID,
  published_at        TIMESTAMPTZ,
  published_url       TEXT,

  -- Lead capture stats (updated when PDFs are downloaded)
  download_count      INTEGER DEFAULT 0,
  leads_captured      INTEGER DEFAULT 0,

  -- Metadata
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- RLS — only authenticated users with admin role can see briefs
-- (For now, restrict to service-role only; add admin policy when roles are set)
ALTER TABLE public.execution_briefs ENABLE ROW LEVEL SECURITY;
-- No public policy — admin access via service-role key only until admin role added

-- ============================================================
-- BRIEF LEADS (email captures from PDF downloads)
-- Every downloaded brief generates a lead here
-- ============================================================
CREATE TABLE public.brief_leads (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brief_id            UUID REFERENCES public.execution_briefs(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  full_name           TEXT,
  organisation        TEXT,
  ip_address          TEXT,
  -- Auto-routed to Program Principal outreach queue
  added_to_pp_queue   BOOLEAN DEFAULT FALSE,
  pp_queue_added_at   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.brief_leads ENABLE ROW LEVEL SECURITY;
-- Public insert only (form submission), no read (admin service-role only)
CREATE POLICY "Anyone can submit brief lead" ON public.brief_leads FOR INSERT WITH CHECK (TRUE);

-- ============================================================
-- OUTREACH DRAFTS (pre-publish partner outreach queue)
-- Generated automatically for every Amber/Red institution
-- ============================================================
CREATE TABLE public.outreach_drafts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brief_id            UUID REFERENCES public.execution_briefs(id) ON DELETE CASCADE,
  institution_name    TEXT NOT NULL,
  contact_email       TEXT,
  contact_name        TEXT,
  subject_line        TEXT,
  draft_body          TEXT,             -- AI-generated outreach draft
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
-- Admin only via service-role

-- ============================================================
-- PARTNERSHIP CONVERSATIONS (ROI tracker)
-- Tracks whether each brief opened a real partnership conversation
-- This is the primary success metric for the content engine
-- ============================================================
CREATE TABLE public.partnership_conversations (
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
-- Admin only via service-role

-- ============================================================
-- NEWSLETTER SUBSCRIBERS (from hub page subscribe form)
-- ============================================================
CREATE TABLE public.newsletter_subscribers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       TEXT UNIQUE NOT NULL,
  source      TEXT DEFAULT 'hub',       -- hub, brief_download, auth_signup
  confirmed   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can subscribe" ON public.newsletter_subscribers FOR INSERT WITH CHECK (TRUE);

-- ============================================================
-- ADDITIONAL INDEXES
-- ============================================================
CREATE INDEX idx_pp_user_id             ON public.program_principals(user_id);
CREATE INDEX idx_pp_org_type            ON public.program_principals(org_type);
CREATE INDEX idx_pa_principal_id        ON public.program_applications(principal_id);
CREATE INDEX idx_pa_applicant           ON public.program_applications(applicant_user_id);
CREATE INDEX idx_briefs_risk            ON public.execution_briefs(risk_rating);
CREATE INDEX idx_briefs_status          ON public.execution_briefs(publish_status);
CREATE INDEX idx_briefs_partnership     ON public.execution_briefs(partnership_status);
CREATE INDEX idx_brief_leads_brief      ON public.brief_leads(brief_id);
CREATE INDEX idx_brief_leads_email      ON public.brief_leads(email);
CREATE INDEX idx_outreach_brief         ON public.outreach_drafts(brief_id);
CREATE INDEX idx_outreach_status        ON public.outreach_drafts(status);
CREATE INDEX idx_partnerships_brief     ON public.partnership_conversations(brief_id);
CREATE INDEX idx_newsletter_email       ON public.newsletter_subscribers(email);

-- ============================================================
-- HELPER FUNCTION: increment brief download count + log lead
-- Call from Netlify function after email capture
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_brief_download(
  p_brief_id UUID,
  p_email    TEXT,
  p_name     TEXT DEFAULT NULL,
  p_org      TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  -- Log the lead
  INSERT INTO public.brief_leads (brief_id, email, full_name, organisation)
  VALUES (p_brief_id, p_email, p_name, p_org)
  ON CONFLICT DO NOTHING;

  -- Increment counters on the brief
  UPDATE public.execution_briefs
  SET
    download_count = download_count + 1,
    leads_captured = leads_captured + 1,
    updated_at     = NOW()
  WHERE id = p_brief_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- DONE — FULL SCHEMA (Base Platform + Phase 6 Expansion)
-- ============================================================
-- To run:
--   1. Go to Supabase Dashboard → SQL Editor → New Query
--   2. Paste the ENTIRE contents of this file
--   3. Click Run
--
-- Your Supabase credentials (already in the HTML files):
--   Project URL:  https://zrkxigbmlprowiofhjy.supabase.co
--   Anon Key:     Settings → API → "anon public" key
--                 (copy the full key starting with eyJ...)
--
-- IMPORTANT: After running, check Settings → API and confirm
--   the anon key in fundfinder-auth.html matches exactly.
-- ============================================================
