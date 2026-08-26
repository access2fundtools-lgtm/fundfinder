#!/usr/bin/env node
/**
 * gen-ticker.js — build data/ticker.json: the ranked homepage feed.
 *
 * WHY THIS EXISTS
 * The homepage ticker was hardcoded markup. It never changed, and it kept
 * advertising programmes whose deadlines had passed — the fastest way to make a
 * user distrust every other date on the site.
 *
 * THE RANKING
 * Five tiers, in this order. Within a tier, the secondary sort is stated.
 *
 *   1  new        Added in the most recent scrape runs, whatever the deadline.
 *                 Newest first. A fresh listing is the reason to come back.
 *   2  closing    Open, with a real date. Soonest first — urgency is the point.
 *   3  evergreen  Rolling / no deadline / "see official site". Never closes,
 *                 always actionable, but no urgency so it sits below tier 2.
 *   4  recurring  Closed, but the programme visibly runs on a cycle (an edition
 *                 year, "annual", "cohort"). Still useful: you can prepare for
 *                 the next round. Most recently closed first.
 *   5  archived   Closed with no sign it repeats. Kept for search and history,
 *                 never promoted.
 *
 * Only tiers 1–3 are eligible for the homepage ticker. Tiers 4 and 5 are
 * emitted so the hub can use the same ranking without a second parser.
 *
 * ROTATION — the actual complaint being solved
 * "We don't want visitors seeing the same programmes in the first spots as when
 * they last visited." So the feed carries a `rotationSeed` that changes daily,
 * and the client rotates the starting offset within tiers 2 and 3. Tier 1 is
 * never rotated: newest genuinely should lead. This is rotation, not shuffling —
 * order stays stable within a day, so it is cacheable and reproducible.
 *
 * Usage:  node scripts/gen-ticker.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HUB_FILE = path.join(ROOT, 'opportunity-hub.html');
const OUT_FILE = path.join(ROOT, 'data', 'ticker.json');

// DELIBERATELY STRICTER THAN scripts/expire-opportunities.js (which uses 7).
// That sweep protects database rows from being retired over a misparsed date,
// so slack is right there. This is a promotional surface: nothing past its
// stated deadline gets promoted.
const GRACE_DAYS = 0;

// How long a listing counts as "just added".
const NEW_WINDOW_DAYS = 10;

const MAX_TICKER = 24;   // enough to fill the strip twice
const TICKER_MIN = 6;    // below this a looping strip reads broken — pad it
const MAX_FEED   = 120;  // full ranked feed for the hub / "just added" section

// ---------------------------------------------------------------------------

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#0?38;/g, '&').replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8211;|&ndash;/g, '–').replace(/&#8212;|&mdash;/g, '—')
    .replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';

/**
 * Date, or null when no readable CLOSING date. null means "unknown", never
 * "expired" — an unknown date must never retire a live programme.
 *
 * The hard case, and a real one caught on 2026-08-26:
 *   "Applications open Wednesday 19 August 2026 on niya.gov.ng —
 *    closing date not yet published"
 * A naive first-date-wins parser reads 19 August as the deadline, marks the
 * programme closed, and silently hides a listing that is actually open. So:
 *   1. Phrases that explicitly say the closing date is unknown win outright.
 *   2. Any "opens/opened on <date>" clause is stripped before we look.
 *   3. A date introduced by a closing word is preferred over a bare one.
 */
