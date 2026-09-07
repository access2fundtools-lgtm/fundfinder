// FundFinder auto-responder — configuration and guardrails.
//
// Nothing secret lives in this file. Credentials come from environment
// variables only (see README.md). This repo is the public web root, so a
// token committed here would be world-readable.

// ---------------------------------------------------------------------------
// Buckets. A reply is sorted into exactly one.
//
// AUTO_SEND decides which buckets go out on their own. Everything else is
// written as a draft and emailed to ESCALATE_TO for a human to send.
// ---------------------------------------------------------------------------
export const BUCKETS = {
  NOT_REGISTERED: {
    autoSendable: true,
    goal:
      'They told us their business is not registered with CAC yet. Explain the ' +
      'Business Name vs Limited Company choice in plain terms, point them at the ' +
      'free Federal Government registration window, and ask the single question ' +
      'needed to move them forward.',
  },
  REGISTERED_NEEDS_QUALIFYING: {
    autoSendable: true,
    goal:
      'They are CAC-registered but we do not yet know enough to match them to ' +
      'funding. Ask the four qualifying questions, nothing else.',
  },
  QUALIFIED_READY_FOR_MATCHING: {
    autoSendable: false,
    goal: 'They have given enough detail to be matched. A human does the matching.',
  },
  PRICING_OR_SERVICE_QUESTION: {
    autoSendable: false,
    goal: 'They asked what something costs or what we do. Never guess at either.',
  },
  COMPLAINT_OR_SENSITIVE: {
    autoSendable: false,
    goal: 'Unhappy, confused, legal, or personal. Always a human.',
  },
  OTHER: {
    autoSendable: false,
    goal: 'Anything that does not clearly fit above.',
  },
};

