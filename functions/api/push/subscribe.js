import { json, clean, sb } from '../../_lib.js';
export async function onRequestPost({ request, env }) {
  let b; try { b = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const s = b.subscription || {};
  if (!s.endpoint || !/^https:\/\//.test(s.endpoint)) return json({ error: 'invalid subscription' }, 400);
  const db = sb(env);
  let member = null;
  const code = clean(b.reseller_code, 20).toUpperCase();
  if (code) [member] = await db.select('members', `reseller_code=eq.${encodeURIComponent(code)}&select=id,city_state,track`);
  const row = { endpoint: s.endpoint, p256dh: s.keys?.p256dh || null, auth: s.keys?.auth || null, active: true,
    member_id: member?.id || null, city_state: member?.city_state || clean(b.city_state, 80) || null,
    track: member?.track || null, user_agent: clean(request.headers.get('user-agent'), 200) };
  const [existing] = await db.select('push_subscriptions', `endpoint=eq.${encodeURIComponent(s.endpoint)}&select=id`);
  if (existing) await db.update('push_subscriptions', `id=eq.${existing.id}`, row); else await db.insert('push_subscriptions', row);
  return json({ ok: true });
}
