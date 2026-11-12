import { json, clean, paystackVerify, activate, welcomeMessage } from '../../_lib.js';

export async function onRequestGet({ request, env }) {
  const reference = clean(new URL(request.url).searchParams.get('reference'), 60);
  if (!reference) return json({ errors: ['Missing payment reference.'] }, 400);
  try {
    const ps = await paystackVerify(env, reference);
    const out = await activate(env, reference, ps);
    if (out.error) return json({ errors: [`${out.error}. If you were charged, message us on WhatsApp with your reference: ${reference}`] }, 402);
    const m = out.member, msg = welcomeMessage(m, env);
    return json({
      first_name: clean(m.full_name).split(' ')[0], reseller_code: m.reseller_code, track: m.track,
      whatsapp_join_url: `https://wa.me/${env.WHATSAPP_NUMBER || '2347031529244'}?text=${encodeURIComponent(msg)}`,
    });
  } catch (e) {
    console.error('verify', e.message);
    return json({ errors: ['We could not confirm your payment yet. Please refresh in a minute.'] }, 500);
  }
}
