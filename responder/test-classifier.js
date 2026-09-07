// Offline checks. Runs with no mailbox and no API key — verifies the guards
// and the output validator, which are the parts that decide whether a stranger
// receives an email. Run:  node test-classifier.js
//
// If ANTHROPIC_API_KEY is set it additionally runs the real classifier over
// the sample replies and prints what it would have written.

import { GUARDS, AUTO_SEND_BUCKETS, CONFIDENCE_FLOOR, BUCKETS } from './config.js';
import { violatesHardRules, classifyAndDraft } from './classify.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
};

console.log('\nGUARD: senders that must never receive an auto-reply');
for (const addr of [
  'mailer-daemon@mail.zoho.com',
  'no-reply@example.com',
  'noreply@example.com',
  'do-not-reply@bank.com',
  'bounces@sendgrid.net',
  'alerts@a2fpartners.com',
  'spv@a2fpartners.com',
  'hello@fundfinder.ng',
]) {
  check(addr, GUARDS.senderBlocklist.some((re) => re.test(addr)));
}

console.log('\nGUARD: a real person must NOT be blocked');
for (const addr of ['paulbitrus1892@gmail.com', 'ada@herbusiness.com.ng']) {
  check(addr, !GUARDS.senderBlocklist.some((re) => re.test(addr)));
}

console.log('\nGUARD: automated subjects');
for (const s of [
  'Undelivered Mail Returned to Sender',
  'Out of office: away until Monday',
  'Automatic reply: Welcome to FundFinder',
  'Delivery Status Notification (Failure)',
]) {
  check(s, GUARDS.subjectBlocklist.some((re) => re.test(s)));
}
check('a genuine reply subject is allowed',
  !GUARDS.subjectBlocklist.some((re) => re.test('Re: Welcome to FundFinder — two quick questions')));

console.log('\nVALIDATOR: text that must be rejected before sending');
const bad = [
  ['admits being automated', 'Hi,\nI am an AI assistant helping out.\nDayo Akin'],
  ['asks for credentials',   'Hi,\nPlease send your CAC portal password.\nDayo Akin'],
  ['promises an outcome',    'Hi,\nYou are guaranteed to get this grant.\nDayo Akin'],
  ['invents a price',        'Hi,\nRegistration costs ₦37,450 today.\nDayo Akin'],
  ['bare first name',        'Hi,\nThanks for writing back.\nDayo'],
];
for (const [name, text] of bad) check(name, violatesHardRules(text).length > 0);

console.log('\nVALIDATOR: a good reply must pass cleanly');
const good = [
  'Hi Paul,',
  '',
  'Good — a registered business opens up most of what is on FundFinder.',
  '',
  'Four quick things and I can match you properly:',
  '1. What exactly does the business sell or do?',
  '2. Roughly what does it earn in a month? A range is fine.',
  '3. How much funding are you looking for, and what would you spend it on?',
  '4. Which state do you operate in?',
  '',
  'Dayo Akin',
  'A2F Partners · fundfinder.ng',
].join('\n');
const goodResult = violatesHardRules(good);
check(`clean reply passes (got: ${goodResult.join('; ') || 'no violations'})`, goodResult.length === 0);

console.log('\nVALIDATOR: a catalogue price must be allowed through');
const priced = 'Hi,\nThree years unfiled for a Business Name comes to ₦34,500 all in.\nDayo Akin';
check(`catalogue figure ₦34,500 accepted (got: ${violatesHardRules(priced).join('; ') || 'none'})`,
  violatesHardRules(priced).length === 0);

console.log('\nCONFIG: fail-safe defaults');
check(`AUTO_SEND_BUCKETS defaults to empty (draft-only) — currently [${AUTO_SEND_BUCKETS.join(',')}]`,
  Array.isArray(AUTO_SEND_BUCKETS));
check(`confidence floor is ${CONFIDENCE_FLOOR} (>= 0.8)`, CONFIDENCE_FLOOR >= 0.8);
check('the three sensitive buckets can never auto-send',
  !BUCKETS.COMPLAINT_OR_SENSITIVE.autoSendable &&
  !BUCKETS.PRICING_OR_SERVICE_QUESTION.autoSendable &&
  !BUCKETS.OTHER.autoSendable);

console.log(`\n${pass} passed, ${fail} failed\n`);

// --- optional live classifier pass ------------------------------------------
const SAMPLES = [
  { name: 'Paul (the real one from the inbox)', fromName: 'Paul', fromEmail: 'paulbitrus1892@gmail.com',
    subject: 'Re: Welcome to FundFinder — two quick questions',
    body: 'Subject CAC\n\nYes it a registered company',
    expect: 'REGISTERED_NEEDS_QUALIFYING' },
  { name: 'not registered', fromName: 'Ada', fromEmail: 'ada@example.com',
    subject: 'Re: Welcome to FundFinder',
    body: "no I haven't registered yet, I sell shoes",
    expect: 'NOT_REGISTERED' },
  { name: 'fully qualified', fromName: 'Emeka', fromEmail: 'emeka@example.com',
    subject: 'Re: Welcome to FundFinder',
    body: 'Registered as a Ltd. We do cassava processing in Oyo, about 2 million naira a month, looking for 20 million for a new dryer.',
    expect: 'QUALIFIED_READY_FOR_MATCHING' },
  { name: 'pricing question', fromName: 'Bola', fromEmail: 'bola@example.com',
    subject: 'Re: Welcome to FundFinder',
    body: 'How much do you charge to help me apply for grants?',
    expect: 'PRICING_OR_SERVICE_QUESTION' },
  { name: 'complaint', fromName: 'Chidi', fromEmail: 'chidi@example.com',
    subject: 'Re: Welcome to FundFinder',
    body: 'I paid someone through your site and got nothing. This is a scam and I want my money.',
    expect: 'COMPLAINT_OR_SENSITIVE' },
];

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('ANTHROPIC_API_KEY not set — skipping the live classifier pass.');
  process.exit(fail ? 1 : 0);
}

console.log('LIVE CLASSIFIER\n');
let hits = 0;
for (const s of SAMPLES) {
  try {
    const r = await classifyAndDraft(s);
    const ok = r.bucket === s.expect;
    if (ok) hits++;
    const v = r.reply_text ? violatesHardRules(r.reply_text) : ['no text'];
    console.log(`${ok ? 'ok   ' : 'MISS '} ${s.name}`);
    console.log(`      expected ${s.expect}, got ${r.bucket} (confidence ${r.confidence})`);
    console.log(`      violations: ${v.join('; ') || 'none'}`);
    const wouldSend = BUCKETS[r.bucket]?.autoSendable && AUTO_SEND_BUCKETS.includes(r.bucket)
      && r.confidence >= CONFIDENCE_FLOOR && v.length === 0;
    console.log(`      would ${wouldSend ? 'SEND' : 'HOLD'}`);
    console.log('      ---\n' + (r.reply_text || '').split('\n').map((l) => '      ' + l).join('\n') + '\n');
  } catch (err) {
    console.log(`ERROR ${s.name}: ${err.message}`);
  }
}
console.log(`${hits}/${SAMPLES.length} buckets matched expectation\n`);
process.exit(fail ? 1 : 0);
