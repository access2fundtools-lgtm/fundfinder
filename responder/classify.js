// Classification + drafting. One Claude call per message returns both the
// bucket and the written reply, so the reply is always generated under the
// same constraints the bucket was chosen under.

import { BUCKETS, CATALOGUE, QUALIFYING_QUESTIONS, HARD_RULES, IDENTITY } from './config.js';

const API = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

function systemPrompt() {
  const bucketList = Object.entries(BUCKETS)
    .map(([name, b]) => `- ${name}: ${b.goal}`)
    .join('\n');

  return `You are writing email replies as Dayo Akin of A2F Partners, who runs FundFinder
(fundfinder.ng) — a platform that helps Nigerian businesses find funding they
qualify for.

Everyone you are replying to signed up on FundFinder and received a welcome
email asking two questions: whether their business is registered with CAC
(Corporate Affairs Commission), and what the business does. You are reading
their answer.

Sort each reply into exactly one bucket:
${bucketList}

Then write the reply that bucket calls for.

${HARD_RULES}

THE FOUR QUALIFYING QUESTIONS (use this exact wording, and only these four):
${QUALIFYING_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join('\n')}

CATALOGUE — the only facts and figures you may state:
${JSON.stringify(CATALOGUE, null, 2)}

Sign off exactly:
${IDENTITY.signature}

Return ONLY a JSON object, no prose around it, no markdown fence:
{
  "bucket": "<one bucket name>",
  "confidence": <number 0 to 1>,
  "reasoning": "<one sentence — why this bucket>",
  "reply_text": "<the full plain-text email body, greeting to sign-off>"
}

Set confidence below 0.8 whenever you are unsure, the message is ambiguous,
it mixes several requests, it is in a language you cannot read confidently,
or answering well would need a fact you do not have.`;
}

export async function classifyAndDraft({ fromName, fromEmail, subject, body }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');

  const userContent = [
    `From: ${fromName || '(no name)'} <${fromEmail}>`,
    `Subject: ${subject || '(no subject)'}`,
    '',
    'Their message:',
    '---',
    (body || '').slice(0, 6000),
    '---',
  ].join('\n');

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      temperature: 0.2,
      system: systemPrompt(),
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = (data.content || []).map((c) => c.text || '').join('').trim();

  let parsed;
  try {
    // Tolerate a stray code fence even though we asked for none.
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      bucket: 'OTHER',
      confidence: 0,
      reasoning: 'Classifier returned unparseable output — held for a human.',
      reply_text: '',
      raw,
    };
  }

  // Never trust a bucket name we do not recognise.
  if (!BUCKETS[parsed.bucket]) {
    return {
      bucket: 'OTHER',
      confidence: 0,
      reasoning: `Unknown bucket "${parsed.bucket}" — held for a human.`,
      reply_text: parsed.reply_text || '',
    };
  }

  const conf = Number(parsed.confidence);
  return {
    bucket: parsed.bucket,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0,
    reasoning: String(parsed.reasoning || '').slice(0, 400),
    reply_text: String(parsed.reply_text || ''),
  };
}

// Belt-and-braces check on the generated text. The prompt forbids these, but a
// prompt is not a guarantee, so we verify before anything is sent.
const FORBIDDEN = [
  { re: /\b(as an )?(AI|artificial intelligence|language model|chatbot|automated system)\b/i, why: 'claims to be automated' },
  { re: /\b(password|BVN|NIN|card number|CVV|OTP|one[- ]time password)\b/i, why: 'asks for credentials' },
  { re: /\bguarantee(d)?\b/i, why: 'promises an outcome' },
  { re: /\byou (will|are) (definitely |certainly )?(get|receive|be awarded)\b/i, why: 'promises funding' },
];

export function violatesHardRules(text) {
  const found = [];
  for (const f of FORBIDDEN) if (f.re.test(text)) found.push(f.why);

  // Any naira figure in the text must exist in the catalogue.
  const cat = JSON.stringify(CATALOGUE);
  const figures = text.match(/₦\s?[\d,]{3,}/g) || [];
  for (const fig of figures) {
    const digits = fig.replace(/[^\d]/g, '');
    if (digits && !cat.includes(digits)) found.push(`quotes an off-catalogue figure (${fig})`);
  }

  if (!/Dayo Akin/.test(text)) found.push('missing the full-name sign-off');
  return found;
}
