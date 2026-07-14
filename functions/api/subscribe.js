// FundFinder AI — Newsletter subscribe endpoint (Cloudflare Pages Function)
// Path: /api/subscribe   (file: functions/api/subscribe.js)
//
// Called by every "Get Alerts" / "Email Me" form on opportunity-hub.html.
// Does two things per submission:
//   1. Always inserts/upserts the email into Supabase `newsletter_subscribers`
//      (source of truth — visible in admin.html "Leads" tab).
//   2. If Zoho Campaigns env vars are configured, also pushes the contact into
//      the Zoho mailing list so the Autoresponder (see ZOHO-SETUP.md) can send
//      the automatic "complete your profile" follow-up email.
//
// Cloudflare env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY   — Supabase service_role key (bypasses RLS for insert)
//   ZOHO_CLIENT_ID         — from Zoho API Console self-client
//   ZOHO_CLIENT_SECRET     — from Zoho API Console self-client
//   ZOHO_REFRESH_TOKEN     — long-lived; exchanged for a fresh access token on every call
//   ZOHO_LIST_KEY          — target mailing list key
//
// If the Zoho vars aren't set yet, the function still succeeds (Supabase insert
// only) — safe to deploy before Zoho setup is finished.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost(context) {
  try { return await handleSubscribe(context); }
  catch (err) { return json({ success: false, error: 'server_error', message: String((err && err.message) || err) }, 500); }
}

async function handleSubscribe(context) {
  const { request, env } = context;

  let email, source;
  try {
    const body = await request.json();
    email = (body.email || '').trim().toLowerCase();
    source = (body.source || 'hub').trim().slice(0, 40);
  } catch { return json({ success: false, error: 'bad_request', message: 'Invalid request body' }, 400); }

  if (!email || !email.includes('@')) {
    return json({ success: false, error: 'invalid_email', message: 'Please enter a valid email address.' }, 400);
  }

  // 1. Always record in Supabase (source of truth for the admin Leads tab).
  let supabaseOk = false;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    try {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/newsletter_subscribers?on_conflict=email`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify({ email, source }),
      });
      supabaseOk = res.ok;
    } catch (_) { /* fall through — still try Zoho */ }
  }

  // 2. Best-effort push to Zoho Campaigns so the Autoresponder can fire.
  const { clientId, clientSecret, refreshToken, listKey } = {
    clientId: env.ZOHO_CLIENT_ID,
    clientSecret: env.ZOHO_CLIENT_SECRET,
    refreshToken: env.ZOHO_REFRESH_TOKEN,
    listKey: env.ZOHO_LIST_KEY,
  };

  if (clientId && clientSecret && refreshToken && listKey) {
    try {
      const accessToken = await getZohoAccessToken({ clientId, clientSecret, refreshToken });
      if (accessToken) {
        const params = new URLSearchParams({
          resfmt: 'JSON',
          listkey: listKey,
          contactinfo: JSON.stringify({ 'Contact Email': email }),
        });
        await fetch(`https://campaigns.zoho.com/api/v1.1/json/listsubscribe?authtoken=${accessToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        // Zoho's own response codes (success / ContactAlreadyExists) are both fine —
        // we never block the visitor's experience on Zoho's reply.
      }
    } catch (_) { /* Zoho hiccup shouldn't fail the signup for the visitor */ }
  }

  // Visitor always sees success as long as we at least logged the lead somewhere.
  return json({ success: true, recorded: supabaseOk });
}

// Zoho access tokens expire after 1 hour — exchange the long-lived refresh
// token for a fresh one on every request rather than caching (Cloudflare
// Functions are stateless per-invocation anyway).
async function getZohoAccessToken({ clientId, clientSecret, refreshToken }) {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });
  const res = await fetch(`https://accounts.zoho.com/oauth/v2/token?${params.toString()}`, { method: 'POST' });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}
