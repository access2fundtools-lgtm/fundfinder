-- JV/SPV admin gate (2026-07-31): no two businesses are introduced until admin approves.
ALTER TABLE public.spv_interests
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending_admin_review', -- pending_admin_review | approved | declined
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
-- Approve (then A2F makes the email introduction manually):
-- UPDATE public.spv_interests SET status='approved', reviewed_by='Dayo', reviewed_at=NOW() WHERE id='...';
