// FundFinder auto-responder — main loop.
//
// Reads replies to the FundFinder welcome email out of Zoho over IMAP,
// classifies each one, and either sends the reply itself or holds it as a
// draft for a human.
//
// Runs either way:
//   node index.js              — one pass, then exit  (GitHub Actions cron)
//   node index.js --loop       — forever, every POLL_MINUTES  (Railway/VPS)
//   node index.js --dry-run    — classify and print, send nothing
//
// State lives on the mail server as an IMAP keyword, not in a local file, so
// nobody's email address is ever written to disk in this repo.

import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import {
  BUCKETS, AUTO_SEND_BUCKETS, CONFIDENCE_FLOOR,
  GUARDS, HANDLED_FLAG, IDENTITY,
} from './config.js';
import { classifyAndDraft, violatesHardRules } from './classify.js';

const DRY_RUN = process.argv.includes('--dry-run');
const LOOP = process.argv.includes('--loop');
const POLL_MINUTES = Number(process.env.POLL_MINUTES ?? 5);

const need = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
};

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------------------------------------------------------------------------
// Guards. Every one of these returns a reason string, or null to proceed.
// ---------------------------------------------------------------------------
function blockReason(msg, sentToday) {
  const from = (msg.fromEmail || '').toLowerCase();

  for (const re of GUARDS.senderBlocklist) {
    if (re.test(from)) return `sender matches blocklist (${re})`;
  }
  for (const re of GUARDS.subjectBlocklist) {
    if (re.test(msg.subject || '')) return `subject looks automated (${re})`;
  }
  for (const h of GUARDS.autoHeaders) {
    const v = msg.headers?.get?.(h);
    if (v && String(v).toLowerCase() !== 'no') return `carries ${h}: ${v}`;
  }
  if ((sentToday.get(from) || 0) >= GUARDS.maxAutoRepliesPerSenderPerDay) {
    return `already sent ${GUARDS.maxAutoRepliesPerSenderPerDay} replies to this sender today`;
  }
  if (!msg.body || msg.body.trim().length < 2) return 'empty body';
  return null;
}

// Strip the quoted original so the classifier reads only what they wrote.
function stripQuoted(text) {
  if (!text) return '';
  const cut = text.search(
    /(^On .+ wrote:$)|(^-{2,}\s*Original Message)|(^_{5,})|(^From:\s)/m
  );
  return (cut > 0 ? text.slice(0, cut) : text).trim();
}

async function makeMailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.zoho.com',
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: { user: need('ZOHO_USER'), pass: need('ZOHO_APP_PASSWORD') },
  });
}

