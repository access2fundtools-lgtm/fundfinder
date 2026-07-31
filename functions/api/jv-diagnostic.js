// FundFinder AI — Pre-JV Diagnostic (Cloudflare Pages Function) — /api/jv-diagnostic
// ADMIN-ONLY. Powers the JV review stage of the JV Deal Protocol (2026-07-31):
// before any two businesses are introduced, the admin runs this to get
//   (a) an individual analysis of EACH entity — strengths, gaps, the most
//       suitable actions & funding paths it should explore ON ITS OWN,
//   (b) a joint analysis — what the two can do UNITED, the synergy type,
//       a suggested "first real transaction" to run during exclusivity,
//       what a raise would actually fund, and
//   (c) a verdict against the Synergy Test: "a JV must be worth doing at ₦0 raised."
//
// Actions (POST body {action}):
//   list     → all spv_interests w/ status + resolved business names (admin view)
//   analyze  → { interest_id } or { user_a, user_b } or { user_a } (open interest)
//   decide   → { interest_id, decision: 'approved'|'declined', notes? }
//              (introduction itself stays MANUAL — A2F emails both sides)
//
// Env: GEMINI_API_KEY, GEMINI_MODEL(optional), SUPABASE_URL, SUPABASE_SERVICE_KEY

const DEFAULT_MODEL = 'gemini-2.0-flash';
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost(context) {
  try { return await handle(context); }
  catch (err) { return json({ error: 'server_error', message: String((err && err.message) || err).slice(0, 300) }, 500); }
}

