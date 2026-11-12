// Admin only: create a notification and push it to everyone / a city / a track.
import { json, clean, sb } from '../../_lib.js';
import { isAdmin, sendTickle } from '../../_push.js';
export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Wrong admin password.' }, 401);
  let b; try { b = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const title = clean(b.title, 60), body = clean(b.body, 180);
  let url = clean(b.url, 300) || '/'; if (!/^(\/|https:\/\/)/.test(url)) url = '/';
  const target = ['all', 'city', 'track'].includes(b.target) ? b.target : 'all';
  const target_value = target === 'all' ? null : clean(b.target_value, 60);
  if (!title || !body) return json({ error: 'Title and message are required.' }, 400);
  if (target !== 'all' && !target_value) return json({ error: 'Choose the city or track.' }, 400);
  const db = sb(env);
  const note = await db.insert('notifications', { title, body, url, target, target_value });
  let q = 'active=eq.true&select=id,endpoint';
  if (target === 'city') q += `&city_state=ilike.*${encodeURIComponent(target_value)}*`;
  if (target === 'track') q += `&track=in.(${encodeURIComponent(target_value)},both)`;
  const subs = await db.select('push_subscriptions', q + '&limit=5000');
  let sent = 0, failed = 0; const gone = [];
  for (let i = 0; i < subs.length; i += 50) {
    const res = await Promise.all(subs.slice(i, i + 50).map(s => sendTickle(env, s.endpoint).then(r => [s, r])));
    for (const [s, r] of res) { if (r === 'ok') sent++; else { failed++; if (r === 'gone') gone.push(s.id); } }
  }
  if (gone.length) await db.update('push_subscriptions', `id=in.(${gone.join(',')})`, { active: false });
  await db.update('notifications', `id=eq.${note.id}`, { sent_count: sent, failed_count: failed });
  return json({ ok: true, targeted: subs.length, sent, failed, expired_removed: gone.length });
}
