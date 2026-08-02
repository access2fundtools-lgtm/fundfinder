#!/usr/bin/env node
/**
 * match-outreach.js — the demand-activation loop.
 *
 * Pulls every registered business profile, joins it to its live programme
 * matches (deadline today or later, or rolling), and produces a per-user
 * outreach cohort report with ready-to-send personalised messages:
 *
 *   outreach/cohort-YYYY-MM-DD.md   — human review sheet, one section per user
 *   outreach/cohort-YYYY-MM-DD.csv  — same data flat, for the CRM
 *
 * REPORT-ONLY by design. Nothing is sent from this script. The drafted
 * WhatsApp/email text respects each user's notify_whatsapp / notify_email
 * flags (users with both off are listed as DO-NOT-CONTACT, for the record
 * only). Sending stays a human act until a per-user Meta template
 * (e.g. "your_matches") is approved — see SENDING UPGRADE below.
 *
 * Env (GitHub Actions):
 *   SUPABASE_URL          — https://<project>.supabase.co
 *   SUPABASE_SERVICE_KEY  — service_role key (bypasses RLS; server-side only)
 *
 * SENDING UPGRADE (when ready to automate):
 *   1. In Meta WhatsApp Manager, register a template `your_matches` with
 *      variables: {{1}} first_name, {{2}} programme_title, {{3}} deadline.
 *   2. Add a per-user send loop mirroring functions/api/whatsapp-broadcast.js.
 *   3. Keep the daily cap and the notify_whatsapp check.
 */
const fs = require('fs');
const path = require('path');

const URL_ = process.env.SUPABASE_URL || 'https://zrkxigbmlprrowiofhjy.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error('SUPABASE_SERVICE_KEY not set'); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const today = new Date().toISOString().slice(0, 10);

async function rest(pathq) {
  const r = await fetch(`${URL_}/rest/v1/${pathq}`, { headers: H });
  if (!r.ok) throw new Error(`${pathq} -> ${r.status}: ${await r.text()}`);
  return r.json();
}

async function authUsers() {
  // Page through auth admin users to map user_id -> email
  const map = {};
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`${URL_}/auth/v1/admin/users?page=${page}&per_page=100`, { headers: H });
    if (!r.ok) break;
    const j = await r.json();
    const users = j.users || j || [];
    if (!users.length) break;
    users.forEach(u => { map[u.id] = u.email || ''; });
    if (users.length < 100) break;
  }
  return map;
}

const csvEsc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

function waDraft(p, matches) {
  const first = (p.full_name || '').split(/\s+/)[0] || 'there';
  const top = matches[0];
  const more = matches.length > 1 ? ` (+${matches.length - 1} more on your dashboard)` : '';
  return `Hi ${first} — Dayo from FundFinder AI. Your ${p.business_sector || 'business'} profile matches ${top.opportunity_title}${top.deadline ? `, deadline ${top.deadline}` : ''}${more}. Applying is free: ${top.url}. If you'd like A2F to prepare and submit the application with you, reply HELP and we'll scope it — no obligation.`;
}

function emailDraft(p, matches) {
  const first = (p.full_name || '').split(/\s+/)[0] || 'there';
  const rows = matches.map(m => `  • ${m.opportunity_title}${m.deadline ? ` — deadline ${m.deadline}` : ' — rolling'}\n    ${m.url}`).join('\n');
  return `Subject: ${matches.length} funding programme${matches.length > 1 ? 's' : ''} your profile matches right now

Hi ${first},

Your business profile on FundFinder AI currently matches:

${rows}

Applying is free — your dashboard drafts the answers from your saved profile, and you submit on the official form.

If you'd rather have the A2F team prepare and submit the application with you, reply to this email or message us on WhatsApp and we'll scope it per programme. No obligation.

— Dayo Akin, FundFinder AI by A2F Partners
https://fundfinder.ng`;
}

