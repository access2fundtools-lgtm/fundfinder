// TEMP diagnostic — remove after. Tests the Gemini call in isolation.
export async function onRequest(context) {
  const { env } = context;
  const key = env.GEMINI_API_KEY || '';
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const out = { keyLen: key.length, keyPrefix: key.slice(0, 6), model, hasServiceKey: !!env.SUPABASE_SERVICE_KEY };
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with just the word working' }] }], generationConfig: { maxOutputTokens: 50 } }),
    });
    out.status = r.status;
    out.bodyStart = (await r.text()).slice(0, 300);
  } catch (e) { out.fetchError = String((e && e.message) || e); }
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
}
