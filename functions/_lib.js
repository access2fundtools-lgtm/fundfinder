// Shared helpers for OneUp Academy Cloudflare Pages Functions.
// Env (Cloudflare Pages → Settings → Variables & Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY (secret), PAYSTACK_SECRET_KEY (secret),
//   ACADEMY_FEE_KOBO (e.g. 1000000 = ₦10,000; change any time, never shown on the site),
//   SITE_URL (https://myoneuphair.com), WHATSAPP_NUMBER (2347031529244)

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const clean = (s, max = 120) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

export function normalisePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (/^0\d{10}$/.test(d)) return '234' + d.slice(1);
  if (/^234\d{10}$/.test(d)) return d;
  return null;
}

export function makeResellerCode(fullName) {
  const first = clean(fullName).split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '');
  const stem = (first + 'XXXX').slice(0, 4);
  const n = 100 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900);
  return `OU-${stem}${n}`;
}

// Minimal Supabase REST (PostgREST) client using the service key (server-side only)
export function sb(env) {
  const base = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  const h = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Accept-Profile': 'academy', 'Content-Profile': 'academy' };
  async function call(method, path, body, prefer) {
    const r = await fetch(base + path, { method, headers: Object.assign({}, h, prefer ? { Prefer: prefer } : {}), body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) { const e = new Error(`supabase ${r.status}: ${text}`); e.status = r.status; e.data = data; throw e; }
    return data;
  }
  return {
    select: (table, query) => call('GET', `/${table}?${query}`),
    insert: (table, row) => call('POST', `/${table}`, row, 'return=representation').then(a => a[0]),
    update: (table, query, patch) => call('PATCH', `/${table}?${query}`, patch, 'return=representation'),
  };
}

export async function paystackVerify(env, reference) {
  const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` } });
  const j = await r.json(); if (!j.status) throw new Error(j.message || 'Paystack verify failed'); return j.data;
}
export async function paystackInit(env, body) {
  const r = await fetch('https://api.paystack.co/transaction/initialize', { method: 'POST', headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.status) throw new Error(j.message || 'Paystack initialize failed'); return j.data;
}

// Idempotent: mark payment paid, activate member, assign reseller code
export async function activate(env, reference, ps) {
  const db = sb(env);
  const [p] = await db.select('payments', `reference=eq.${encodeURIComponent(reference)}&select=*`);
  if (!p) return { error: 'Unknown payment reference' };
  const ok = ps && ps.status === 'success' && Number(ps.amount) >= p.amount_kobo && ps.currency === 'NGN';
  if (!ok) return { error: 'Payment not completed' };
  if (p.status !== 'success') await db.update('payments', `id=eq.${p.id}`, { status: 'success', paid_at: new Date().toISOString(), paystack_raw: ps });
  let [m] = await db.select('members', `id=eq.${p.member_id}&select=*`);
  for (let i = 0; i < 8 && !m.reseller_code; i++) {
    try {
      const rows = await db.update('members', `id=eq.${m.id}&reseller_code=is.null`, { status: 'active', activated_at: new Date().toISOString(), reseller_code: makeResellerCode(m.full_name) });
      [m] = rows.length ? rows : await db.select('members', `id=eq.${p.member_id}&select=*`);
    } catch (e) { if (e.status !== 409) throw e; }
  }
  return { member: m };
}

export function welcomeMessage(m, env) {
  const first = clean(m.full_name).split(' ')[0];
  return [
    `Hi OneUp! I'm ${first} and I just joined the DO IT! Academy.`,
    `My reseller code is ${m.reseller_code}.`,
    `City: ${m.city_state}. I want to: ${({ sell: 'sell hair', install: 'install hair', both: 'sell and install hair' })[m.track]}.`,
    `Please add me to the academy group and send me the wholesale catalogue.`,
  ].join('\n');
}
