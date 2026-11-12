import { paystackVerify, activate } from '../_lib.js';

async function hmac512(secret, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEq(a, b) { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }

export async function onRequestPost({ request, env, waitUntil }) {
  const raw = await request.text();
  const sig = request.headers.get('x-paystack-signature') || '';
  if (!safeEq(sig, await hmac512(env.PAYSTACK_SECRET_KEY, raw))) return new Response('bad signature', { status: 401 });
  let evt; try { evt = JSON.parse(raw); } catch { return new Response('ok'); }
  const ref = evt?.data?.reference;
  if (evt.event === 'charge.success' && ref && String(ref).startsWith('OUA-')) {
    const job = (async () => { try { await activate(env, ref, await paystackVerify(env, ref)); } catch (e) { console.error('webhook', e.message); } })();
    if (waitUntil) waitUntil(job); else await job;
  }
  return new Response('ok');
}
