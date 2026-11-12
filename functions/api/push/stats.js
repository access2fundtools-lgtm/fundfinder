import { json, sb } from '../../_lib.js';
import { isAdmin } from '../../_push.js';
export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Wrong admin password.' }, 401);
  const db = sb(env);
  const subs = await db.select('push_subscriptions', 'active=eq.true&select=city_state,track&limit=10000');
  const recent = await db.select('notifications', 'order=id.desc&limit=10&select=title,target,target_value,sent_count,failed_count,created_at');
  return json({ active_devices: subs.length, recent });
}
