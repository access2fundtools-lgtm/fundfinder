import { json, clean, normalisePhone, sb, paystackInit } from '../../_lib.js';
const TRACKS = ['sell', 'install', 'both'];

export async function onRequestPost({ request, env }) {
  let b; try { b = await request.json(); } catch { return json({ errors: ['Invalid request.'] }, 400); }
  const full_name = clean(b.full_name, 80), whatsapp = normalisePhone(b.whatsapp), city_state = clean(b.city_state, 80);
  const track = TRACKS.includes(b.track) ? b.track : null;
  const errors = [];
  if (full_name.split(' ').length < 2) errors.push('Please enter your full name (first and last).');
  if (!whatsapp) errors.push('Please enter a valid Nigerian WhatsApp number, e.g. 0803 123 4567.');
  if (!city_state) errors.push('Please enter your city and state.');
  if (!track) errors.push('Please choose: Sell hair, Install hair, or Both.');
  if (b.consent !== true) errors.push('Please tick the consent box to continue.');
  if (errors.length) return json({ errors }, 400);
  try {
    const db = sb(env);
    const fee = Number(env.ACADEMY_FEE_KOBO || 1000000);
    const [existing] = await db.select('members', `whatsapp=eq.${whatsapp}&order=id.desc&limit=1&select=*`);
    if (existing && existing.status === 'active')
      return json({ errors: ['This WhatsApp number is already registered. Message us on WhatsApp and we will help you.'] }, 409);
    const fields = { full_name, city_state, track, selling_now: b.selling_now === 'yes' || b.selling_now === true,
      source: clean(b.source, 40) || null, consent_at: new Date().toISOString(), consent_version: 'privacy-2026-11' };
    const member = existing ? (await db.update('members', `id=eq.${existing.id}`, fields))[0]
                            : await db.insert('members', Object.assign({ whatsapp }, fields));
    const rand = crypto.getRandomValues(new Uint32Array(1))[0].toString(16);
    const reference = `OUA-${member.id}-${rand}`;
    await db.insert('payments', { member_id: member.id, reference, amount_kobo: fee });
    const site = (env.SITE_URL || 'https://myoneuphair.com').replace(/\/$/, '');
    const ps = await paystackInit(env, {
      email: `m${member.id}@members.myoneuphair.com`, amount: fee, currency: 'NGN', reference,
      callback_url: `${site}/welcome.html`,
      metadata: { member_id: member.id, purpose: 'academy_registration' },
    });
    return json({ authorization_url: ps.authorization_url, reference });
  } catch (e) {
    console.error('register', e.message);
    return json({ errors: ['Something went wrong starting your payment. Please try again or message us on WhatsApp.'] }, 500);
  }
}
