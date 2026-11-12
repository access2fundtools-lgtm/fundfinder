// Web Push (VAPID) for Cloudflare Workers, no npm packages.
// We send "tickle" pushes with no payload (no encryption needed); the service worker
// then fetches the message text from /api/push/latest. Works on Android Chrome and iOS 16.4+ (installed app).
// Env: VAPID_PUBLIC_KEY (base64url, 65-byte uncompressed P-256), VAPID_PRIVATE_JWK (JSON string), VAPID_SUBJECT (mailto: or https:)

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = (s) => b64u(new TextEncoder().encode(s));

let keyCache = null;
async function signingKey(env) {
  if (!keyCache) keyCache = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return keyCache;
}

export async function vapidHeader(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const header = b64uStr(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64uStr(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:dayo@myoneuphair.com' }));
  const unsigned = `${header}.${claims}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(env), new TextEncoder().encode(unsigned));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// Returns 'ok' | 'gone' (subscription expired, deactivate it) | 'error'
export async function sendTickle(env, endpoint) {
  try {
    const r = await fetch(endpoint, { method: 'POST', headers: { Authorization: await vapidHeader(env, endpoint), TTL: '86400', Urgency: 'normal', 'Content-Length': '0' } });
    if (r.status === 404 || r.status === 410) return 'gone';
    return r.ok ? 'ok' : 'error';
  } catch { return 'error'; }
}

export function isAdmin(request, env) {
  const got = request.headers.get('x-admin-key') || '';
  const want = env.ADMIN_PASSWORD || '';
  if (!want || got.length !== want.length) return false;
  let x = 0; for (let i = 0; i < want.length; i++) x |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return x === 0;
}