async function runOnce() {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST || 'imap.zoho.com',
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: true,
    auth: { user: need('ZOHO_USER'), pass: need('ZOHO_APP_PASSWORD') },
    logger: false,
  });

  const mailer = await makeMailer();
  const escalateTo = need('ESCALATE_TO');
  const stats = { seen: 0, skipped: 0, sent: 0, held: 0, errors: 0 };
  const sentToday = new Map();

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');

  try {
    const since = new Date(Date.now() - GUARDS.lookbackDays * 86400_000);
    const uids = await client.search({ since }, { uid: true });
    const candidates = (uids || []).slice(-GUARDS.maxMessagesPerRun);
    log(`found ${uids?.length || 0} message(s) since ${since.toISOString().slice(0, 10)}, examining ${candidates.length}`);

    for (const uid of candidates) {
      let msg;
      try {
        const raw = await client.fetchOne(String(uid), { source: true, flags: true }, { uid: true });
        if (!raw) continue;

        // Already handled on a previous run.
        if (raw.flags?.has?.(HANDLED_FLAG)) { stats.skipped++; continue; }

        const parsed = await simpleParser(raw.source);
        msg = {
          uid,
          fromEmail: parsed.from?.value?.[0]?.address || '',
          fromName: parsed.from?.value?.[0]?.name || '',
          subject: parsed.subject || '',
          messageId: parsed.messageId || '',
          references: parsed.references || [],
          headers: parsed.headers,
          body: stripQuoted(parsed.text || ''),
        };
      } catch (err) {
        stats.errors++; log(`uid ${uid}: parse failed —`, err.message); continue;
      }

      stats.seen++;
      const blocked = blockReason(msg, sentToday);
      if (blocked) {
        log(`uid ${uid} <${msg.fromEmail}>: SKIP — ${blocked}`);
        stats.skipped++;
        if (!DRY_RUN) await client.messageFlagsAdd(String(uid), [HANDLED_FLAG], { uid: true });
        continue;
      }

      let result;
      try {
        result = await classifyAndDraft(msg);
      } catch (err) {
        stats.errors++; log(`uid ${uid}: classifier failed —`, err.message); continue;
      }

      const violations = result.reply_text ? violatesHardRules(result.reply_text) : ['no reply text'];
      const bucketOk = BUCKETS[result.bucket]?.autoSendable && AUTO_SEND_BUCKETS.includes(result.bucket);
      const confidenceOk = result.confidence >= CONFIDENCE_FLOOR;
      const autoSend = bucketOk && confidenceOk && violations.length === 0;

      const why = !bucketOk
        ? (BUCKETS[result.bucket]?.autoSendable ? 'bucket not enabled for auto-send' : 'bucket is always held')
        : !confidenceOk ? `confidence ${result.confidence} below ${CONFIDENCE_FLOOR}`
        : violations.length ? `rule violations: ${violations.join('; ')}`
        : '';

      log(`uid ${uid} <${msg.fromEmail}>: ${result.bucket} conf=${result.confidence} → ${autoSend ? 'SEND' : `HOLD (${why})`}`);

      if (DRY_RUN) {
        console.log('--- would send ---\n' + result.reply_text + '\n------------------');
        continue;
      }

      try {
        if (autoSend) {
          await mailer.sendMail({
            from: `"${IDENTITY.fromName}" <${IDENTITY.fromAddress}>`,
            to: msg.fromEmail,
            subject: /^re:/i.test(msg.subject) ? msg.subject : `Re: ${msg.subject}`,
            text: result.reply_text,
            // Threading — makes the reply attach to their message in their client.
            inReplyTo: msg.messageId,
            references: [...(msg.references || []), msg.messageId].filter(Boolean),
          });
          sentToday.set(msg.fromEmail.toLowerCase(), (sentToday.get(msg.fromEmail.toLowerCase()) || 0) + 1);
          stats.sent++;
        } else {
          await mailer.sendMail({
            from: `"FundFinder responder" <${IDENTITY.fromAddress}>`,
            to: escalateTo,
            subject: `[HELD · ${result.bucket}] ${msg.fromName || msg.fromEmail} — ${msg.subject}`,
            text: [
              `Held rather than sent. Reason: ${why}`,
              `Bucket: ${result.bucket}   Confidence: ${result.confidence}`,
              `Classifier note: ${result.reasoning}`,
              '',
              `From: ${msg.fromName} <${msg.fromEmail}>`,
              `Subject: ${msg.subject}`,
              '',
              'THEY WROTE:',
              msg.body,
              '',
              '================ DRAFT REPLY — read it, then send it yourself ================',
              result.reply_text || '(none generated)',
            ].join('\n'),
          });
          stats.held++;
        }
        await client.messageFlagsAdd(String(uid), [HANDLED_FLAG], { uid: true });
      } catch (err) {
        stats.errors++; log(`uid ${uid}: send failed —`, err.message);
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }

  log(`run complete — examined ${stats.seen}, sent ${stats.sent}, held ${stats.held}, skipped ${stats.skipped}, errors ${stats.errors}`);
  return stats;
}

async function main() {
  log(`FundFinder responder up · auto-send=[${AUTO_SEND_BUCKETS.join(',') || 'none — draft-only mode'}] · dry-run=${DRY_RUN}`);
  if (!LOOP) { await runOnce(); return; }
  for (;;) {
    try { await runOnce(); } catch (err) { console.error('run failed:', err.message); }
    await new Promise((r) => setTimeout(r, POLL_MINUTES * 60_000));
  }
}

main().catch((err) => { console.error('fatal:', err.message); process.exit(1); });