async function handle({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return json({ error: 'not_configured' }, 503);

  // ── Verify caller is a logged-in ADMIN ──
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized' }, 401);
  const uRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!uRes.ok) return json({ error: 'unauthorized' }, 401);
  const caller = await uRes.json();
  if (!caller.id) return json({ error: 'unauthorized' }, 401);

  const svc = (path, opts = {}) => fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...opts, headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });

  const admRes = await svc('rpc/is_admin', { method: 'POST', body: JSON.stringify({ uid: caller.id }) });
  const isAdmin = admRes.ok ? await admRes.json() : false;
  if (isAdmin !== true) return json({ error: 'forbidden', message: 'Admin only.' }, 403);

  let body = {};
  try { body = await request.json(); } catch {}

  // ────────────────────────────── LIST ──────────────────────────────
  if (body.action === 'list') {
    const iRes = await svc('spv_interests?select=*&order=created_at.desc&limit=200');
    const interests = iRes.ok ? await iRes.json() : [];
    const ids = [...new Set(interests.flatMap((i) => [i.user_id, i.candidate_user_id]).filter(Boolean))];
    let profiles = [];
    if (ids.length) {
      const pRes = await svc(`user_profiles?user_id=in.(${ids.join(',')})&select=user_id,full_name,email,business_name,business_sector,business_stage,business_location,whatsapp`);
      profiles = pRes.ok ? await pRes.json() : [];
    }
    const byId = {}; profiles.forEach((p) => { byId[p.user_id] = p; });
    return json({
      status: 'ok',
      interests: interests.map((i) => ({
        ...i,
        requester: byId[i.user_id] || null,
        candidate: i.candidate_user_id ? (byId[i.candidate_user_id] || null) : null,
      })),
    });
  }

  // ────────────────────────────── DECIDE ──────────────────────────────
  if (body.action === 'decide') {
    if (!body.interest_id || !['approved', 'declined'].includes(body.decision)) return json({ error: 'bad_request' }, 400);
    const patch = { status: body.decision, reviewed_by: caller.email || caller.id, reviewed_at: new Date().toISOString() };
    if (body.notes) patch.note = String(body.notes).slice(0, 500);
    const r = await svc(`spv_interests?id=eq.${body.interest_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
    if (!r.ok) return json({ error: 'update_failed', message: (await r.text()).slice(0, 200) }, 500);
    return json({ status: 'ok', decision: body.decision, reminder: body.decision === 'approved' ? 'Approval recorded. Now make the introduction manually — A2F emails BOTH sides. No automated contact is ever sent.' : 'Declined. Consider telling the requester what would make them JV-ready.' });
  }

  // ────────────────────────────── ANALYZE ──────────────────────────────
  let userA = body.user_a || null, userB = body.user_b || null;
  if (body.interest_id) {
    const iRes = await svc(`spv_interests?id=eq.${body.interest_id}&select=*`);
    const interest = (iRes.ok ? await iRes.json() : [])[0];
    if (!interest) return json({ error: 'not_found', message: 'No such interest.' }, 404);
    userA = interest.user_id;
    userB = interest.candidate_user_id || null;
  }
  if (!userA) return json({ error: 'bad_request', message: 'Provide interest_id or user_a.' }, 400);

  const fetchProfile = async (uid) => {
    const r = await svc(`user_profiles?user_id=eq.${uid}&select=*`);
    return (r.ok ? await r.json() : [])[0] || null;
  };
  const a = await fetchProfile(userA);
  if (!a) return json({ error: 'not_found', message: 'Requester profile not found.' }, 404);
  const b = userB ? await fetchProfile(userB) : null;

  const brief = (p) => ({
    business_name: p.business_name, sector: p.business_sector, stage: p.business_stage,
    location: p.business_location, years_operating: p.years_operating, team_size: p.team_size,
    registered_with_cac: p.is_registered, annual_revenue: p.annual_revenue,
    funding_amount_sought: p.funding_amount, funding_purpose: p.funding_purpose || null,
    description: (p.business_description || '').slice(0, 900),
    products_services: (p.products_services || '').slice(0, 500),
    challenges: (p.business_challenges || '').slice(0, 500),
  });

  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const prompt = buildPrompt(brief(a), b ? brief(b) : null);
  const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.35, maxOutputTokens: 3000, responseMimeType: 'application/json' },
    }),
  });
  if (!gRes.ok) return json({ error: 'ai_failed', message: (await gRes.text()).slice(0, 200) }, 502);
  const gData = await gRes.json();
  let analysis = null;
  try {
    const txt = (((gData.candidates || [])[0] || {}).content || {}).parts?.[0]?.text || '';
    analysis = JSON.parse(txt.replace(/^```json\s*/i, '').replace(/```\s*$/, ''));
  } catch { return json({ error: 'ai_parse_failed' }, 502); }

  return json({
    status: 'ok',
    mode: b ? 'pair' : 'single',
    entity_a: { business_name: a.business_name, contact: a.full_name, email: a.email },
    entity_b: b ? { business_name: b.business_name, contact: b.full_name, email: b.email } : null,
    analysis,
    protocol_reminder: 'Verdict guide: a JV must be worth doing at ₦0 raised. If synergy only exists because of the raise, decline and route each entity to its individual path instead.',
  });
}

function buildPrompt(a, b) {
  const rules = `
You are A2F Partners' deal-screening analyst for FundFinder (Nigeria). Analyse rigorously and practically for the NIGERIAN market (CAC compliance, single-digit intervention funds like BOI/DBN/LSETF, grants, trade credit, cooperative structures, offtake agreements — NOT generic US/VC advice).
Core doctrine: "A JV must be worth doing at ₦0 raised" — partnership value must exist BEFORE any fundraise. Funds may only be raised for a specific deployable gap the JV itself cannot self-fund. Never recommend public solicitation of investors; raises are private, via licensed Capital Market Operators.
Be concrete: name actual Nigerian programme types, real strategy moves, and realistic first transactions. Flag missing/weak profile data honestly in data_gaps.
Return STRICT JSON only, matching exactly the schema given.`;

  if (!b) {
    return `${rules}

TASK: SINGLE-ENTITY pre-JV diagnostic. This business asked for a JV partner but no candidate is chosen yet. Analyse it alone and specify what partner archetype (if any) would actually create synergy.

BUSINESS A: ${JSON.stringify(a)}

SCHEMA:
{
 "entity_a": {
   "strengths": ["…"],
   "gaps": ["…"],
   "individual_actions": ["most suitable concrete actions this business should take on its own, ordered by impact"],
   "individual_funding_paths": ["cheapest realistic capital sources it qualifies for NOW, and what unlocks the next tier"]
 },
 "partner_archetype": {
   "who": "the specific type of partner that would create real synergy (or 'none needed — solo path is stronger')",
   "why": "the synergy mechanism",
   "where_to_find": "practical sourcing channels in Nigeria"
 },
 "verdict": "seek_partner | solo_path_first | strengthen_profile_first",
 "verdict_rationale": "…",
 "data_gaps": ["profile fields that are missing/weak and block a confident read"]
}`;
  }

  return `${rules}

TASK: PAIR pre-JV diagnostic. Two businesses may be introduced for a Joint Venture. Analyse EACH individually, then the pairing.

BUSINESS A: ${JSON.stringify(a)}
BUSINESS B: ${JSON.stringify(b)}

SCHEMA:
{
 "entity_a": {
   "strengths": ["…"], "gaps": ["…"],
   "individual_actions": ["most suitable concrete actions A should take regardless of the JV"],
   "individual_funding_paths": ["cheapest realistic capital A qualifies for on its own"]
 },
 "entity_b": { "strengths": ["…"], "gaps": ["…"], "individual_actions": ["…"], "individual_funding_paths": ["…"] },
 "joint": {
   "synergy_type": "revenue | cost | capability | none",
   "synergy_mechanism": "exactly how the pairing creates value at ₦0 raised",
   "united_strategies": ["concrete strategies the two can explore TOGETHER, ordered by impact"],
   "first_transaction": "one small, real joint transaction they should complete during the exclusivity window to prove the JV",
   "raise_job": "if they raise, precisely what the funds deploy into that the JV cannot self-fund (or 'no raise needed yet')",
   "risks": ["top risks of this pairing and mitigations"]
 },
 "synergy_score": 0-100,
 "verdict": "introduce | introduce_with_conditions | decline",
 "conditions": ["only if verdict is introduce_with_conditions"],
 "verdict_rationale": "tested against: is this JV worth doing at ₦0 raised?",
 "data_gaps": ["missing/weak profile fields on either side"]
}`;
}
