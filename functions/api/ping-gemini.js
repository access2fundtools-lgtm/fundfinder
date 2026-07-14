// TEMP diagnostic — list Gemini models this key can use with generateContent
export async function onRequest(context) {
  const { env } = context;
  const key = env.GEMINI_API_KEY || '';
  const out = { keyLen: key.length, keyPrefix: key.slice(0, 6) };
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`);
    out.status = r.status;
    const d = await r.json();
    out.models = (d.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => (m.name || '').replace('models/', ''));
  } catch (e) { out.err = String((e && e.message) || e); }
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
}
