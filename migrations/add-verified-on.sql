-- FundFinder — evergreen freshness tracking
-- Written 2026-08-21 after three CLOSED programmes were found being served to
-- users as live opportunities: Cartier Women's Initiative (closed 16 Jun 2026),
-- Standard Chartered Women in Tech (closed 26 Apr 2026) and AfDB YouthADAPT
-- (no 2026 call). All three are ANNUAL programmes, so each legitimately has a
-- NULL deadline — and expire-opportunities.js exempts NULL-deadline rows from
-- every sweep. They would have stayed live indefinitely.
--
-- Fix: track when a listing was last CONFIRMED, not just when it was created.
-- Safe to re-run.

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS verified_on date,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS status_note text;

COMMENT ON COLUMN opportunities.verified_on IS
  'Date a human or check last confirmed this programme is genuinely open. NULL = never confirmed.';
COMMENT ON COLUMN opportunities.status IS
  'unverified | open | closed | not_yet_open. Undated rows must not be presented as open unless status = open.';

-- Seed: treat existing rows as last confirmed when they were created.
UPDATE opportunities
   SET verified_on = created_at::date
 WHERE verified_on IS NULL AND created_at IS NOT NULL;

-- Retire the three confirmed-closed programmes.
UPDATE opportunities SET status='closed', verified_on=DATE '2026-08-21',
       status_note='closed 16 Jun 2026 (2027 edition)'
 WHERE title ILIKE '%Cartier Women%';
UPDATE opportunities SET status='closed', verified_on=DATE '2026-08-21',
       status_note='closed 26 Apr 2026; cohort 7 ran Jun-Aug 2026'
 WHERE title ILIKE '%Women in Tech Accelerator%';
UPDATE opportunities SET status='closed', verified_on=DATE '2026-08-21',
       status_note='no 2026 call published; last confirmed edition 2023'
 WHERE title ILIKE '%YouthADAPT%';
UPDATE opportunities SET status='not_yet_open', verified_on=DATE '2026-08-21',
       status_note='unveiled 14 Aug 2026; no application window published'
 WHERE title ILIKE '%BRYNE%';

-- Verify
SELECT status, count(*) FROM opportunities WHERE is_active GROUP BY status ORDER BY 2 DESC;
