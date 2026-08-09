// FundFinder AI — Signup notification endpoint (Cloudflare Pages Function)
// Path: /api/notify-signup   (file: functions/api/notify-signup.js)
//
// Fires an email to the operator every time someone enters the funnel, and
// makes sure the contact lands in Zoho Campaigns so the nurture sequence can
// pick them up.
//
// Two callers:
//   1. Supabase trigger on auth.users  → real account signups (see
//      supabase-migration-2026-08-03-signup-notify.sql). Sends {type:'account'}.
//   2. functions/api/subscribe.js      → newsletter email capture.
//      Sends {type:'newsletter'}.
//
// Auth: every call must present  Authorization: Bearer <NOTIFY_SECRET>.
// Without it the endpoint 401s — otherwise anyone could spam the inbox.
//
// Email provider: whichever is configured, checked in this order.
//   RESEND_API_KEY          → Resend        (resend.com, 3k emails/mo free)
//   ZEPTOMAIL_TOKEN         → Zoho ZeptoMail (same vendor as Campaigns)
// If neither is set the function still returns 200 and records nothing —
// safe to deploy before the provider is chosen.
//
// Cloudflare env vars:
//   NOTIFY_SECRET        — shared secret, must match the Supabase trigger
//   NOTIFY_TO            — operator inbox (default access2fundtools@gmail.com)
//   NOTIFY_FROM          — verified sender, e.g. alerts@fundfinder.ng
//   RESEND_API_KEY       — optional
//   ZEPTOMAIL_TOKEN      — optional (Zoho ZeptoMail "Send Mail Token")
//   ZOHO_*               — optional, same four vars subscribe.js already uses

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function onRequestPost(context) {
  try { return await handleNotify(context); }
  catch (err) {
    // Never surface a 500 to the Supabase trigger — a failed notification must
    // not look like a failed signup. Log the shape, return 200.
    return json({ success: false, error: 'server_error', message: String((err && err.message) || err) }, 200);
  }
}

