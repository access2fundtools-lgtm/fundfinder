// Called by the service worker after a push arrives: returns the newest message meant for this device.
import { json, sb } from '../../_lib.js';
export async function onRequestGet({ request, env }) {
  const endpoint = new URL(request.url).searchParams.get('endpoint') || '';
  const db = sb(env);
  const [sub] = endpoint ? await db.select('push_subscriptions', `endpoint=eq.${encodeURIComponent(endpoint)}&select=city_state,track`) : [];
  const since = new Date(Date.now() - 2 * 864e5).toISOString();
  const list = await db.select('notifications', `created_at=gte.${since}&order=id.desc&limit=20&select=title,body,url,target,target_value`);
  const fits = (n) => n.target === 'all' || !sub ? n.target === 'all' :
    n.target === 'city' ? (sub.city_state || '').toLowerCase().includes((n.target_value || '').toLowerCase()) :
    n.target === 'track' ? (sub.track === n.target_value || sub.track === 'both') : false;
  const n = list.find(fits) || { title: 'OneUp Academy', body: 'You have a new update.', url: '/' };
  return json({ title: n.title, body: n.body, url: n.url });
}
