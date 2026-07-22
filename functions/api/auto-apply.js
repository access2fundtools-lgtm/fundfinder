// FundFinder AI — Auto-apply draft endpoint (Cloudflare Pages Function) — /api/auto-apply
// Drafts answers to a specific opportunity's application questions from the
// user's stored profile. NEVER submits anything — the human always sends the
// final form themselves. See dashboard-auto-apply-build-plan.md for the full
// design and the 2026-07-16 decisions section for the pricing model this
// implements.
//
// Pricing (charged only on success, never on a gap-blocked or failed run):
//   - 0 credits  : if the user's profile is missing something this program
//                  asks for. Nothing is drafted or charged — the response
//                  tells the client which profile fields to collect first.
//   - 20 credits : AI drafts an answer for every question, ready to copy
//                  into the org's own form by hand.
//   - 30 credits : same draft, PLUS a working prefilled deep link (only
//                  possible when the source form exposes stable field IDs
//                  in server-rendered HTML — see PREFILL LIMITATION below).
//                  Only charged if a prefill link was actually generated;
//                  this silently falls back to the 20-credit result otherwise.
//
// PREFILL LIMITATION (checked live 2026-07-16): modern Google Forms
// ("forms_2026" branding) render their field list client-side — the raw
// HTML a server-side fetch sees has no FB_PUBLIC_LOAD_DATA_ blob and no
// entry.NNNNN names anymore, so deterministic prefill-link generation is
// NOT reliably possible for current Google Forms from a Cloudflare
// Function (no JS execution environment here). The regex attempt below is
// best-effort for older/classic forms and JotForm instances that still
// expose field names in static markup; it will simply fail closed (no
// prefill, 20-credit charge) on anything else. Do not represent this as a
// solved feature — it's a real, load-bearing gap until there's a
// JS-rendering fetch path (e.g. proxied through a headless browser) to
// read the live field structure.
//
// Env: GEMINI_API_KEY, GEMINI_MODEL(optional), SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY

const CREDITS_DRAFT_ONLY = 20;
const CREDITS_DRAFT_WITH_PREFILL = 30;
const DEFAULT_MODEL = 'gemini-2.0-flash';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost(context) {
  try { return await handleAutoApply(context); }
  catch (err) { console.error('auto-apply fatal', err); return json({ error: 'server_error', message: 'Something went wrong. Please try again.' }, 500); }
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  return onRequestPost(context);
}