async function handleNotify(context) {
  const { request, env } = context;

  // --- auth ---------------------------------------------------------------
  const auth = request.headers.get('Authorization') || '';
  const presented = auth.replace(/^Bearer\s+/i, '').trim();
  if (!env.NOTIFY_SECRET || presented !== env.NOTIFY_SECRET) {
    return json({ success: false, error: 'unauthorized' }, 401);
  }

  let body = {};
  try { body = await request.json(); } catch { /* tolerate empty body */ }

  const type    = (body.type || 'unknown').slice(0, 24);      // account | newsletter | jv | application
  const email   = (body.email || '').trim().toLowerCase().slice(0, 200);
  const name    = (body.name || '').trim().slice(0, 120);
  const phone   = (body.phone || '').trim().slice(0, 40);
  const source  = (body.source || '').trim().slice(0, 60);
  const userId  = (body.user_id || '').trim().slice(0, 64);

  if (!email) return json({ success: false, error: 'missing_email' }, 400);

  const label = {
    account:    'New account signup',
    newsletter: 'New email lead',
    jv:         'New JV / SPV interest',
    application:'New programme application',
  }[type] || 'New funnel entry';

  // --- 1. notify the operator --------------------------------------------
  const to   = env.NOTIFY_TO   || 'access2fundtools@gmail.com';
  const from = env.NOTIFY_FROM || 'alerts@fundfinder.ng';

  const rows = [
    ['Email',  email],
    ['Name',   name],
    ['Phone',  phone],
    ['Source', source],
    ['Type',   type],
    ['User ID', userId],
  ].filter(([, v]) => v);

  const subject = `${label} — ${email}`;
  const text = [
    label,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Admin: https://fundfinder.ng/admin.html',
  ].join('\n');

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px">
      <h2 style="margin:0 0 4px;font-size:18px;color:#0b1f1c">${esc(label)}</h2>
      <p style="margin:0 0 16px;color:#5b6b66;font-size:13px">FundFinder AI · ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        ${rows.map(([k, v]) => `
          <tr>
            <td style="padding:6px 12px 6px 0;color:#5b6b66;white-space:nowrap;vertical-align:top">${esc(k)}</td>
            <td style="padding:6px 0;color:#0b1f1c"><strong>${esc(v)}</strong></td>
          </tr>`).join('')}
      </table>
      <p style="margin:20px 0 0">
        <a href="https://fundfinder.ng/admin.html"
           style="background:#ffd100;color:#08140f;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px">
          Open admin
        </a>
      </p>
    </div>`;

  const emailed = await sendEmail(env, { to, from, subject, text, html });

  // --- 2. make sure they're in Zoho so the sequence can reach them ---------
  // subscribe.js already does this for newsletter signups; account signups
  // never reached Zoho at all before this endpoint existed.
  let zohoOk = false;
  let zohoDetail = null;
  if (type === 'account') {
    const z = await pushToZoho(env, { email, name, phone });
    zohoOk = !!(z && z.ok);
    if (!zohoOk && z) zohoDetail = { status: z.status, code: z.code, message: z.message };
  }

  return json({ success: true, emailed, zoho: zohoOk, zoho_detail: zohoDetail });
}

// ---------------------------------------------------------------------------
// Email providers. Cloudflare Pages Functions can't open raw SMTP sockets, so
// both options here are HTTPS APIs.
// ---------------------------------------------------------------------------
async function sendEmail(env, { to, from, subject, text, html }) {
  if (env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to: [to], subject, text, html }),
      });
      if (res.ok) return 'resend';
    } catch (_) { /* fall through to next provider */ }
  }

  if (env.ZEPTOMAIL_TOKEN) {
    try {
      const res = await fetch('https://api.zeptomail.com/v1.1/email', {
        method: 'POST',
        headers: {
          Authorization: env.ZEPTOMAIL_TOKEN,   // ZeptoMail sends the token raw, no "Bearer"
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: { address: from, name: 'FundFinder AI' },
          to: [{ email_address: { address: to } }],
          subject,
          textbody: text,
          htmlbody: html,
        }),
      });
      if (res.ok) return 'zeptomail';
    } catch (_) { /* no provider left */ }
  }

  return false;   // nothing configured yet — deploy-safe, not an error
}

// ---------------------------------------------------------------------------
// Zoho Campaigns — same listsubscribe upsert subscribe.js uses. Writing the
// Funnel_Stage field here seeds the contact at stage 1 so the tiered sequence
// starts immediately rather than waiting for the next funnel-sync run.
// ---------------------------------------------------------------------------
async function pushToZoho(env, { email, name, phone }) {
  const { ZOHO_CLIENT_ID: clientId, ZOHO_CLIENT_SECRET: clientSecret,
          ZOHO_REFRESH_TOKEN: refreshToken, ZOHO_LIST_KEY: listKey } = env;
  if (!clientId || !clientSecret || !refreshToken || !listKey) return false;

  try {
    const accessToken = await getZohoAccessToken({ clientId, clientSecret, refreshToken });
    if (!accessToken) return false;

    const contact = { 'Contact Email': email, 'Funnel_Stage': '1_account_no_profile' };
    if (name)  contact['First Name'] = name;
    if (phone) contact['Phone'] = phone;

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

    // Zoho Campaigns answers HTTP 200 even when it rejects the contact — the
    // real outcome is in the body. Checking res.ok alone reports success for
    // failures (bad list key, unknown custom field, unconfirmed opt-in).
    const raw = await res.text();
    let data = {};
    try { data = JSON.parse(raw); } catch (_) { /* non-JSON = treat as failure */ }
    const ok = res.ok && String(data.status || '').toLowerCase() === 'success';
    return { ok, status: data.status || null, code: data.code || null,
             message: data.message || (ok ? null : raw.slice(0, 200)) };
  } catch (err) { return { ok: false, status: 'exception', code: null,
                           message: String((err && err.message) || err).slice(0, 200) }; }
}

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
