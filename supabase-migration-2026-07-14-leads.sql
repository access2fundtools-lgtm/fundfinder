-- FundFinder AI — Leads visibility migration (2026-07-14)
-- Run this once in Supabase → SQL Editor.
--
-- Lets admins (checked via public.is_admin(), same helper used everywhere
-- else — see supabase-admin.sql) read the newsletter_subscribers table from
-- admin.html's new "Leads" tab. Previously this table only had an INSERT
-- policy ("Anyone can subscribe"), so nobody — including admins — could
-- read it back through the anon key.

DROP POLICY IF EXISTS "Admins read all leads" ON public.newsletter_subscribers;
CREATE POLICY "Admins read all leads" ON public.newsletter_subscribers
  FOR SELECT USING (public.is_admin(auth.uid()));
