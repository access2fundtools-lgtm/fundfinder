// TEMP diagnostic: compare a tiny Gemini call vs the exact "main" request
export async function onRequest(context) {
  const { env } = context;
  const key = env.GEMINI_API_KEY || '';
  const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const out = { model };
  async function call(label, bodyObj) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) });
      const t = await r.text();
      out[label] = { status: r.status, ms: Date.now() - t0, len: t.length, start: t.slice(0, 120) };
    } catch (e) { out[label] = { err: String((e && e.message) || e), ms: Date.now() - t0 }; }
  }
  await call('tiny', { contents: [{ role: 'user', parts: [{ text: 'Say working' }] }], generationConfig: { maxOutputTokens: 50 } });
  await call('full', {
    system_instruction: { parts: [{ text: 'You are FundFinder AI, a funding assistant for Nigerian entrepreneurs. Be warm and specific.' }] },
    contents: [{ role: 'user', parts: [{ text: 'In one short sentence, greet me and confirm you are working.' }] }],
    generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
  });
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
}
