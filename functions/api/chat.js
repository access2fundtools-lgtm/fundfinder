// FundFinder AI — Secure AI chat proxy (Cloudflare Pages Function)
// Path: /api/chat   (file lives at: functions/api/chat.js)
//
// Holds the Anthropic key server-side, verifies the caller's Supabase session,
// checks + deducts 1 credit per message, then calls Claude. The browser never
// sees the API key and cannot spoof another user.
//
// Cloudflare env vars (Pages → Settings → Environment variables, "Secret"):
//   ANTHROPIC_API_KEY     — console.anthropic.com
//   SUPABASE_URL          — https://zrkxigbmlprrowiofhjy.supabase.co
//   SUPABASE_SERVICE_KEY  — Supabase → Settings → API → service_role (secret!)
//   SUPABASE_ANON_KEY     — Supabase → Settings → API → anon/publishable

const CREDITS_PER_MESSAGE = 1;
const MODEL = 'claude-haiku-4-5-20251001';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function onRequestPost(context) {
  const { request, env } = context;

  // ── Parse body ────────────────────────────────────────────
  let messages, systemPrompt, sessionId;
  try {
    const body = await request.json();
    messages     = body.messages;
    systemPrompt = body.systemPrompt;
    sessionId    = body.sessionId || 'default';
  } catch {
    return json({ error: 'bad_request', message: 'Invalid request body' }, 400);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: 'bad_request', message: 'Missing messages' }, 400);
  }

  // ── 1. Verify the caller from their Supabase access token ──
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized', message: 'Please log in again.' }, 401);

  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return json({ error: 'unauthorized', message: 'Session expired. Please log in again.' }, 401);
  const user = await userRes.json();
  const userId = user.id;
  if (!userId) return json({ error: 'unauthorized', message: 'Could not verify your account.' }, 401);

  // Helper for service-role REST calls (bypasses RLS)
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

  // ── 2. Check credit balance ───────────────────────────────
  const wRes = await svc(`wallets?user_id=eq.${userId}&select=balance_credits`);
  const wallets = wRes.ok ? await wRes.json() : [];
  const wallet = wallets[0];
  if (!wallet) return json({ error: 'wallet_not_found', message: 'Could not load your wallet.' }, 403);

  if (wallet.balance_credits < CREDITS_PER_MESSAGE) {
    return json({
      error: 'insufficient_credits',
      message: `You're out of credits. Top up your wallet to keep chatting.`,
      balance: wallet.balance_credits,
    }, 402);
  }

  // ── 3. Call Claude ────────────────────────────────────────
  let aiResponse, promptTokens = 0, completionTokens = 0;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt || buildDefaultSystemPrompt(),
        messages,
      }),
    });
    if (!r.ok) {
      const e = await r.text();
      console.error('Anthropic error:', e);
      return json({ error: 'ai_error', message: 'AI service error. Please try again.' }, 502);
    }
    const data = await r.json();
    aiResponse       = data.content?.[0]?.text || '';
    promptTokens     = data.usage?.input_tokens || 0;
    completionTokens = data.usage?.output_tokens || 0;
  } catch (err) {
    console.error('Fetch error:', err);
    return json({ error: 'ai_error', message: 'Could not reach AI service.' }, 502);
  }

  // ── 4. Deduct 1 credit atomically (DB function) ───────────
  const dRes = await svc('rpc/deduct_credits', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: userId, p_credits: CREDITS_PER_MESSAGE }),
  });
  if (!dRes.ok) console.error('deduct_credits failed:', await dRes.text());

  // ── 5. Log (best-effort; ignore failures) ─────────────────
  try {
    await svc('chat_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: userId,
        session_id: sessionId,
        message_role: 'assistant',
        credits_charged: CREDITS_PER_MESSAGE,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
      }),
    });
  } catch (_) { /* non-fatal */ }

  // ── 6. Return response + fresh balance ────────────────────
  const uRes = await svc(`wallets?user_id=eq.${userId}&select=balance_credits`);
  const updated = uRes.ok ? (await uRes.json())[0] : null;

  return json({
    response: aiResponse,
    creditsUsed: CREDITS_PER_MESSAGE,
    balanceRemaining: updated?.balance_credits ?? (wallet.balance_credits - CREDITS_PER_MESSAGE),
  });
}

// Block non-POST methods cleanly
export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
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

SCAM AWARENESS: When discussing any programme, note if the organiser is unverifiable, newly established, or shows red flags. Always add: "⚠️ Always do your own due diligence. If contacted about funding, verify through official channels before sharing personal information or paying any fees."

Be warm, encouraging, and specific. Ask follow-up questions to build a complete picture of the user's profile so you can give better matches.`;
}