async function handleAutoApply(context) {
  const { request, env } = context;

  let opportunityId;
  try {
    const body = await request.json();
    opportunityId = body.opportunityId;
  } catch { return json({ error: 'bad_request', message: 'Invalid request body' }, 400); }
  if (!opportunityId) return json({ error: 'bad_request', message: 'Missing opportunityId' }, 400);

  // ── Auth (same pattern as chat.js) ──────────────────────────
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized', message: 'Please log in again.' }, 401);
  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return json({ error: 'unauthorized', message: 'Session expired. Please log in again.' }, 401);
  const user = await userRes.json();
  const userId = user.id;
  if (!userId) return json({ error: 'unauthorized', message: 'Could not verify your account.' }, 401);

  const svc = (path, init = {}) =>
    fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });

  // ── Load profile + opportunity ──────────────────────────────
  const [profRes, oppRes, docsRes] = await Promise.all([
    svc(`user_profiles?user_id=eq.${userId}&select=*`),
    svc(`opportunities?id=eq.${opportunityId}&select=id,title,apply_url,summary,eligibility,capital_type,amount_text`),
    svc(`user_documents?user_id=eq.${userId}&select=doc_type,file_name`),
  ]);
  const profile = (profRes.ok ? await profRes.json() : [])[0];
  const opportunity = (oppRes.ok ? await oppRes.json() : [])[0];
  const documents = docsRes.ok ? await docsRes.json() : [];
  if (!profile) return json({ error: 'profile_not_found', message: 'Complete your business profile first.' }, 404);
  if (!opportunity) return json({ error: 'opportunity_not_found', message: 'Could not find that opportunity.' }, 404);

  // ── Wallet check happens after we know the real cost, but confirm
  //    a wallet exists up front so we fail fast/cleanly. ─────────
  const wRes = await svc(`wallets?user_id=eq.${userId}&select=balance_credits`);
  const wallet = (wRes.ok ? await wRes.json() : [])[0];
  if (!wallet) return json({ error: 'wallet_not_found', message: 'Could not load your wallet.' }, 403);

  const model = env.GEMINI_MODEL || DEFAULT_MODEL;

  // ── Step 1: make sure we have this opportunity's questions ──
  let questions = await loadQuestions(svc, opportunityId);
  if (questions.length === 0) {
    questions = await extractQuestions(svc, env, model, opportunity);
    if (questions.length === 0) {
      // Extraction failed (page unreachable, requires login, nothing
      // extractable) — mark it so the dashboard stops offering this
      // opportunity for auto-apply, and charge nothing.
      await svc(`opportunities?id=eq.${opportunityId}`, { method: 'PATCH', body: JSON.stringify({ auto_apply_supported: false }) });
      return json({ error: 'not_supported', message: "We couldn't read this program's application questions automatically. Use the Apply link to apply directly." }, 422);
    }
  }

  // ── Step 2: draft answers from the profile, find gaps ───────
  const knownFacts = buildKnownFacts(profile, documents);
  const draft = await draftAnswers(env, model, questions, knownFacts, opportunity);
  if (!draft) return json({ error: 'ai_error', message: 'The assistant could not draft this application. Please try again.' }, 502);

  if (draft.gaps && draft.gaps.length > 0) {
    // Free — nothing is charged when we can't fully answer yet.
    // The client should prompt the user to fill these into their
    // profile, then call this endpoint again.
    return json({
      status: 'incomplete_profile',
      creditsCharged: 0,
      gaps: draft.gaps,
      message: 'Add a few more details to your profile to finish this draft.',
    });
  }

  // ── Step 3: best-effort prefill link (see limitation notice above) ──
  const prefillUrl = tryBuildPrefillLink(opportunity.apply_url, questions, draft.answers);
  const cost = prefillUrl ? CREDITS_DRAFT_WITH_PREFILL : CREDITS_DRAFT_ONLY;

  if (wallet.balance_credits < cost) {
    return json({
      error: 'insufficient_credits',
      message: `This draft costs ${cost} credits. Top up your wallet to continue.`,
      creditsRequired: cost,
      balance: wallet.balance_credits,
    }, 402);
  }

  const dRes = await svc('rpc/deduct_credits', { method: 'POST', body: JSON.stringify({ p_user_id: userId, p_credits: cost }) });
  if (!dRes.ok) { console.error('deduct_credits failed', await dRes.text()); return json({ error: 'server_error', message: 'Could not process credits. Please try again.' }, 500); }

  // ── Step 4: save the draft against the user's match row ─────
  await svc(`opportunity_matches?on_conflict=user_id,opportunity_id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      opportunity_id: opportunityId,
      answers: draft.answers,
      gaps: [],
      prefill_url: prefillUrl || null,
      application_draft: formatDraftAsText(questions, draft.answers),
      status: 'reviewed',
      updated_at: new Date().toISOString(),
    }),
  });

  return json({
    status: 'ok',
    creditsCharged: cost,
    balanceRemaining: Math.max(0, wallet.balance_credits - cost),
    answers: draft.answers,
    // Questions (id + text) so the UI can show each question paired with its
    // drafted answer in the review-before-submit step.
    questions: questions.map((q) => ({ id: q.id, question_text: q.question_text })),
    // Program details for the "what you're applying for" review panel.
    opportunity: {
      title: opportunity.title,
      summary: opportunity.summary,
      eligibility: opportunity.eligibility,
      capital_type: opportunity.capital_type,
      amount_text: opportunity.amount_text,
    },
    prefillUrl: prefillUrl || null,
    applyUrl: opportunity.apply_url,
  });
}

// ── Helpers ────────────────────────────────────────────────────

async function loadQuestions(svc, opportunityId) {
  const r = await svc(`opportunity_questions?opportunity_id=eq.${opportunityId}&select=id,question_text,field_type,options,required&order=sort_order.asc`);
  return r.ok ? await r.json() : [];
}

async function extractQuestions(svc, env, model, opportunity) {
  if (!opportunity.apply_url) return [];
  let pageText = '';
  try {
    const pageRes = await fetch(opportunity.apply_url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FundFinderBot/1.0)' } });
    if (!pageRes.ok) return [];
    const html = await pageRes.text();
    pageText = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
  } catch (err) { console.error('extractQuestions fetch error', err); return []; }
  if (!pageText) return [];

  const prompt = `You are extracting the list of questions an applicant must answer on a funding/grant/loan application form. Below is the visible text of the application page. Return ONLY a JSON array (no prose, no markdown fences) of objects: {"question_text": string, "field_type": "text"|"textarea"|"select"|"number"|"file"|"date", "required": boolean}. If this page does not look like an application form (e.g. it's a login wall, an article, or an error page), return an empty array [].

PAGE TEXT:
${pageText}`;

  let parsed = [];
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1024, temperature: 0.2 } }),
    });
    if (!r.ok) { console.error('Gemini extract error', r.status, await r.text()); return []; }
    const data = await r.json();
    const cand = data.candidates && data.candidates[0];
    const text = (cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || '').join('') : '').trim();
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
    parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) parsed = [];
  } catch (err) { console.error('extractQuestions parse error', err); return []; }
  if (parsed.length === 0) return [];

  const rows = parsed.slice(0, 40).map((q, i) => ({
    opportunity_id: opportunity.id,
    question_text: String(q.question_text || '').slice(0, 500),
    field_type: ['text', 'textarea', 'select', 'number', 'file', 'date'].includes(q.field_type) ? q.field_type : 'text',
    required: !!q.required,
    sort_order: i,
  })).filter((q) => q.question_text);
  if (rows.length === 0) return [];

  const insRes = await svc('opportunity_questions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(rows) });
  if (!insRes.ok) { console.error('opportunity_questions insert failed', await insRes.text()); return rows; }
  await svc(`opportunities?id=eq.${opportunity.id}`, { method: 'PATCH', body: JSON.stringify({ auto_apply_supported: true }) });
  return await insRes.json();
}

function buildKnownFacts(profile, documents) {
  const scalar = {
    full_name: profile.full_name, phone: profile.phone, whatsapp: profile.whatsapp,
    business_name: profile.business_name, business_sector: profile.business_sector,
    business_stage: profile.business_stage, business_location: profile.business_location,
    years_operating: profile.years_operating, is_registered: profile.is_registered,
    team_size: profile.team_size, age_range: profile.age_range,
    is_student: profile.is_student, student_level: profile.student_level,
    field_of_study: profile.field_of_study, institution: profile.institution,
    graduation_year: profile.graduation_year, city: profile.city, gender: profile.gender,
    annual_revenue: profile.annual_revenue, funding_purpose: profile.funding_purpose,
    cac_number: profile.cac_number, bank_name: profile.bank_name,
  };
  const facts = { ...scalar, ...(profile.profile_facts || {}) };
  Object.keys(facts).forEach((k) => { if (facts[k] === null || facts[k] === undefined || facts[k] === '') delete facts[k]; });
  facts.available_documents = documents.map((d) => d.doc_type);
  return facts;
}

async function draftAnswers(env, model, questions, knownFacts, opportunity) {
  const prompt = `You are drafting application answers for a Nigerian entrepreneur/student applying to: "${opportunity.title}".

Answer ONLY using the facts provided below — never invent information. For any question you cannot answer from these facts, do not guess; report it as a gap instead.

KNOWN FACTS (JSON):
${JSON.stringify(knownFacts)}

QUESTIONS (JSON array, each has an id):
${JSON.stringify(questions.map((q) => ({ id: q.id, question_text: q.question_text, field_type: q.field_type })))}

Return ONLY a JSON object (no prose, no markdown fences) shaped exactly like:
{"answers": {"<question id>": "<drafted answer text>"}, "gaps": [{"id": "<question id>", "question_text": "<the question>", "suggested_profile_field": "<short snake_case name for what to add to their profile, e.g. years_operating>"}]}

Every question id must appear in either "answers" or "gaps", never both.`;

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 2048, temperature: 0.3 } }),
    });
    if (!r.ok) { console.error('Gemini draft error', r.status, await r.text()); return null; }
    const data = await r.json();
    const cand = data.candidates && data.candidates[0];
    const text = (cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || '').join('') : '').trim();
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
    const parsed = JSON.parse(cleaned);
    return { answers: parsed.answers || {}, gaps: parsed.gaps || [] };
  } catch (err) { console.error('draftAnswers error', err); return null; }
}

// Best-effort only — see PREFILL LIMITATION notice at the top of this file.
// Returns null (never charges the 30-credit tier) unless it actually finds
// real field identifiers in server-rendered HTML.
function tryBuildPrefillLink(applyUrl, questions, answers) {
  if (!applyUrl) return null;
  // Deliberately not implemented against live Google Forms markup — the
  // current "forms_2026" rendering exposes no field IDs in static HTML
  // (verified 2026-07-16, see file header). Returning null here means
  // every run charges the 20-credit draft-only tier until a JS-rendering
  // fetch path exists to read the real form structure.
  return null;
}

function formatDraftAsText(questions, answers) {
  return questions.map((q) => `Q: ${q.question_text}\nA: ${answers[q.id] || ''}`).join('\n\n');
}
