// FundFinder AI — WhatsApp alert broadcast (Cloudflare Pages Function)
// Path: /api/whatsapp-broadcast   (file: functions/api/whatsapp-broadcast.js)
//
// Called by the daily scraper (GitHub Actions) after new opportunities are published.
// Sends a WhatsApp template message to every subscriber who opted into WhatsApp alerts
// (user_profiles.notify_whatsapp = true) via the Meta WhatsApp Cloud API.
//
// SECURITY: requires  Authorization: Bearer <WHATSAPP_BROADCAST_SECRET>  so only the
// scraper (which holds the same secret in GitHub Actions) can trigger a send.
//
// Cloudflare env vars / secrets:
//   SUPABASE_URL              — already set (used by subscribe.js)
//   SUPABASE_SERVICE_KEY      — already set; service_role key, bypasses RLS to read numbers
//   WHATSAPP_BROADCAST_SECRET — shared trigger secret (also in GitHub Actions secrets)
//   WHATSAPP_TOKEN            — Meta permanent (or temp) access token for the number
//   WHATSAPP_PHONE_NUMBER_ID  — the Phone Number ID from Meta (NOT the phone number itself)
//   WHATSAPP_TEMPLATE_NAME    — approved template name (default: new_funding_alert)
//   WHATSAPP_TEMPLATE_LANG    — template language code (default: en)
//   WHATSAPP_DAILY_CAP        — max recipients per run (default: 250 = unverified tier cap)
//   WHATSAPP_GRAPH_VERSION    — Graph API version (default: v21.0)
//
// SAFE TO DEPLOY BEFORE CREDENTIALS EXIST: if WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID
// are not set, the function records the request and returns {skipped:true} with 200 —
// it never errors, so the scraper keeps working until you finish the Meta setup.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost(context) {
  try { return await handleBroadcast(context); }
  catch (err) { return json({ success: false, error: 'server_error', message: String((err && err.message) || err) }, 500); }
}

// Normalise a Nigerian (or already-international) number to E.164 digits, no '+'.
function toE164(raw) {
  let d = String(raw || '').replace(/[^\d]/g, '');
  if (!d) return null;
  if (d.startsWith('234')) { /* already intl */ }
  else if (d.startsWith('0')) d = '234' + d.slice(1);
  else if (d.length === 10) d = '234' + d;             // e.g. 8062085464
  // basic sanity: Nigerian MSISDN is 13 digits as 234XXXXXXXXXX
  if (d.length < 11 || d.length > 15) return null;
  return d;
}

async function handleBroadcast(context) {
  const { request, env } = context;

  // 1. Auth — only the scraper (holding the shared secret) may trigger a send.
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!env.WHATSAPP_BROADCAST_SECRET || token !== env.WHATSAPP_BROADCAST_SECRET) {
    return json({ success: false, error: 'unauthorized' }, 401);
  }

  // 2. Parse payload from the scraper.
  let count = 0, headline = '', test = false, testNumber = '';
  try {
    const body = await request.json();
    count = parseInt(body.count, 10) || 0;
    headline = (body.headline || '').toString().slice(0, 120);
    test = !!body.test;
    testNumber = (body.testNumber || '').toString();
  } catch { /* empty body allowed for a no-op ping */ }

  if (!test && count < 1) {
    return json({ success: true, sent: 0, note: 'no new opportunities to alert' });
  }

  // 3. If WhatsApp credentials aren't configured yet, no-op gracefully.
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    return json({ success: true, skipped: true, reason: 'whatsapp_not_configured',
      note: 'Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Cloudflare to enable sending.' });
  }

  const GV = env.WHATSAPP_GRAPH_VERSION || 'v21.0';
  const TEMPLATE = env.WHATSAPP_TEMPLATE_NAME || 'new_funding_alert';
  const LANG = env.WHATSAPP_TEMPLATE_LANG || 'en';
  const CAP = parseInt(env.WHATSAPP_DAILY_CAP, 10) || 250;

  // 4. Gather recipient numbers.
  let numbers = [];
  if (test && testNumber) {
    const e = toE164(testNumber);
    if (e) numbers = [e];
  } else if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    try {
      const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/user_profiles?notify_whatsapp=eq.true&whatsapp=not.is.null&select=whatsapp`,
        { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
      );
      if (res.ok) {
        const rows = await res.json();
        const seen = new Set();
        for (const r of rows) {
          const e = toE164(r.whatsapp);
          if (e && !seen.has(e)) { seen.add(e); numbers.push(e); }
        }
      }
    } catch (_) { /* fall through with empty list */ }
  }

  if (numbers.length === 0) {
    return json({ success: true, sent: 0, note: 'no opted-in WhatsApp recipients found' });
  }

  // Respect the unverified-tier daily cap (250 unique contacts/day by default).
  const capped = numbers.slice(0, CAP);

  // 5. Build template message body variables: {{1}} = count, {{2}} = headline opportunity.
  const bodyParams = [
    { type: 'text', text: String(count || 1) },
    { type: 'text', text: headline || 'new funding opportunities' },
  ];
  const url = `https://graph.facebook.com/${GV}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const sendOne = async (to) => {
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: TEMPLATE, language: { code: LANG }, components: [{ type: 'body', parameters: bodyParams }] },
    };
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) return { ok: true };
      const err = await r.text();
      return { ok: false, status: r.status, err: err.slice(0, 200) };
    } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
  };

  // 6. Send with a small concurrency pool so we don't hammer the Graph API.
  let sent = 0, failed = 0; const errors = [];
  const POOL = 5;
  for (let i = 0; i < capped.length; i += POOL) {
    const batch = capped.slice(i, i + POOL);
    const results = await Promise.all(batch.map(sendOne));
    for (const res of results) {
      if (res.ok) sent++; else { failed++; if (errors.length < 5) errors.push(res); }
    }
  }

  return json({
    success: true, recipients: numbers.length, attempted: capped.length,
    sent, failed, capped: numbers.length > CAP, cap: CAP,
    sampleErrors: errors,
  });
}
