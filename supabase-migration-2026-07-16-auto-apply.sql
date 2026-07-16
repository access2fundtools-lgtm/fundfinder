-- ============================================================
-- FundFinder AI — Auto-Apply Phase 1: Data Model
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- Implements rollout step 1 of dashboard-auto-apply-build-plan.md
-- (profile facts + documents). Safe to re-run — everything is
-- IF NOT EXISTS / IF EXISTS guarded, no data is dropped.
-- ============================================================

-- ── 1. Flexible facts store on user_profiles ─────────────────
-- Scalar columns can't keep up with how differently programs phrase
-- things ("years in operation" vs "business age" vs "date founded").
-- This is a growing key→value store the AI reads from and writes to.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS profile_facts JSONB DEFAULT '{}'::jsonb;

-- ── 2. Saved documents (CAC cert, ID, pitch deck, etc.) ───────
CREATE TABLE IF NOT EXISTS public.user_documents (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  doc_type     TEXT NOT NULL
                 CHECK (doc_type IN ('cac_certificate','id_card','pitch_deck','financials','business_plan','photo','other')),
  file_url     TEXT NOT NULL,        -- Supabase Storage public/signed URL
  file_name    TEXT,                 -- original filename, for display
  uploaded_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_documents_user ON public.user_documents(user_id);

ALTER TABLE public.user_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own documents" ON public.user_documents;
CREATE POLICY "Users manage own documents"
  ON public.user_documents FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── 3. Extracted application questions (per opportunity, not per user) ──
-- Populated once per opportunity by the question-extraction pipeline
-- (rollout step 2/3 — not built yet, table just needs to exist first).
CREATE TABLE IF NOT EXISTS public.opportunity_questions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE CASCADE NOT NULL,
  question_text  TEXT NOT NULL,
  field_type     TEXT DEFAULT 'text'
                   CHECK (field_type IN ('text','textarea','select','number','file','date')),
  options        JSONB DEFAULT '[]'::jsonb,   -- choices, for select fields
  required       BOOLEAN DEFAULT FALSE,
  sort_order     INTEGER DEFAULT 0,
  extracted_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opp_questions_opp ON public.opportunity_questions(opportunity_id);

ALTER TABLE public.opportunity_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read opportunity questions" ON public.opportunity_questions;
CREATE POLICY "Anyone can read opportunity questions"
  ON public.opportunity_questions FOR SELECT
  USING (TRUE);

-- Only the service role (server-side extraction job) writes these —
-- no anon/authenticated INSERT policy needed.

-- Track whether an opportunity supports auto-apply at all (set FALSE
-- if extraction fails or the source requires login).
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS auto_apply_supported BOOLEAN DEFAULT FALSE;

-- ── 4. Draft answers + gaps on the existing opportunity_matches row ──
-- Reusing opportunity_matches instead of a new "applications" table:
-- it already tracks one row per (user_id, opportunity_id) with a
-- status column ('new'..'submitted') and an application_draft TEXT
-- field from phase7 — this just makes that draft structured.
ALTER TABLE public.opportunity_matches
  ADD COLUMN IF NOT EXISTS answers      JSONB DEFAULT '{}'::jsonb,  -- {question_id: answer_text}
  ADD COLUMN IF NOT EXISTS gaps         JSONB DEFAULT '[]'::jsonb,  -- [question_id, ...] AI couldn't answer
  ADD COLUMN IF NOT EXISTS prefill_url  TEXT;                       -- Google Form / JotForm deep link, if generated

-- ── DONE ─────────────────────────────────────────────────────
-- What this does NOT include yet (later rollout steps):
--   - The question-extraction job itself (scraper/Cloudflare Function
--     that populates opportunity_questions from live apply_url pages)
--   - functions/api/auto-apply.js (Gemini answer-drafting endpoint)
--   - Review UI in fundfinder-profile.html / new applications page
-- ============================================================