function parseDeadline(text) {
  let t = decodeEntities(text);
  if (!t) return null;

  // 1. Explicitly unknown / always open.
  if (/rolling|ongoing|no deadline|see (official|source)|check official|open now|varies/i.test(t)) return null;
  if (/clos\w*\s+(date|deadline)[^.]{0,40}\b(not\s+(yet\s+)?(published|announced|stated|known)|unpublished|tbc|tba|unknown)/i.test(t)) return null;
  if (/\b(deadline|closing date)\s*[:\-]?\s*(tbc|tba|n\/?a|unknown)\b/i.test(t)) return null;

  // 2. Remove opening-date clauses so they can't be mistaken for a deadline.
  t = t.replace(new RegExp(
    `\\b(?:applications?\\s+)?(?:open(?:s|ed|ing)?|start(?:s|ed)?|begin(?:s)?|launch(?:es|ed)?)\\b[^.;—–-]{0,40}?` +
    `(?:\\d{1,2}\\s+(?:${MONTHS})[a-z]*\\.?,?\\s+\\d{4}|(?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2})`,
    'ig'), ' ');

  // 3. Prefer a date that follows a closing word.
  const closingClause = t.match(/(?:deadline|closes?|closing|ends?|due|last day|apply by|submit by)\b([\s\S]{0,60})/i);
  const scopes = closingClause ? [closingClause[1], t] : [t];

  for (const scope of scopes) {
    const iso = scope.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T23:59:59Z`);
      if (!isNaN(d)) return d;
    }
    const dmy = scope.match(new RegExp(`(\\d{1,2})\\s+(${MONTHS})[a-z]*\\.?,?\\s+(\\d{4})`, 'i'));
    const mdy = scope.match(new RegExp(`(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i'));
    const m = dmy ? { day: dmy[1], mon: dmy[2], year: dmy[3] }
            : mdy ? { day: mdy[2], mon: mdy[1], year: mdy[3] } : null;
    if (!m) continue;
    const idx = MONTHS.split('|').indexOf(m.mon.toLowerCase());
    if (idx < 0) continue;
    const d = new Date(Date.UTC(+m.year, idx, +m.day, 23, 59, 59));
    if (!isNaN(d)) return d;
  }
  return null;
}

/**
 * Does this programme look like it runs on a cycle? Heuristic and deliberately
 * conservative — a wrong "annual" tag tells someone to wait for a round that
 * never comes, so we only claim it on explicit evidence.
 */
function looksRecurring(title, slug) {
  const t = `${title} ${slug}`;
  if (/\bannual|\byearly|\beach year|\bevery year/i.test(t)) return true;
  if (/\bcohort\b|\bedition\b|\bseason\b|\bround\s*\d/i.test(t)) return true;
  // An explicit edition year ("... Programme 2026", "2026/2027") is the single
  // strongest signal that editions exist.
  if (/\b20\d{2}\s*\/\s*20\d{2}\b/.test(t)) return true;
  if (/\b20\d{2}\b/.test(title)) return true;
  return false;
}

function daysBetween(a, b) { return Math.floor((a - b) / 86400000); }

// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(HUB_FILE)) {
    console.error('✗ opportunity-hub.html not found — nothing to build from.');
    process.exit(1);
  }
  const hub = fs.readFileSync(HUB_FILE, 'utf8');
  const now = new Date();

  // The scraper writes "<!-- AUTO: <id> | YYYY-MM-DD -->" immediately before
  // each card, which is our only record of when a listing was added.
  const cardRe = new RegExp(
    '(?:<!--\\s*AUTO:\\s*([^|]*?)\\s*\\|\\s*(\\d{4}-\\d{2}-\\d{2})\\s*-->\\s*)?' +
    '<a class="card" href="([^"]+)"' +
    '[\\s\\S]*?<div class="card-title">([\\s\\S]*?)<\\/div>' +
    '[\\s\\S]*?<strong>Deadline:<\\/strong>\\s*([\\s\\S]*?)<\\/span>',
    'g');

  const items = [];
  const seen = new Set();
  let m;
  while ((m = cardRe.exec(hub)) !== null) {
    const addedRaw = m[2] || null;
    const href = (m[3] || '').trim();
    const title = decodeEntities((m[4] || '').replace(/<[^>]+>/g, ''));
    const deadlineText = decodeEntities((m[5] || '').replace(/<[^>]+>/g, ''));
    if (!href || !title || seen.has(href)) continue;
    seen.add(href);

    // Fall back to the date embedded in the filename when there's no AUTO tag.
    const fromName = href.match(/(\d{4}-\d{2}-\d{2})/);
    const added = addedRaw || (fromName ? fromName[1] : null);

    const closesDate = parseDeadline(deadlineText);
    const closed = closesDate
      ? closesDate.getTime() < (now.getTime() - GRACE_DAYS * 86400000)
      : false;
    const ageDays = added ? daysBetween(now, new Date(`${added}T00:00:00Z`)) : 9999;
    const isNew = ageDays >= 0 && ageDays <= NEW_WINDOW_DAYS;
    const recurring = looksRecurring(title, href);

    let tier;
    if (isNew) tier = 1;                          // new, whatever the deadline
    else if (!closed && closesDate) tier = 2;     // open, dated
    else if (!closed && !closesDate) tier = 3;    // evergreen
    else if (recurring) tier = 4;                 // closed but cyclical
    else tier = 5;                                // closed, one-off

    items.push({
      title, href,
      deadline: deadlineText || 'See official site',
      closes: closesDate ? closesDate.toISOString().slice(0, 10) : null,
      added, tier, isNew, closed, recurring,
    });
  }

  const byTier = (t) => items.filter((i) => i.tier === t);
  const desc = (k) => (a, b) => String(b[k] || '').localeCompare(String(a[k] || ''));
  const asc  = (k) => (a, b) => String(a[k] || '').localeCompare(String(b[k] || ''));

  const ranked = [
    ...byTier(1).sort(desc('added')),   // newest first
    ...byTier(2).sort(asc('closes')),   // soonest deadline first
    ...byTier(3).sort(desc('added')),   // evergreen, freshest first
    ...byTier(4).sort(desc('closes')),  // most recently closed first
    ...byTier(5).sort(desc('closes')),
  ];

  // Changes every day → the client rotates tiers 2–3 so the same programmes
  // don't hold the front slots for a returning visitor.
  const rotationSeed = Number(now.toISOString().slice(0, 10).replace(/-/g, ''));

  const out = {
    generated: now.toISOString(),
    rotationSeed,
    newWindowDays: NEW_WINDOW_DAYS,
    counts: {
      total: items.length,
      new: byTier(1).length, closing: byTier(2).length, evergreen: byTier(3).length,
      recurring: byTier(4).length, archived: byTier(5).length,
    },
    // Homepage strip: NEWLY PUBLISHED programmes only, newest first.
    //
    // The ticker is a "what just landed" strip, not a catalogue — the hub is
    // the catalogue. Anything added by a scrape run appears here as soon as it
    // publishes, and ages out after NEW_WINDOW_DAYS.
    //
    // Two deliberate rules:
    //  - Still-open only. A brand-new listing that arrived already closed still
    //    shows under Just Added (flagged closed, because "what changed" is the
    //    point there) but is never paraded across the top of the page. That is
    //    the exact failure the old hardcoded ticker had.
    //  - Top-up. A quiet week could leave one or two items, which reads broken
    //    on a looping strip. If there are fewer than TICKER_MIN new ones, pad
    //    with the soonest-closing open listings so the strip still has body.
    //    Padding is marked `pad:true` so the client can style it differently.
    ticker: (() => {
      const fresh = ranked.filter((i) => i.tier === 1 && !i.closed);
      if (fresh.length >= TICKER_MIN) return fresh.slice(0, MAX_TICKER);
      const pad = ranked
        .filter((i) => i.tier === 2 && !i.closed)
        .slice(0, TICKER_MIN - fresh.length)
        .map((i) => Object.assign({}, i, { pad: true }));
      return fresh.concat(pad).slice(0, MAX_TICKER);
    })(),
    // "Just added" section — newest first, whatever the deadline.
    latest: byTier(1).sort(desc('added')).slice(0, 12),
    // Full ranked feed for the hub.
    items: ranked.slice(0, MAX_FEED),
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');
  const c = out.counts;
  console.log(`✓ data/ticker.json — ${c.total} parsed | new ${c.new} · closing ${c.closing} · evergreen ${c.evergreen} · recurring ${c.recurring} · archived ${c.archived}`);
  console.log(`  ticker: ${out.ticker.length}  ·  just-added: ${out.latest.length}`);
}

main();
