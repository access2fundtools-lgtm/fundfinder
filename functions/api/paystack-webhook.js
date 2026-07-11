// FundFinder AI — Paystack webhook (Cloudflare Pages Function)
// Path: /api/paystack-webhook   (file: functions/api/paystack-webhook.js)
//
// Paystack calls this when a payment succeeds. It verifies the signature,
// then credits the buyer's wallet and marks the transaction successful.
// Set the webhook URL in Paystack → Settings → API Keys & Webhooks:
//   https://fundfinder.ng/api/paystack-webhook
//
// Cloudflare env vars (Secret):
//   PAYSTACK_SECRET_KEY   — Paystack → Settings → API Keys (sk_live_...)
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY  — Supabase service_role key

const ok = (msg = 'OK', status = 200) => new Response(msg, { status });

// HMAC-SHA512 hex using Web Crypto (Node's crypto isn't available here)
async function hmacSha512Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Raw body is required for signature verification — read as text, don't parse yet
  const raw = await request.text();

  // ── 1. Verify Paystack signature ──────────────────────────
  const signature = request.headers.get('x-paystack-signature') || '';
  const expected = await hmacSha512Hex(env.PAYSTACK_SECRET_KEY, raw);
  if (signature !== expected) {
    console.error('Invalid Paystack signature');
    return ok('Invalid signature', 401);
  }

  // ── 2. Parse + filter to successful charges ───────────────
  let payload;
  try { payload = JSON.parse(raw); } catch { return ok('Invalid JSON', 400); }
  if (payload.event !== 'charge.success') return ok('OK (ignored)');

  const d = payload.data || {};
  const userId    = d.metadata?.user_id;
  const credits   = parseInt(d.metadata?.credits || 0, 10);
  const packageId = d.metadata?.package_id || null;
  const reference = d.reference;
  if (!userId || !credits || !reference) return ok('OK (skipped - missing metadata)');

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

  // ── 3. Idempotency — skip if already credited ─────────────
  const exRes = await svc(`transactions?paystack_ref=eq.${encodeURIComponent(reference)}&select=id,status`);
  const existing = exRes.ok ? (await exRes.json())[0] : null;
  if (existing?.status === 'success') return ok('Already processed');

  // ── 4. Credit the wallet ──────────────────────────────────
  const addRes = await svc('rpc/add_credits', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: userId, p_credits: credits }),
  });
  if (!addRes.ok) {
    console.error('add_credits failed:', await addRes.text());
    return ok('Wallet update failed', 500);
  }

  // ── 5. Mark the transaction successful ────────────────────
  await svc('transactions?on_conflict=paystack_ref', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      paystack_ref: reference,
      amount_ngn: Math.round((d.amount || 0) / 100),
      credits_added: credits,
      package_id: packageId,
      status: 'success',
      paystack_data: d,
      verified_at: new Date().toISOString(),
    }),
  });

  console.log(`Topped up ${credits} credits for ${userId} (ref ${reference})`);
  return ok('OK');
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return ok('Method Not Allowed', 405);
  return onRequestPost(context);
}
