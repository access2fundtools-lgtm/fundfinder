// FundFinder AI — Secure AI chat proxy (Cloudflare Pages Function)
// Path: /api/chat   (file: functions/api/chat.js)
//
// Uses Google Gemini (free tier by default). The API key stays server-side,
// the caller's Supabase session is verified, and 1 credit is deducted per
// message. Swapping models = change GEMINI_MODEL; swapping providers = edit
// only this file.
//
// Cloudflare env vars (Secret for the key):
//   GEMINI_API_KEY        — Google AI Studio (aistudio.google.com) key
//   GEMINI_MODEL          — optional, defaults to 'gemini-2.5-flash'
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY  — Supabase service_role key
//   SUPABASE_ANON_KEY     — Supabase anon/publishable key

const CREDITS_PER_MESSAGE = 1;
const DEFAULT_MODEL = 'gemini-2.5-flash';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost(context) {
  const { request, env } = context;

  let messages, systemPrompt, sessionId;
  try {
    const body = await request.json();
    messages = body.messages; systemPrompt = body.systemPrompt; sessionId = body.sessionId || 'default';
  } catch { return json({ error: 'bad_request', message: 'Invalid request body' }, 400); }
  if (!Array.isArray(messages) || messages.length === 0)
    return json({ error: 'bad_request', message: 'Missing messages' }, 400);

  // Verify caller from Supabase access token
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
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });

  // Credit check
  const wRes = await svc(`wallets?user_id=eq.${userId}&select=balance_credits`);
  const wText = await wRes.text();
  let wArr = []; try { wArr = JSON.parse(wText); } catch (_) {}
  const wallet = Array.isArray(wArr) ? wArr[0] : null;
  if (!wallet) return json({ error: 'wallet_not_found', message: 'Could not load your wallet.', _debug: {
    wStatus: wRes.status,
    wBody: String(wText).slice(0, 140),
    uid: String(userId).slice(0, 8),
    svcLen: (env.SUPABASE_SERVICE_KEY || '').length,
    svcPrefix: (env.SUPABASE_SERVICE_KEY || '').slice(0, 10),
    anonPrefix: (env.SUPABASE_ANON_KEY || '').slice(0, 10),
    urlHasSupabase: (env.SUPABASE_URL || '').includes('supabase.co')
  } }, 403);
  if (wallet.balance_credits < CREDITS_PER_MESSAGE)
    return json({ error: 'insufficient_credits', message: "You're out of credits. Top up your wallet to keep chatting.", balance: wallet.balance_credits }, 402);

  // Call Gemini
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '') }],
  }));
  let aiResponse = '';
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt || buildDefaultSystemPrompt() }] },
        contents,
        generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
      }),
    });
    if (!r.ok) {
      console.error('Gemini error:', await r.text());
      return json({ error: 'ai_error', message: 'AI service error. Please try again.' }, 502);
    }
    const data = await r.json();
    const cand = data.candidates && data.candidates[0];
    aiResponse = (cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || '').join('') : '').trim();
    if (!aiResponse) {
      console.error('Gemini empty/blocked:', JSON.stringify(data).slice(0, 500));
      return json({ error: 'ai_error', message: 'The assistant could not respond to that. Please rephrase and try again.' }, 502);
    }
  } catch (err) {
    console.error('Fetch error:', err);
    return json({ error: 'ai_error', message: 'Could not reach AI service.' }, 502);
  }

  // Deduct 1 credit (only after a successful response)
  const dRes = await svc('rpc/deduct_credits', { method: 'POST', body: JSON.stringify({ p_user_id: userId, p_credits: CREDITS_PER_MESSAGE }) });
  if (!dRes.ok) console.error('deduct_credits failed:', await dRes.text());

  // Log (best-effort)
  try {
    await svc('chat_logs', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: userId, session_id: sessionId, message_role: 'assistant', credits_charged: CREDITS_PER_MESSAGE }) });
  } catch (_) {}

  const uRes = await svc(`wallets?user_id=eq.${userId}&select=balance_credits`);
  const updated = uRes.ok ? (await uRes.json())[0] : null;
  return json({ response: aiResponse, creditsUsed: CREDITS_PER_MESSAGE, balanceRemaining: updated?.balance_credits ?? (wallet.balance_credits - CREDITS_PER_MESSAGE) });
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  return onRequestPost(context);
}

function buildDefaultSystemPrompt() {
  return `You are FundFinder AI — an intelligent funding assistant for Nigerian entrepreneurs, students, and professionals.

Your sole purpose is to:
1. Understand the user's business, academic profile, or career goals
2. Match them to funding opportunities, grants, scholarships, and fellowships they qualify for
3. Guide them through applying — pre-filling information, advising on documents needed
4. Flag any suspicious programmes or potential scams with warnings

SCOPE RESTRICTION: If a user asks anything unrelated to their business profile, funding opportunities, grant applications, scholarships, or career development programmes in Nigeria/Africa, respond with:
"I'm FundFinder AI — I'm built specifically to help you find and apply for funding, grants, and scholarships. I can't help with [topic], but I'd love to help you find an opportunity that fits your profile instead."

SCAM AWARENESS: When discussing any programme, note if the organiser is unverifiable, newly established, or shows red flags. Always add: "Always do your own due diligence. If contacted about funding, verify through official channels before sharing personal information or paying any fees."

Be warm, encouraging, and specific. Ask follow-up questions to build a complete picture of the user's profile so you can give better matches.`;
}
