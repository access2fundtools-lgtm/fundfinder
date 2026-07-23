// FundFinder AI — SPV Consolidation (Cloudflare Pages Function) — /api/spv
// Two actions (POST body {action}):
//   suggest  → returns ANONYMIZED candidate partners + a combined-strength score
//   interest → records an expression of interest (open / a specific candidate / an email invite)
//
// Privacy: suggestions never expose partner names or contacts — only sector,
// stage, location, a size band, a score, and an opaque candidate ref. Real
// identities are only revealed later once BOTH sides express interest (future step).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (already set — used by subscribe.js).

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost(context) {
  try { return await handle(context); }
  catch (err) { return json({ error: 'server_error', message: String((err && err.message) || err) }, 500); }
}

async function handle({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return json({ error: 'not_configured' }, 503);

  // Verify the caller.
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized' }, 401);
  const uRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!uRes.ok) return json({ error: 'unauthorized' }, 401);
  const userId = (await uRes.json()).id;
  if (!userId) return json({ error: 'unauthorized' }, 401);

  let body = {};
  try { body = await request.json(); } catch {}
  const svc = (path, opts = {}) => fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...opts, headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });

  if (body.action === 'interest') {
    const row = {
      user_id: userId,
      opportunity_id: body.opportunity_id || null,
      kind: ['open', 'candidate', 'invite'].includes(body.kind) ? body.kind : 'open',
      candidate_user_id: body.candidate_user_id || null,
      invited_email: (body.invited_email || '').trim().toLowerCase() || null,
      note: (body.note || '').slice(0, 500) || null,
    };
    const r = await svc('spv_interests', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
    if (!r.ok) return json({ error: 'save_failed', message: (await r.text()).slice(0, 200) }, 500);
    return json({ success: true });
  }

  // default: suggest
  const meRes = await svc(`user_profiles?user_id=eq.${userId}&select=*`);
  const me = (await meRes.json())[0];
  if (!me || !me.business_sector) return json({ status: 'incomplete_profile', message: 'Add your business sector and stage to your profile to get SPV partner suggestions.' });

  const poolRes = await svc(`user_profiles?user_id=neq.${userId}&business_name=not.is.null&business_sector=not.is.null&select=user_id,business_sector,business_stage,business_location,team_size,years_operating,is_registered,annual_revenue&limit=300`);
  const pool = poolRes.ok ? await poolRes.json() : [];

  const scored = pool.map((p) => score(me, p)).filter((x) => x.combined_score >= 45)
    .sort((a, b) => b.combined_score - a.combined_score).slice(0, 6);

  return json({ status: 'ok', count: scored.length, suggestions: scored });
}

const STAGE_RANK = { idea: 1, startup: 2, early: 2, growth: 3, established: 4 };
function sizeBand(p) {
  const t = (p.team_size || '').toString();
  if (/20|21\+|20\+/.test(t)) return 'Large team';
  if (/6-20|6–20/.test(t)) return 'Mid-size team';
  if (/2-5|2–5/.test(t)) return 'Small team';
  return 'Solo / early';
}
function score(me, p) {
  let s = 20;
  const why = [];
  // Sector: same = consolidation scale; different = diversification
  if (me.business_sector && p.business_sector) {
    if (me.business_sector === p.business_sector) { s += 22; why.push(`same sector (${p.business_sector}) — consolidation scale`); }
    else { s += 12; why.push('complementary sector — diversified vehicle'); }
  }
  // Stage complementarity: a stronger + earlier partner = mentor/scale mix
  const a = STAGE_RANK[me.business_stage] || 0, b = STAGE_RANK[p.business_stage] || 0;
  if (a && b) { if (Math.abs(a - b) >= 2) { s += 15; why.push('complementary stages'); } else { s += 6; } }
  // Geographic reach: different locations widen the combined market
  if (me.business_location && p.business_location) {
    if (me.business_location !== p.business_location) { s += 15; why.push('wider combined market reach'); }
    else s += 6;
  }
  // Investable signal
  if (me.is_registered && p.is_registered) { s += 10; why.push('both registered'); }
  // Combined size / track record → market impact
  const yrs = (me.years_operating || 0) + (p.years_operating || 0);
  s += Math.min(18, yrs * 2);
  return {
    candidate_ref: p.user_id,           // opaque handle; UI never displays it
    sector: p.business_sector || null,
    stage: p.business_stage || null,
    location: p.business_location || null,
    size_band: sizeBand(p),
    combined_score: Math.max(0, Math.min(100, Math.round(s))),
    rationale: why.slice(0, 3).join(' · ') || 'potential consolidation partner',
  };
}
