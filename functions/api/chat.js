// FundFinder AI — Secure AI chat proxy (Cloudflare Pages Function) — /api/chat
// Google Gemini, key held server-side, session-verified, 1 credit per message.
// Env: GEMINI_API_KEY, GEMINI_MODEL(optional), SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY

const CREDITS_PER_MESSAGE = 1;
const DEFAULT_MODEL = 'gemini-2.0-flash';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost(context) {
  try { return await handleChat(context); }
  catch (err) { return json({ error: 'server_error', message: 'Something went wrong. Please try again.' }, 500); }
}

async function handleChat(context) {
  const { request, env } = context;

  let messages, systemPrompt, sessionId;
  try {
    const body = await request.json();
    messages = body.messages; systemPrompt = body.systemPrompt; sessionId = body.sessionId || 'default';
  } catch { return json({ error: 'bad_request', message: 'Invalid request body' }, 400); }
  if (!Array.isArray(messages) || messages.length === 0)
    return json({ error: 'bad_request', message: 'Missing messages' }, 400);

  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized', message: 'Please log in again.' }, 401);
  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return json({ error: 'unauthorized', message: 'Session expired. Please log in again.' }, 401);
  const user = await userRes.json();
  const userId = user.id;
  if (!userId) return json({ error: 'unauthorized', message: 'Could not verify your account.' }, 401);

  const probe = (() => { try { return new URL(request.url).searchParams.get('probe'); } catch { return null; } })();

  const svc = (path, init = {}) =>
    fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });

  const wRes = await svc(`wallets?user_id=eq.${userId}&select=balance_credits`);
  const wallet = (wRes.ok ? await wRes.json() : [])[0];
  if (!wallet) return json({ error: 'wallet_not_found', message: 'Could not load your wallet.' }, 403);
  if (wallet.balance_credits < CREDITS_PER_MESSAGE)
    return json({ error: 'insufficient_credits', message: "You're out of credits. Top up your wallet to keep chatting.", balance: wallet.balance_credits }, 402);

  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content || '') }] }));
  let aiResponse = '';
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_instruction: { parts: [{ text: systemPrompt || buildDefaultSystemPrompt() }] }, contents, generationConfig: { maxOutputTokens: 1024, temperature: 0.7 } }),
    });
    if (!r.ok) { console.error('Gemini error', r.status, await r.text()); return json({ error: 'ai_error', message: 'AI service error. Please try again.' }, 502); }
    const data = await r.json();
    const cand = data.candidates && data.candidates[0];
    aiResponse = (cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || '').join('') : '').trim();
    if (!aiResponse) return json({ error: 'ai_error', message: 'The assistant could not respond to that. Please rephrase and try again.' }, 502);
  } catch (err) { console.error('Gemini fetch error', err); return json({ error: 'ai_error', message: 'Could not reach AI service.' }, 502); }


  if (probe === 'aftergemini') return json({ stage: 'aftergemini', respLen: aiResponse.length }, 200);

  const dRes = await svc('rpc/deduct_credits', { method: 'POST', body: JSON.stringify({ p_user_id: userId, p_credits: CREDITS_PER_MESSAGE }) });
  if (!dRes.ok) console.error('deduct_credits failed', await dRes.text());

  if (probe === 'afterdeduct') return json({ stage: 'afterdeduct', deductOk: dRes.ok, deductStatus: dRes.status }, 200);

  return json({ response: aiResponse, creditsUsed: CREDITS_PER_MESSAGE, balanceRemaining: Math.max(0, wallet.balance_credits - CREDITS_PER_MESSAGE) });
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

SCOPE: If asked anything unrelated to funding, grants, scholarships, or business/career development in Nigeria/Africa, gently redirect to how you can help them find funding.

SCAM AWARENESS: Note if an organiser is unverifiable or shows red flags, and remind users to verify through official channels before sharing personal information or paying fees.

Be warm, encouraging, specific, and ask follow-up questions to build a complete profile for better matches.`;
}
