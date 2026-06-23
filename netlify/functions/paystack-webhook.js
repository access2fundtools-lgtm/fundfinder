// FundFinder AI — Paystack Webhook Handler
// Paystack calls this URL when a payment is verified
// Set this in Paystack Dashboard → Settings → API Keys & Webhooks
// Webhook URL: https://opportunities.a2fpartners.com/.netlify/functions/paystack-webhook
//
// Required env vars:
//   PAYSTACK_SECRET_KEY  — from Paystack Dashboard → Settings → API Keys
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  // ── 1. Verify Paystack signature ────────────────────────
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  const signature = event.headers['x-paystack-signature'];
  const hash = crypto
    .createHmac('sha512', paystackSecret)
    .update(event.body)
    .digest('hex');

  if (hash !== signature) {
    console.error('Invalid Paystack signature');
    return { statusCode: 401, body: 'Invalid signature' };
  }

  // ── 2. Parse event ───────────────────────────────────────
  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  // Only handle successful charge events
  if (payload.event !== 'charge.success') {
    return { statusCode: 200, body: 'OK (ignored)' };
  }

  const { reference, amount, metadata, customer } = payload.data;
  const userId    = metadata?.user_id;
  const credits   = parseInt(metadata?.credits || 0);
  const packageId = metadata?.package_id;

  if (!userId || !credits || !reference) {
    console.error('Missing required metadata:', { userId, credits, reference });
    return { statusCode: 200, body: 'OK (skipped - missing metadata)' };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // ── 3. Idempotency check — don't process twice ───────────
  const { data: existing } = await supabase
    .from('transactions')
    .select('id, status')
    .eq('paystack_ref', reference)
    .single();

  if (existing?.status === 'success') {
    console.log('Already processed:', reference);
    return { statusCode: 200, body: 'Already processed' };
  }

  // ── 4. Top up wallet ─────────────────────────────────────
  const { error: walletErr } = await supabase.rpc('add_credits', {
    p_user_id: userId,
    p_credits: credits
  });

  if (walletErr) {
    console.error('Wallet top-up failed:', walletErr);
    return { statusCode: 500, body: 'Wallet update failed' };
  }

  // ── 5. Record transaction as success ─────────────────────
  await supabase.from('transactions').upsert({
    user_id:      userId,
    paystack_ref: reference,
    amount_ngn:   Math.round(amount / 100), // convert kobo to Naira
    credits_added: credits,
    package_id:   packageId || null,
    status:       'success',
    paystack_data: payload.data,
    verified_at:  new Date().toISOString()
  }, { onConflict: 'paystack_ref' });

  console.log(`✅ Topped up ${credits} credits for user ${userId} (ref: ${reference})`);
  return { statusCode: 200, body: 'OK' };
};
