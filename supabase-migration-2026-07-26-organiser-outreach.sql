-- ============================================================================
-- FundFinder — organiser contact registry + outreach log
-- 2026-07-26
--
-- Why: the `opportunities` table stores `organiser` as a bare name string and
-- has no contact field of any kind. Outreach was therefore impossible to run or
-- track in-product. This adds the missing layer.
--
-- Design notes:
--  * Contacts live on their OWN table keyed by organisation, NOT on
--    `opportunities` — one organiser runs many calls, and re-scraping a call
--    must never clobber researched contact data.
--  * `opportunities` rows are linked by a nullable FK so the scraper keeps
--    working untouched when it meets an organiser we have not researched yet.
--  * Every contact row carries `source_url` + `verified_on`. An address with no
--    source is treated as unverified and must not be mailed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organisers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            text UNIQUE NOT NULL,
  org_type        text,               -- un_agency | dfi | foundation | corporate_csr | private_operator | research_institute
  country         text,
  website         text,

  -- verified contact routes (NULL = not found, never a guess)
  email_general   text,
  email_specific  text,               -- partnerships/sponsorship inbox where one exists
  contact_url     text,
  linkedin_url    text,
  twitter_handle  text,
  phone           text,
  whatsapp_ok     boolean DEFAULT false,

  -- named humans (no invented addresses — LinkedIn is the route to these people)
  contact_name    text,
  contact_title   text,

  source_url      text,               -- where the contact data was actually read
  verified_on     date,

  priority_tier   smallint,           -- 1 = pitch first
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS organiser_id uuid REFERENCES public.organisers(id);

CREATE INDEX IF NOT EXISTS idx_opportunities_organiser ON public.opportunities(organiser_id);

-- ---------------------------------------------------------------------------
-- Outreach log: one row per touch. This is what makes reporting automatic —
-- status is derived from the log, never hand-maintained.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outreach_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organiser_id  uuid REFERENCES public.organisers(id) ON DELETE CASCADE,
  touch_no      smallint,                    -- 1..5 within the cadence
  channel       text,                        -- email | linkedin_connect | linkedin_dm | twitter | whatsapp | phone
  direction     text DEFAULT 'out',          -- out | in
  sent_at       timestamptz DEFAULT now(),
  subject       text,
  body_ref      text,                        -- template id used
  outcome       text,                        -- sent | opened | replied | bounced | declined | meeting | deployed
  notes         text
);

CREATE INDEX IF NOT EXISTS idx_outreach_org  ON public.outreach_log(organiser_id);
CREATE INDEX IF NOT EXISTS idx_outreach_sent ON public.outreach_log(sent_at DESC);

ALTER TABLE public.organisers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_log ENABLE ROW LEVEL SECURITY;

-- Public may read the organiser registry (it is all public-web data anyway);
-- the outreach log is admin-only — it is commercial activity, not public record.
DROP POLICY IF EXISTS "Anyone reads organisers" ON public.organisers;
CREATE POLICY "Anyone reads organisers" ON public.organisers FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage outreach" ON public.outreach_log;
CREATE POLICY "Admins manage outreach" ON public.outreach_log
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.organisers TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.outreach_log TO authenticated;

-- ---------------------------------------------------------------------------
-- Seed: the 7 external organisers currently live on fundfinder.ng.
-- Every address below was read off a live page on 2026-07-26. Where nothing was
-- published, the column stays NULL — no firstname.lastname guesses.
-- ---------------------------------------------------------------------------
INSERT INTO public.organisers
  (name, slug, org_type, country, website, email_general, email_specific, contact_url,
   linkedin_url, twitter_handle, phone, whatsapp_ok, contact_name, contact_title,
   source_url, verified_on, priority_tier, notes)
