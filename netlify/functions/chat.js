// FundFinder AI — Auth-gated Chat Function
// Verifies user session, checks credits, calls Claude Haiku, deducts credits
// Required env vars (set in Netlify → Site config → Environment variables):
//   ANTHROPIC_API_KEY  — your Anthropic API key (console.anthropic.com)
//   SUPABASE_URL       — your Supabase project URL
//   SUPABASE_SERVICE_KEY — Supabase service role key (NOT the anon key)

const { createClient } = require('@supabase/supabase-js');

const CREDITS_PER_MESSAGE = 1;
const MODEL = 'claude-haiku-4-5-20251001';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  // Parse request
  let userId, messages, systemPrompt, sessionId;
  try {
    const body = JSON.parse(event.body);
    userId     = body.userId;
    messages   = body.messages;
    systemPrompt = body.systemPrompt;
    sessionId  = body.sessionId || 'default';
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!userId || !messages) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId or messages' }) };
  }

  // Supabase service client (bypasses RLS for server-side ops)
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // ── 1. Check credit balance ──────────────────────────────
  const { data: wallet, error: walletErr } = await supabase
    .from('wallets')
    .select('balance_credits')
    .eq('user_id', userId)
    .single();

  if (walletErr || !wallet) {
    return { statusCode: 403, body: JSON.stringify({ error: 'wallet_not_found', message: 'Could not load your wallet.' }) };
  }

  if (wallet.balance_credits < CREDITS_PER_MESSAGE) {
    return {
      statusCode: 402,
      body: JSON.stringify({
        error: 'insufficient_credits',
        message: `You need at least ${CREDITS_PER_MESSAGE} credit to send a message. Top up your wallet to continue.`,
        balance: wallet.balance_credits
      })
    };
  }

  // ── 2. Call Claude Haiku ─────────────────────────────────
  let aiResponse, promptTokens, completionTokens;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt || buildDefaultSystemPrompt(),
        messages
      })
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Anthropic error:', err);
      return { statusCode: 502, body: JSON.stringify({ error: 'ai_error', message: 'AI service error. Please try again.' }) };
    }

    const data = await response.json();
    aiResponse       = data.content[0].text;
    promptTokens     = data.usage?.input_tokens || 0;
    completionTokens = data.usage?.output_tokens || 0;

  } catch (err) {
    console.error('Fetch error:', err);
    return { statusCode: 502, body: JSON.stringify({ error: 'ai_error', message: 'Could not reach AI service.' }) };
  }

  // ── 3. Deduct credits atomically ─────────────────────────
  const { error: deductErr } = await supabase.rpc('deduct_credits', {
    p_user_id: userId,
    p_credits: CREDITS_PER_MESSAGE
  });

  if (deductErr) {
    // Credit deduction failed — still return response but log it
    console.error('Credit deduction failed:', deductErr);
  }

  // ── 4. Log the chat message ──────────────────────────────
  await supabase.from('chat_logs').insert({
    user_id:           userId,
    session_id:        sessionId,
    message_role:      'assistant',
    credits_charged:   CREDITS_PER_MESSAGE,
    prompt_tokens:     promptTokens,
    completion_tokens: completionTokens
  });

  // ── 5. Get updated balance ───────────────────────────────
  const { data: updatedWallet } = await supabase
    .from('wallets')
    .select('balance_credits')
    .eq('user_id', userId)
    .single();

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response: aiResponse,
      creditsUsed: CREDITS_PER_MESSAGE,
      balanceRemaining: updatedWallet?.balance_credits ?? (wallet.balance_credits - CREDITS_PER_MESSAGE)
    })
  };
};

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