async function main() {
  const [profiles, matches, opps, emails] = await Promise.all([
    rest('user_profiles?select=*'),
    rest('opportunity_matches?select=*&order=match_score.desc.nullslast'),
    rest('opportunities?select=id,slug,title,apply_url,deadline:deadline,amount_text,capital_type&limit=2000').catch(() => []),
    authUsers(),
  ]);

  const oppById = {};
  opps.forEach(o => { oppById[String(o.id)] = o; oppById[o.slug] = o; });

  // group live matches per user
  const byUser = {};
  for (const m of matches) {
    const dl = m.deadline ? String(m.deadline).slice(0, 10) : null;
    if (dl && dl < today) continue;                       // expired
    if (!['new', 'saved'].includes(m.status || 'new')) continue; // already actioned
    const o = oppById[String(m.opportunity_id)] || {};
    (byUser[m.user_id] = byUser[m.user_id] || []).push({
      opportunity_title: m.opportunity_title || o.title || m.opportunity_name || m.opportunity_id,
      deadline: dl,
      score: m.match_score,
      capital_type: m.capital_type || o.capital_type || '',
      url: o.apply_url || (o.slug ? `https://fundfinder.ng/${o.slug}.html` : 'https://fundfinder.ng'),
    });
  }
  Object.values(byUser).forEach(l => l.splice(3)); // top 3 per user

  const outDir = path.join(__dirname, '..', 'outreach');
  fs.mkdirSync(outDir, { recursive: true });

  let md = `# Assisted-Application Outreach Cohort — ${today}\n\n`;
  md += `Profiles: ${profiles.length} · with live matches: ${Object.keys(byUser).filter(u => byUser[u].length).length}\n\n`;
  md += `> Review each section, then send the drafted message from the business WhatsApp/email.\n> Respect the channel flags — they are the user's own settings.\n\n---\n`;

  const csv = [['name', 'business', 'sector', 'stage', 'profile_score', 'email', 'whatsapp', 'notify_email', 'notify_whatsapp', 'top_match', 'deadline', 'match_2', 'match_3', 'channel'].map(csvEsc).join(',')];

  let contactable = 0;
  const sorted = profiles
    .filter(p => (byUser[p.user_id] || []).length)
    .sort((a, b) => (b.profile_score || 0) - (a.profile_score || 0));

  for (const p of sorted) {
    const ms = byUser[p.user_id];
    const email = emails[p.user_id] || '';
    const channel = p.notify_whatsapp && p.whatsapp ? 'whatsapp'
      : p.notify_email && email ? 'email' : 'DO-NOT-CONTACT';
    if (channel !== 'DO-NOT-CONTACT') contactable++;

    md += `\n## ${p.full_name || '(no name)'} — ${p.business_name || '(no business name)'}\n`;
    md += `- Sector/stage: ${p.business_sector || '—'} / ${p.business_stage || '—'} · Profile ${p.profile_score || 0}%\n`;
    md += `- Contact: ${email || 'no email'} · WA ${p.whatsapp || '—'} · flags: email=${!!p.notify_email} wa=${!!p.notify_whatsapp} → **${channel}**\n`;
    md += `- Matches:\n`;
    ms.forEach(m => { md += `  - ${m.opportunity_title}${m.deadline ? ` (deadline ${m.deadline})` : ' (rolling)'}${m.score != null ? ` — score ${m.score}` : ''}\n`; });
    if (channel === 'whatsapp') md += `\n**WhatsApp draft:**\n> ${waDraft(p, ms)}\n`;
    if (channel === 'email') md += `\n**Email draft:**\n\`\`\`\n${emailDraft(p, ms)}\n\`\`\`\n`;
    md += `\n---\n`;

    csv.push([p.full_name, p.business_name, p.business_sector, p.business_stage, p.profile_score,
      email, p.whatsapp, p.notify_email, p.notify_whatsapp,
      ms[0] && ms[0].opportunity_title, ms[0] && ms[0].deadline,
      ms[1] && ms[1].opportunity_title, ms[2] && ms[2].opportunity_title, channel].map(csvEsc).join(','));
  }

  md += `\n\n**Summary:** ${sorted.length} users with live matches · ${contactable} contactable within their own notification settings.\n`;

  fs.writeFileSync(path.join(outDir, `cohort-${today}.md`), md);
  fs.writeFileSync(path.join(outDir, `cohort-${today}.csv`), csv.join('\n'));
  console.log(JSON.stringify({ profiles: profiles.length, withLiveMatches: sorted.length, contactable, out: `outreach/cohort-${today}.md` }, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