VALUES
  ('AM-Steve House Capital (InvestoVilla IPDPE)', 'am-steve-house', 'private_operator', 'Nigeria',
   'https://amstevehouse.com', 'info@amstevehouse.com', NULL, 'https://amstevehouse.com/privacy-policy/',
   'https://www.linkedin.com/company/am-steve-house-capital-limited/', NULL, '+2349033205259', true,
   'Dr. Ugwumsinachi Okorie', 'Program Lead / Managing Partner',
   'https://pipeline.amstevehouse.com/', '2026-07-26', 1,
   'Best fit by far. New pilot, first cohort Aug 2026, Lagos-based, explicitly needs applicants. Only organiser where WhatsApp and Nigerian peer-to-peer framing are appropriate.'),

  ('Kenya Climate Innovation Center', 'kcic', 'foundation', 'Kenya',
   'https://www.kenyacic.org', 'info@kenyacic.org', NULL, 'https://www.kenyacic.org/contact-us/',
   'https://ke.linkedin.com/company/kenyaclimateinnovationcenter', '@KenyaCIC', '+254703034701', false,
   NULL, NULL,
   'https://www.kenyacic.org/contact-us/', '2026-07-26', 1,
   'Cleantech Innovation Competition open 10 Jul - 10 Aug 2026. Live intake need RIGHT NOW; timing is the whole pitch. No named contact published.'),

  ('African Plant Nutrition Institute', 'apni', 'research_institute', 'Morocco',
   'https://www.apni.net', 'info@apni.net', NULL, 'https://www.apni.net/apni-staff/',
   'https://www.linkedin.com/company/african-plant-nutrition-institute/', '@PlantAfrican', NULL, false,
   'Dr. Thomas Oberthur', 'Director, Business & Partnerships',
   'https://www.apni.net/apni-staff/', '2026-07-26', 2,
   'Named partnerships director = the cleanest LinkedIn route of the seven. Agri fit also opens the FarmID angle later.'),

  ('MUSON / MTN Foundation', 'muson-mtn', 'corporate_csr', 'Nigeria',
   'https://muson.org', 'info@muson.org', 'sponsorship@muson.org', 'https://muson.org/contact-us/',
   'https://www.linkedin.com/company/mtn-nigeria/', '@MUSON_Centre', '+2349150491400', false,
   'Mrs. Odunayo Sanya', 'Executive Director, MTN Nigeria Foundation',
   'https://muson.org/contact-us/', '2026-07-26', 2,
   'sponsorship@muson.org is the real door - a partnerships inbox, not a general one. MTN side is a corporate switchboard; go via MUSON.'),

  ('Green Earth Action Foundation', 'geaf', 'foundation', 'Switzerland',
   'https://www.greenearthactionfoundation.org', 'info@geaf.foundation', NULL,
   'https://www.greenearthactionfoundation.org/contact-us',
   'https://www.linkedin.com/company/geaforg', '@geaforg', '+41223371107', false,
   'Baptistelle Paldino', 'Head of Geneva Office and Projects',
   'https://www.greenearthactionfoundation.org/contact-us', '2026-07-26', 3,
   'DATA FLAG: the HubSpot landing page we scraped (144781338.hs-sites-eu1.com) returns 404. Verify the call is still open before pitching.'),

  ('Development Innovation Ventures (DIV)', 'div-fund', 'dfi', 'United States',
   'https://www.div.fund', 'hello@div.fund', NULL, 'https://www.div.fund/contact',
   NULL, NULL, NULL, false, NULL, NULL,
   'https://www.div.fund/apply', '2026-07-26', 3,
   'States publicly they cannot give applicants pre-submission time. Approach ONLY as an ecosystem/pipeline partner, never as an applicant query, or it gets binned.'),

  ('GEF Small Grants Programme (UNDP Zimbabwe)', 'gef-sgp-zw', 'un_agency', 'Zimbabwe',
   'https://sgp.undp.org', 'registry.zw@undp.org', 'gefsgpzimgrants.zw@undp.org',
   'https://www.undp.org/zimbabwe/contact-us',
   'https://zw.linkedin.com/company/undpzimbabwe', '@UNDPZimbabwe', '+263242338836', false,
   'Tsitsi Wutawunashe', 'National Coordinator, GEF SGP Zimbabwe',
   'https://www.undp.org/zimbabwe/contact-us', '2026-07-26', 4,
   'DATA FLAG: this call closed 22 May 2026 but is live on fundfinder.ng with no deadline set. Fix the listing before any outreach. UN procurement culture - never cold-pitch a national coordinator.')
ON CONFLICT (slug) DO NOTHING;

-- Link existing opportunity rows to their organiser where the name matches.
UPDATE public.opportunities o SET organiser_id = g.id
FROM public.organisers g
WHERE o.organiser_id IS NULL AND (
     (g.slug='am-steve-house' AND o.organiser ILIKE '%InvestoVilla%')
  OR (g.slug='kcic'           AND o.organiser ILIKE '%Cleantech%')
  OR (g.slug='apni'           AND o.organiser ILIKE '%Plant Nutrition%')
  OR (g.slug='muson-mtn'      AND o.organiser ILIKE '%MUSON%')
  OR (g.slug='geaf'           AND o.organiser ILIKE '%GEAF%')
  OR (g.slug='div-fund'       AND o.organiser ILIKE 'DIV%')
  OR (g.slug='gef-sgp-zw'     AND o.organiser ILIKE '%GEF Small Grants%')
);
