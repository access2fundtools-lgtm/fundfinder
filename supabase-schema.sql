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
-- DONE
-- After running this, note your Supabase:
--   Project URL:  Settings → API → Project URL
--   Anon Key:     Settings → API → anon public key
-- Both go into fundfinder-auth.html and fundfinder-wallet.html
-- ============================================================