export const AUTO_SEND_BUCKETS = (process.env.AUTO_SEND_BUCKETS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Below this, the classifier is not trusted and the reply is held regardless
// of bucket.
export const CONFIDENCE_FLOOR = Number(process.env.CONFIDENCE_FLOOR ?? 0.8);

// ---------------------------------------------------------------------------
// The four qualifying questions. Fixed wording — the model may not invent more.
// ---------------------------------------------------------------------------
export const QUALIFYING_QUESTIONS = [
  'What exactly does the business sell or do?',
  'Roughly what does it earn in a month? A range is fine.',
  'How much funding are you looking for, and what would you spend it on?',
  'Which state do you operate in?',
];

// ---------------------------------------------------------------------------
// Catalogue. The model may quote ONLY from here. Anything not listed must be
// escalated rather than priced.
//
// NOTE ON CAC REGISTRATION PRICING — read before adding a number here.
// The welcome email currently tells every new signup that the Federal
// Government is registering businesses with CAC completely FREE. Quoting a
// registration fee in the very next email would contradict that and read as a
// bait-and-switch. So NEW REGISTRATION is deliberately unpriced: the bot
// explains the Business Name vs Limited choice and points at the free window.
//
// ANNUAL RETURNS is different — those are real, published, statutory figures
// taken from CAC-Annual-Returns-Simple-Price-List.md (4 Aug 2026), and they
// apply to businesses that are already registered but in default.
// ---------------------------------------------------------------------------
export const CATALOGUE = {
  cacRegistration: {
    priced: false,
    note:
      'The Federal Government is currently running a free CAC registration ' +
      'window. Do not quote a registration fee. Explain the choice and point ' +
      'them at the free route.',
    businessName:
      'Business Name (also called an Enterprise). Simpler and faster. The ' +
      'business is not separate from you in law, so you carry its debts ' +
      'personally. Fine for a trading business, a shop, or a service you run ' +
      'yourself.',
    limitedCompany:
      'Private Limited Company (Ltd). A separate legal person from you, so ' +
      'your personal assets are protected. Most grants, investors and ' +
      'corporate buyers require this. Slightly more paperwork every year.',
    recommendation:
      'If they intend to chase grants, investment or corporate contracts, ' +
      'point them at Limited. Otherwise Business Name is enough to start.',
  },

  // Statutory CAC fees per year of default, plus the A2F service fee.
  // Source: CAC-Annual-Returns-Simple-Price-List.md, 4 August 2026.
  annualReturns: {
    priced: true,
    caveat:
      'These are indicative. Exact arrears must be confirmed on the CAC ' +
      'post-incorporation portal before any money changes hands.',
    businessName: [
      { yearsUnfiled: 1, cacFees: 5500, a2fFee: 10000, total: 15500 },
      { yearsUnfiled: 2, cacFees: 11000, a2fFee: 14000, total: 25000 },
      { yearsUnfiled: 3, cacFees: 16500, a2fFee: 18000, total: 34500 },
      { yearsUnfiled: 4, cacFees: 22000, a2fFee: 22000, total: 44000 },
      { yearsUnfiled: 5, cacFees: 27500, a2fFee: 26000, total: 53500 },
    ],
    limitedCompany: [
      { yearsUnfiled: 1, cacFees: 10000, a2fFee: 15000, total: 25000 },
      { yearsUnfiled: 2, cacFees: 20000, a2fFee: 21000, total: 41000 },
      { yearsUnfiled: 3, cacFees: 30000, a2fFee: 27000, total: 57000 },
      { yearsUnfiled: 4, cacFees: 40000, a2fFee: 33000, total: 73000 },
      { yearsUnfiled: 5, cacFees: 50000, a2fFee: 39000, total: 89000 },
    ],
    perYearNote:
      'The penalty is charged for EVERY year not filed, not once. Miss four ' +
      'years and you pay four penalties.',
  },

  // Left unpriced on purpose. Until a number is set here, the bot will not
  // mention this service at all — it escalates instead of guessing.
  applicationAssistance: {
    priced: false,
    note: 'No published price. Escalate any question about this to a human.',
  },
};

// ---------------------------------------------------------------------------
// Loop and abuse protection.
// ---------------------------------------------------------------------------
export const GUARDS = {
  // Never auto-reply to these — they are machines, and replying starts a loop.
  senderBlocklist: [
    /^mailer-daemon@/i,
    /^postmaster@/i,
    /^no-?reply@/i,
    /^do-?not-?reply@/i,
    /^bounce/i,
    /^notifications?@/i,
    /@a2fpartners\.com$/i, // never reply to ourselves
    /@fundfinder\.ng$/i,
  ],

  // Headers that mark a message as machine-generated.
  autoHeaders: [
    'auto-submitted', // RFC 3834 — anything but "no" means automated
    'x-autoreply',
    'x-autorespond',
    'x-auto-response-suppress',
  ],

  subjectBlocklist: [
    /^undelivered/i,
    /^delivery status/i,
    /^returned mail/i,
    /^out of office/i,
    /^automatic reply/i,
    /^auto(matic)?[- ]?response/i,
  ],

  maxAutoRepliesPerSenderPerDay: 2,

  // Only look at recent mail. Stops a first run from replying to months of
  // history all at once.
  lookbackDays: Number(process.env.LOOKBACK_DAYS ?? 7),

  // Hard ceiling on a single run, so a misconfiguration cannot mass-mail.
  maxMessagesPerRun: Number(process.env.MAX_PER_RUN ?? 25),
};

// IMAP keyword written onto a message once handled. This IS our state store —
// it lives on the mail server, so there is no local file holding anyone's
// email address, and a re-run cannot double-reply.
export const HANDLED_FLAG = 'ffresponded';

export const IDENTITY = {
  fromName: 'Dayo Akin',
  fromAddress: process.env.REPLY_FROM || 'alerts@a2fpartners.com',
  signature: 'Dayo Akin\nA2F Partners · fundfinder.ng',
};

// ---------------------------------------------------------------------------
// The rules the model must follow when writing. These are pasted verbatim into
// the system prompt.
// ---------------------------------------------------------------------------
export const HARD_RULES = `
NEVER do any of the following:
- Never invent a funding programme, a deadline, an amount, or an eligibility rule.
  If you are not certain, say you will check and let the message be escalated.
- Never quote a price that is not in the catalogue you were given.
- Never mention the application-assistance service at all — it has no published price.
- Never ask for CAC portal credentials, passwords, BVN, NIN, card or bank details.
- Never say or imply you are an AI, a bot, or automated. You are writing as Dayo Akin.
- Never promise funding, approval, a timeline, or a specific outcome.
- Never claim a business has been registered, filed, or approved.

ALWAYS:
- Write in plain English. Short sentences. Answer first, explain second.
- Spell out every abbreviation in brackets on every use, e.g. CAC (Corporate Affairs Commission).
- Sign off exactly as "Dayo Akin" — never the bare first name.
- Keep it under 200 words unless the catalogue table makes that impossible.
- Write as a person replying to a person, not as marketing copy.
`.trim();
