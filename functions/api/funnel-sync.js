// FundFinder AI — Funnel stage sync (Cloudflare Pages Function)
// Path: /api/funnel-sync   (file: functions/api/funnel-sync.js)
//
// Reads public.funnel_stage from Supabase and writes each contact's stage into
// Zoho Campaigns as the custom field `Funnel_Stage`. Zoho workflows segment on
// that field, so this job is the only thing standing between "who they are in
// the product" and "which sequence they receive".
//
// Runs on a schedule — see .github/workflows/funnel-sync.yml. Also callable by
// hand for testing.
//
// Auth: Authorization: Bearer <FUNNEL_SYNC_SECRET>
//
// Cloudflare env vars:
//   FUNNEL_SYNC_SECRET   — shared secret (also a GitHub Actions secret)
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY — needed; funnel_stage is service_role only
//   ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN / ZOHO_LIST_KEY
//   FUNNEL_SYNC_LIMIT    — optional, max contacts per run (default 400)
//
// Deploy-safe: with no Zoho vars set it reports what it *would* have synced and
// changes nothing.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost(context) {
  try { return await handleSync(context); }
  catch (err) { return json({ success: false, error: 'server_error', message: String((err && err.message) || err) }, 500); }
}

// Allow GET too, so a scheduled curl or a browser check can trigger it.
export const onRequestGet = onRequestPost;

async function handleSync(context) {
  const { request, env } = context;

  const auth = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!env.FUNNEL_SYNC_SECRET || auth !== env.FUNNEL_SYNC_SECRET) {
    return json({ success: false, error: 'unauthorized' }, 401);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ success: false, error: 'supabase_not_configured' }, 500);
  }

  const limit  = Math.min(parseInt(env.FUNNEL_SYNC_LIMIT || '400', 10) || 400, 1000);
  const dryRun = new URL(request.url).searchParams.get('dry') === '1';

  // --- read stages --------------------------------------------------------
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/funnel_stage?select=email,stage,days_since_signup,profile_complete&order=signed_up_at.desc&limit=${limit}`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  if (!res.ok) {
    return json({ success: false, error: 'supabase_read_failed', status: res.status, detail: (await res.text()).slice(0, 300) }, 502);
  }

  const rows = (await res.json()).filter((r) => r.email);

  const counts = rows.reduce((acc, r) => { acc[r.stage] = (acc[r.stage] || 0) + 1; return acc; }, {});

  // Stage 4 is the exit. Converted people leave the nurture sequence entirely —
  // nothing is more corrosive to trust than being sold something you bought.
  const toSync = rows.filter((r) => r.stage !== '4_converted');
  const exited = rows.filter((r) => r.stage === '4_converted');

  if (dryRun) {
    return json({ success: true, dryRun: true, total: rows.length, counts, wouldSync: toSync.length });
  }

  // --- push to Zoho -------------------------------------------------------
  const zohoReady = env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET && env.ZOHO_REFRESH_TOKEN && env.ZOHO_LIST_KEY;
  if (!zohoReady) {
    return json({ success: true, zoho: 'not_configured', total: rows.length, counts });
  }

  const accessToken = await getZohoAccessToken(env);
  if (!accessToken) return json({ success: false, error: 'zoho_auth_failed', counts }, 502);

  let synced = 0, failed = 0;

  // Sequential, not parallel. Zoho rate-limits hard and a burst of 400 parallel
  // requests gets the whole batch throttled rather than just the tail.
  for (const row of toSync) {
    const ok = await upsertZohoContact(accessToken, env.ZOHO_LIST_KEY, {
      'Contact Email':  row.email,
      'Funnel_Stage':   row.stage,
      'Days_In_Funnel': String(row.days_since_signup ?? 0),
    });
    ok ? synced++ : failed++;
  }

  // Mark converted contacts so the Zoho workflow can unsubscribe them from the
  // nurture series without deleting the contact record.
  let exitedMarked = 0;
  for (const row of exited) {
    const ok = await upsertZohoContact(accessToken, env.ZOHO_LIST_KEY, {
      'Contact Email': row.email,
      'Funnel_Stage':  '4_converted',
    });
    if (ok) exitedMarked++;
  }

  return json({ success: true, total: rows.length, counts, synced, failed, exitedMarked });
}

async function upsertZohoContact(accessToken, listKey, contact) {
  try {
    const params = new URLSearchParams({
      resfmt: 'JSON',
      listkey: listKey,
      contactinfo: JSON.stringify(contact),
    });
    const res = await fetch('https://campaigns.zoho.com/api/v1.1/json/listsubscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
      body: params.toString(),
    });
    return res.ok;
  } catch (_) { return false; }
}

async function getZohoAccessToken(env) {
  const params = new URLSearchParams({
    refresh_token: env.ZOHO_REFRESH_TOKEN,
    client_id:     env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    grant_type:    'refresh_token',
  });
  const res = await fetch(`https://accounts.zoho.com/oauth/v2/token?${params.toString()}`, { method: 'POST' });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}
