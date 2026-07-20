/**
 * FundFinder AI — Daily Scraper
 * Runs via GitHub Actions every morning at 7 AM Nigeria time (6 AM UTC).
 * Zero cost: no AI APIs used. Pure web scraping + RSS.
 *
 * What it does:
 *  1. Checks RSS feeds & pages for new Nigerian funding opportunities
 *  2. Skips any already seen (tracked in data/seen-ids.json)
 *  3. Generates an HTML flyer for each new opportunity
 *  4. Injects new cards into opportunity-hub.html
 *  5. Writes a daily summary Markdown file
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ─── Supabase Config ──────────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://zrkxigbmlprrowiofhjy.supabase.co';
const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEY || 'sb_publishable_bLh6vRkyGXTZD2253Ll1wA_BSPy3S54';

// ─── Config ──────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');          // repo root
const DATA_DIR = path.join(ROOT, 'data');
const SEEN_FILE = path.join(DATA_DIR, 'seen-ids.json');
const MANUAL_FILE = path.join(DATA_DIR, 'manual-opportunities.json');
const LAST_RUN_FILE = path.join(DATA_DIR, 'last-run.json');
const HUB_FILE = path.join(ROOT, 'opportunity-hub.html');
const SUMMARY_DIR = path.join(ROOT, 'summaries');

// Titles containing these phrases are aggregator articles, not individual opportunities — skip them
const GARBAGE_PATTERNS = [
  // "100 grants", "100 open grant opportunities", "100 funding opportunities"
  /^\d+\s+\w*\s*(grant|funding)\b/i,
  // "Explore 60 funding", "Discover 50 grants"
  /\b(explore|discover|check out|here are)\s+\d+\s+(grant|funding|opportunit)/i,
  // "most impactful donors", "top donors willing to fund"
  /most impactful donors/i,
  /donors (that are |who are )?willing to fund/i,
  // roundup/listicle patterns
  /best grants in/i,
  /list of grants/i,
  /top \d+ /i,
  /complete guide/i,
  /how to apply for grants/i,
  /free funding for/i,
  /ongoing grants in nigeria/i,
  /grants? and funding opportunities for/i,
  /verified list/i,
  /updated (monthly|weekly|daily)/i,
  // jobs listings, not funding
  /\bngo jobs\b/i,
  // "300 grant opportunities closing", "15 innovative grants to empower"
  /^\d+\s+(innovative|open|new|verified|active|live|available|current)\s+(grant|funding|opportunit)/i,
  // aggregator articles with "opportunities" in plural listicle form
  /\d+\s+(grant|funding)\s+opportunit(ies|y)\s+(closing|open|for|in|across|available)/i,
  // "could threaten X jobs" — news not a funding opportunity
  /could threaten .* jobs/i,
  // "seeking a [job title]" — job posts
  /seeking a .*(coordinator|manager|officer|director|analyst|associate)\b/i,
  // textile/trade news
  /import ban/i,
  // listicles starting with a count like "10+", "100+", "14 Open Programmes" (but NOT a year like "2026 ...")
  /^(?!(19|20)\d{2}\b)\d+\+?\s+.*\b(grants?|funds?|funding|opportunit|programmes?|programs?)\b/i,
  /\bnewly announced grant/i,
  /\bnews items\b/i,
  /closing this \w+/i,
  /don'?t miss out/i,
  /\bnew\s*&(amp;)?\s*ongoing\b/i,
  // listicles without a leading number
  /\bcurated list\b/i,
  /\blist of\b.*\b(grants?|opportunit|funds?)/i,
  // "grants" as a verb in news headlines: "Grenada Grants Visa-Free Entry"
  /\bgrants? (visa|entry|approval|licen[cs]e|amnesty|waiver|permission|access)\b/i,
];

// Headlines that are NEWS about money (already given, warnings, reports) — not something you can apply for
const NEWS_PATTERNS = [
  /\b(warns?|warned|cautions?|condemns?|denies|refutes|reacts?|arrests?|probes?|sues?|slams)\b/i,
  /\b(disburses?d?|has (disbursed|awarded|paid|selected|empowered)|empowers|hands? over)\b/i,
  /\bbeneficiaries (selected|announced|emerge|receive)\b/i,
  /\b(gets?|got|receives?|received|secures?d?|wins?|won|bags?|raises?d?)\b.{0,40}\b(grant|fund|loan|prize|million|billion|\$|₦)/i,
  /\bwinners? (announced|emerge|unveiled|revealed)\b/i,
  /\b(banknote|naira (falls|gains|drops)|exchange rate|inflation)\b/i,
  /\bfirst beneficiaries\b/i,
];

// A real opportunity must have BOTH a funding word AND an "act now" word
const FUNDING_SIGNAL = /\b(grants?|funds?|funding|loans?|prizes?|awards?|scholarships?|fellowships?|accelerators?|incubat\w*|competitions?|challenges?|investments?|equity|bootcamps?|programmes?|programs?)\b/i;
const ACTION_SIGNAL = /\b(apply|application|applications? (open|invited|close|closing)|call for (applications?|proposals?|entries)|now open|accepting|deadline|register|submit|entries|enrol?l)\b/i;

const THIS_YEAR = new Date().getFullYear();

function decodeEntities(s) {
  let prev;
  do {
    prev = s;
    s = s
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
  } while (s !== prev);
  return s;
}

/** Clean a raw feed headline: decode entities, drop " - Publisher" suffix, tidy whitespace */
function cleanTitle(raw) {
  let t = decodeEntities(raw).replace(/<[^>]+>/g, '').trim();
  // Google News appends " - Publisher"; WordPress feeds append " - SiteName". Drop the last short dash-segment.
  const parts = t.split(/\s+[-\u2013\u2014]\s+/);
  if (parts.length > 1 && parts[parts.length - 1].length <= 40 && !FUNDING_SIGNAL.test(parts[parts.length - 1])) {
    parts.pop();
    t = parts.join(' \u2014 ');
  }
  return t.replace(/\s+/g, ' ').trim();
}

/** Clean a feed description into plain readable sentences (no HTML, no boilerplate) */
function sanitizeDesc(raw, title) {
  let d = decodeEntities(raw || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/The post .* appeared first on .*/i, '')
    .replace(/View Full Coverage on Google News/i, '')
    .replace(/\[\u2026\]|\[\.\.\.\]|\u2026\s*$/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // If what's left is junk (too short, or just the title repeated), write a clean fallback
  const tNorm = (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const dNorm = d.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (d.length < 60 || dNorm === tNorm || dNorm.includes(tNorm)) {
    return `${title} is now open. Visit the official page for full details on who can apply, what you'll receive, and how to submit your application.`;
  }
  // Trim to ~400 chars, ending at a sentence boundary
  if (d.length > 400) {
    const cut = d.slice(0, 400);
    const lastStop = cut.lastIndexOf('. ');
    d = lastStop > 150 ? cut.slice(0, lastStop + 1) : cut + '\u2026';
  }
  return d;
}

/** True if this looks like a genuine, current, apply-able opportunity */
function isRealOpportunity(title, desc) {
  const text = title + ' ' + desc;
  if (isGarbage(title)) return false;
  if (NEWS_PATTERNS.some((p) => p.test(title))) return false;
  if (!FUNDING_SIGNAL.test(text)) return false;
  if (!ACTION_SIGNAL.test(text)) return false;
  // Reject stale items: title mentions an old year and never the current/next year
  const years = (title.match(/\b(19|20)\d{2}\b/g) || []).map(Number);
  if (years.length && Math.max(...years) < THIS_YEAR) return false;
  return true;
}

/** Try to pull a real deadline out of the text; else a plain-language fallback */
function extractDeadline(text) {
  const m =
    text.match(/deadline(?:\s+is)?[:\s]*([A-Z][a-z]+ \d{1,2},? \d{4})/i) ||
    text.match(/closes? (?:on |by )?([A-Z][a-z]+ \d{1,2},? \d{4})/i) ||
    text.match(/apply (?:before|by) ([A-Z][a-z]+ \d{1,2},? \d{4})/i) ||
    text.match(/on or before ([A-Z][a-z]+ \d{1,2},? \d{4})/i);
  return m ? m[1].replace(/,?\s+/g, ' ').trim() : 'Check official page';
}

/** Guess the organisation running it from the headline (e.g. "BATN Foundation" from "BATN Foundation Grant 2026") */
function extractFunder(title, fallback) {
  const stripped = title.replace(/^(?:apply(?: now)?(?: for(?: the)?)?[:!]?\s*|call for (?:applications?|entries|proposals?)[:!]?\s*|calling all \w+[:!]?\s*)/i, '');
  const m = stripped.match(/^(.{3,50}?)\s+(?:launches|announces|opens|unveils|introduces|invites|grant|prize|fund|programme|program|award|scholarship|fellowship|initiative|competition|challenge|bootcamp|accelerator)\b/i);
  if (m) {
    const org = m[1].replace(/^(the|a)\s+/i, '').trim();
    if (org.length >= 3 && !/^\d/.test(org) && org.split(' ').length <= 6) return org;
  }
  return fallback || '';
}

// Marker comment in opportunity-hub.html where new cards get injected
const HUB_INSERT_MARKER = '<!-- SCRAPER_AUTO_INSERT -->';

const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// ─── Sources ──────────────────────────────────────────────────────────────────
// RSS feeds from sites that publish individual opportunities (not aggregator lists)
const SOURCES = [
  {
    id: 'msme-africa',
    name: 'MSME Africa',
    url: 'https://msmeafricaonline.com/feed/',
    strategy: 'rss',
    keywords: ['grant', 'fund', 'loan', 'apply', 'call for applications', 'deadline', 'nigeria', 'entrepreneur', 'startup', 'sme', 'msme'],
  },
  {
    id: 'opportunity-desk',
    name: 'Opportunity Desk',
    url: 'https://opportunitydesk.org/feed/',
    strategy: 'rss',
    keywords: ['nigeria', 'africa', 'grant', 'fund', 'apply', 'call for applications', 'entrepreneur', 'startup', 'business'],
  },
  {
    id: 'funds-for-ngos',
    name: 'Funds for NGOs',
    url: 'https://www2.fundsforngos.org/feed/',
    strategy: 'rss',
    keywords: ['nigeria', 'grant', 'fund', 'apply', 'entrepreneur', 'sme', 'business', 'startup'],
  },
  {
    id: 'entrepreneurs-ng',
    name: 'Entrepreneurs.ng',
    url: 'https://entrepreneurs.ng/feed/',
    strategy: 'rss',
    keywords: ['grant', 'fund', 'loan', 'apply', 'call for applications', 'deadline', 'entrepreneur'],
  },
  {
    id: 'nigeria-startup-act',
    name: 'Nigeria Startup Act',
    url: 'https://www.nigeriastartupact.ng/feed/',
    strategy: 'rss',
    keywords: ['grant', 'fund', 'apply', 'call for applications', 'deadline', 'startup', 'innovation'],
  },
  {
    id: 'afterschool-africa',
    name: 'Afterschool Africa',
    url: 'https://www.afterschoolafrica.com/feed/',
    strategy: 'rss',
    keywords: ['nigeria', 'africa', 'grant', 'fund', 'apply', 'entrepreneur', 'startup', 'business', 'naira', '₦', '$'],
  },
];
// NOTE (2026-07-14): Removed the two Google News sources (gnews-call-for-applications,
// gnews-ng-deadline). Their RSS <link> is a news.google.com redirect wrapper that (a) bounces
// through a cookie-consent redirect loop for headless fetches and (b) even when it resolves,
// lands on a news publisher's article ABOUT the funding — not the program principal's own
// site. That double indirection was the main source of flyers linking to blogs/news instead of
// the real application page. See resolveApplyUrl() below for how remaining sources are handled.

// ─── Utilities ────────────────────────────────────────────────────────────────

function fetch(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; FundFinderBot/1.0; +https://fundfinder.ng)',
          Accept: 'text/html,application/xhtml+xml,application/rss+xml,*/*',
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetch(res.headers.location, timeoutMs).then(resolve).catch(reject);
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout: ' + url)); });
  });
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

/** POST/upsert records to a Supabase REST endpoint. Returns parsed JSON or null on error. */
function supabasePost(table, records) {
  return new Promise((resolve) => {
    const body = JSON.stringify(records);
    const u = new URL(`/rest/v1/${table}`, SUPABASE_URL);
    const options = {
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true });
        } else {
          console.warn(`  ⚠️  Supabase ${table} upsert failed [${res.statusCode}]: ${data.slice(0, 200)}`);
          resolve({ ok: false, status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', (e) => {
      console.warn(`  ⚠️  Supabase request error: ${e.message}`);
      resolve({ ok: false, error: e.message });
    });
    req.write(body);
    req.end();
  });
}

/** Map a scraper opp object → Supabase opportunities row */
function CAPITAL_TYPE_MAP(category) {
  return { grants: 'grant', loans: 'loan', investment: 'equity', training: 'training', empowerment: 'grant' }[category] || 'grant';
}

function parseDeadlineDate(text) {
  // Returns ISO date string if parseable, else null
  if (!text || ['See source', 'See official site', 'Open', 'Rolling', 'TBA'].includes(text)) return null;
  const d = new Date(text);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function detectGenderTarget(title, desc) {
  const t = (title + ' ' + desc).toLowerCase();
  if (/\b(women|female|girl|she)\b/.test(t)) return 'female';
  return 'all';
}

function requiresCac(title, desc) {
  const t = (title + ' ' + desc).toLowerCase();
  return /\b(cac|registered (business|company)|incorporation)\b/.test(t);
}

function requiresStudent(title, desc) {
  const t = (title + ' ' + desc).toLowerCase();
  return /\b(student|undergraduate|postgraduate|academic|university|college)\b/.test(t);
}

/** Convert an array of opp objects to Supabase opportunity rows and upsert in one batch */
async function upsertOpportunitiesToSupabase(opps) {
  if (!opps.length) return;
  const rows = opps.map((opp) => ({
    slug:             opp.slug,
    title:            opp.title,
    source_url:       opp.applyUrl || null,
    apply_url:        opp.applyUrl || null,
    organiser:        opp.funder   || null,
    summary:          (opp.description || '').slice(0, 600),
    capital_type:     CAPITAL_TYPE_MAP(opp.category),
    sectors:          [],            // will be enriched later
    amount_text:      opp.amount !== 'See details' ? opp.amount : null,
    eligibility:      opp.eligibility || '',
    gender_target:    detectGenderTarget(opp.title, opp.description),
    requires_cac:     requiresCac(opp.title, opp.description),
    requires_student: requiresStudent(opp.title, opp.description),
    target_states:    [],
    target_sectors:   [],
    deadline:         parseDeadlineDate(opp.deadline),
    scraped_at:       TODAY,
    is_active:        true,
  }));

  console.log(`\n  📤 Upserting ${rows.length} opportunities to Supabase…`);
  const result = await supabasePost('opportunities', rows);
  if (result.ok) {
    console.log(`  ✅ Supabase upsert OK (${rows.length} records)`);
  }
}

/** Slug for cross-source dedupe: drops boilerplate prefixes and amounts */
function titleSlugOf(title) {
  return slugify(
    title
      .replace(/^(?:apply(?: now)?(?: for(?: the)?)?[:!]?\s*|call for (?:applications?|entries|proposals?)[:!]?\s*|calling all \w+[:!]?\s*)/i, '')
      .replace(/[\u20a6$][\d,.]+\s*(?:million|billion|M|B|k)?/gi, '')
      .replace(/\(.*?\)/g, '')
  );
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// ─── RSS Parser (zero dependencies) ──────────────────────────────────────────

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                   block.match(/<title>(.*?)<\/title>/) || [])[1] || '';
    const link  = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '';
    const desc  = (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                   block.match(/<description>(.*?)<\/description>/) || [])[1] || '';
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
    if (title) items.push({ title: title.trim(), link: link.trim(), desc: desc.replace(/<[^>]+>/g, '').trim(), pubDate });
  }
  return items;
}

// ─── Page scraper (minimal HTML parse, no cheerio) ───────────────────────────

function extractHeadings(html) {
  const results = [];
  const regex = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, '').trim();
    if (text.length > 10 && text.length < 200) results.push(text);
  }
  return results;
}

function extractLinks(html, baseUrl) {
  const results = [];
  const regex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  const base = new URL(baseUrl);
  while ((m = regex.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (text.length > 10 && text.length < 200 && !href.startsWith('#')) {
      const url = href.startsWith('http') ? href : new URL(href, base).href;
      results.push({ text, url });
    }
  }
  return results;
}

// ─── Apply-link resolution ────────────────────────────────────────────────────
// Aggregator/blog RSS feeds (Opportunity Desk, Funds for NGOs, MSME Africa, etc.) publish
// their OWN post URL as <link> — that's the blog article about the opportunity, not the
// program principal's application page. Most of these posts contain an outbound link to the
// real org site ("Click here to apply", the org name, or a bare URL). We fetch the post and
// pull that link out; if we can't find a confident one, we drop the item rather than publish
// a flyer that points back at the blog (the exact bug this fixes).

const LINK_EXCLUDE_DOMAINS = [
  'facebook.com', 'twitter.com', 'x.com', 'whatsapp.com', 'wa.me', 'linkedin.com',
  'pinterest.com', 't.me', 'telegram.me', 'feedburner.com', 'reddit.com', 'instagram.com',
  'youtube.com', 'youtu.be', 'addtoany.com', 'wp.com', 'gravatar.com', 'w3.org', 'schema.org',
  'googleapis.com', 'gstatic.com', 'google.com', 'news.google.com', 'doubleclick.net',
  'googlesyndication.com', 'amazon-adsystem.com', 'wordpress.com', 'wordpress.org',
  // Aggregator-family sister sites/tools that show up in footers/sidebars, not real org links.
  'fundsforngos.ai', 'ngos.ai', 'fundsforngospremium.com', 'eepurl.com', 'cookiedatabase.org',
  'apps.apple.com', 'play.google.com',
];

function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

// Compare by registrable base domain (last two labels), not exact hostname — aggregator sites
// often mix subdomains (www.fundsforngos.org vs www2.fundsforngos.org) and a naive exact-match
// treats those as different sites, letting the source's own nav links slip through as if they
// were a real outbound org link.
function baseDomainOf(host) {
  const parts = host.split('.').filter(Boolean);
  return parts.length <= 2 ? host : parts.slice(-2).join('.');
}

function isExcludedLinkDomain(host) {
  return !host || LINK_EXCLUDE_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
}

/** Pull candidate outbound (off-domain) links with their anchor text out of a post's HTML */
function extractOutboundLinks(html, postUrl) {
  const sourceBase = baseDomainOf(hostnameOf(postUrl));
  const results = [];
  const regex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const href = decodeEntities(m[1]).trim();
    if (!/^https?:\/\//i.test(href)) continue;
    const host = hostnameOf(href);
    if (!host || baseDomainOf(host) === sourceBase || isExcludedLinkDomain(host)) continue;
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, '').trim());
    results.push({ href, text, host });
  }
  return results;
}

const APPLY_ANCHOR_RE = /\b(apply|application\s*form|register|registration|official\s*(site|website|page)|submit\s*(your|an)?\s*application|click here)\b/i;
const JUNK_ANCHOR_RE = /\b(share|read more|comment|related (post|article)s?|leave a reply|source|photo|image credit|advertisement|subscribe)\b/i;

/**
 * Some aggregator themes (WordPress "infinite scroll" templates) render the NEXT article's full
 * content on the same page below the one you asked for — so a single fetched URL can contain
 * several distinct opportunities back to back, each under its own <h1-3> heading. If we don't
 * scope the search, we can grab another opportunity's "APPLY HERE" link by mistake. This finds
 * the heading that matches this specific title and trims the HTML down to just that section
 * (from its heading up to the next heading of the same or higher level).
 */
function scopeToArticleSection(html, title) {
  if (!title) return html;
  const words = title
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5);
  if (words.length < 2) return html;

  const pattern = words.map((w) => w.replace(/[-\[\]{}()*+?.,\\^$|#\s]/g, '\\$&')).join('[\\s\\S]{0,60}');
  let wordsRe;
  try {
    wordsRe = new RegExp(pattern, 'i');
  } catch {
    return html;
  }

  // Anchor specifically to the <h1> that carries THIS title, not any earlier mention in
  // <title>/meta tags or "related posts"/mega-menu widgets (those match the title text too,
  // just not inside an <h1>, and matching them instead points the scope at the wrong section).
  const h1Re = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
  let m;
  let sectionStart = -1;
  let matchLen = 0;
  while ((m = h1Re.exec(html)) !== null) {
    const innerText = m[1].replace(/<[^>]+>/g, ' ');
    if (wordsRe.test(innerText)) {
      sectionStart = m.index;
      matchLen = m[0].length;
      break;
    }
  }
  if (sectionStart === -1) return html; // couldn't confidently anchor; fall back to whole page

  const afterStart = sectionStart + matchLen;
  const nextIdx = html.slice(afterStart).search(/<h1[^>]*>/i); // next article's <h1> = end of this one
  const sectionEnd = nextIdx === -1 ? html.length : afterStart + nextIdx;
  return html.slice(sectionStart, sectionEnd);
}

/** Fetch a blog/aggregator post and try to find the real program-principal apply link. Null if unresolved. */
async function resolveApplyUrl(postUrl, title) {
  try {
    const html = await fetch(postUrl, 10000);
    const scoped = scopeToArticleSection(html, title);
    let candidates = extractOutboundLinks(scoped, postUrl);
    if (!candidates.length && scoped !== html) candidates = extractOutboundLinks(html, postUrl);
    if (!candidates.length) return null;

    // Highest confidence: anchor text explicitly says "apply" / "register" / "click here" etc.
    const applyMatch = candidates.find((c) => APPLY_ANCHOR_RE.test(c.text));
    if (applyMatch) return applyMatch.href;

    // Next: anchor text that's just the destination URL itself (common "official page" pattern)
    const urlAsText = candidates.find((c) => c.text.replace(/^https?:\/\//i, '').startsWith(c.host));
    if (urlAsText) return urlAsText.href;

    // Fallback: last non-junk outbound link (posts usually end with the real CTA link)
    const clean = candidates.filter((c) => !JUNK_ANCHOR_RE.test(c.text));
    if (clean.length) return clean[clean.length - 1].href;

    return null;
  } catch {
    return null;
  }
}

// ─── Opportunity detection ────────────────────────────────────────────────────

function containsKeywords(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

function categorize(title) {
  const t = title.toLowerCase();
  if (t.includes('grant') || t.includes('prize') || t.includes('award')) return 'grants';
  if (t.includes('loan') || t.includes('financ') || t.includes('credit')) return 'loans';
  if (t.includes('empowerment') || t.includes('youth') || t.includes('women')) return 'empowerment';
  if (t.includes('training') || t.includes('bootcamp') || t.includes('incubat')) return 'training';
  if (t.includes('invest') || t.includes('equity') || t.includes('venture')) return 'investment';
  return 'grants';
}

function extractAmount(text) {
  const range = text.match(/(?:up to\s+)?[\u20a6$][\d,]+(?:\.\d+)?\s*(?:million|billion|M|B|k)?(?:\s*[\u2013\u2014-]\s*[\u20a6$]?[\d,]+(?:\.\d+)?\s*(?:million|billion|M|B|k)?)?/i);
  if (range) return range[0].trim();

  const dollar = text.match(/\$[\d,]+(?:\s*(?:million|billion|M|B|k))?/i);
  if (dollar) return dollar[0];
  const spelled = text.match(/(\d+(?:\.\d+)?)\s*(million|billion)\s*(naira|dollars?|USD|NGN)/i);
  if (spelled) return spelled[0];
  return 'See details';
}

// ─── HTML Flyer Generator ─────────────────────────────────────────────────────

function generateFlyer(opp) {
  const catColors = {
    grants: '#22c55e',
    loans: '#FFD700',
    empowerment: '#f97316',
    training: '#64c8ff',
    investment: '#c4b5fd',
  };
  const color = catColors[opp.category] || '#22c55e';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<script>if(location.hostname==='opportunities.a2fpartners.com')location.replace('https://fundfinder.ng'+location.pathname+location.search);</script>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${opp.title} — FundFinder AI | A2F Partners</title>
<meta property="og:title" content="${opp.title} — FundFinder AI">
<meta property="og:description" content="${opp.description}">
<meta name="description" content="${opp.description}">
<link rel="canonical" href="https://fundfinder.ng/${opp.slug}.html">
<meta property="og:url" content="https://fundfinder.ng/${opp.slug}.html">
<meta property="og:type" content="article">
<meta property="og:image" content="https://fundfinder.ng/og-image.png">
<meta property="og:site_name" content="FundFinder AI">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${opp.title} — FundFinder AI">
<meta name="twitter:description" content="${opp.description}">
<meta name="twitter:image" content="https://fundfinder.ng/og-image.png">
<script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'Home',item:'https://fundfinder.ng/'},{'@type':'ListItem',position:2,name:'Funding Opportunities',item:'https://fundfinder.ng/opportunity-hub.html'},{'@type':'ListItem',position:3,name:opp.title,item:`https://fundfinder.ng/${opp.slug}.html`}]}).replace(/</g,'\\u003c')}</script>
<script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':'WebPage',name:opp.title,description:opp.description,url:`https://fundfinder.ng/${opp.slug}.html`,datePublished:TODAY,inLanguage:'en-NG',isPartOf:{'@id':'https://fundfinder.ng/#website'},publisher:{'@id':'https://fundfinder.ng/#org'}}).replace(/</g,'\\u003c')}</script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0a0a0a; --surface: #111; --surface2: #1a1a1a;
    --border: rgba(255,255,255,0.08); --text: #f0f0f0;
    --muted: rgba(255,255,255,0.5); --gold: #FFD700;
    --green: #22c55e; --accent: ${color};
  }
  body { font-family: 'Segoe UI', -apple-system, Arial, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; min-height: 100vh; }
  nav { border-bottom: 1px solid var(--border); padding: 18px 40px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; background: rgba(10,10,10,0.96); backdrop-filter: blur(12px); z-index: 100; }
  .nav-logo { font-size: 18px; font-weight: 800; letter-spacing: 1px; text-decoration: none; color: var(--text); }
  .nav-logo span { color: var(--gold); }
  .back-btn { background: var(--surface2); border: 1px solid var(--border); color: var(--muted); padding: 8px 16px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600; }
  .back-btn:hover { color: var(--text); border-color: rgba(255,255,255,0.2); }

  .hero { background: linear-gradient(135deg, #001a00 0%, #003300 50%, #001a00 100%); border-bottom: 1px solid rgba(255,215,0,0.15); padding: 60px 40px; text-align: center; }
  .hero-tag { display: inline-block; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; padding: 5px 14px; border-radius: 20px; margin-bottom: 20px; }
  .hero-amount { font-size: clamp(40px, 8vw, 72px); font-weight: 900; color: var(--accent); line-height: 1; margin-bottom: 16px; }
  .hero-title { font-size: clamp(22px, 4vw, 36px); font-weight: 800; margin-bottom: 12px; max-width: 700px; margin-left: auto; margin-right: auto; }
  .hero-funder { font-size: 16px; color: var(--muted); }

  .content { max-width: 760px; margin: 0 auto; padding: 48px 40px 80px; }
  .section { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 28px; margin-bottom: 20px; }
  .section h2 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: var(--muted); margin-bottom: 16px; }
  .meta-list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
  .meta-list li { display: flex; align-items: flex-start; gap: 12px; font-size: 15px; }
  .meta-list li .icon { width: 20px; text-align: center; flex-shrink: 0; margin-top: 2px; }
  .desc { font-size: 15px; line-height: 1.8; color: rgba(255,255,255,0.85); }
  .apply-btn { display: block; background: var(--gold); color: #000; font-size: 16px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; padding: 18px 32px; border-radius: 12px; text-decoration: none; text-align: center; margin-top: 28px; transition: all 0.2s; }
  .apply-btn:hover { background: #ffe555; transform: translateY(-2px); }
  .disclaimer { font-size: 12px; color: var(--muted); text-align: center; margin-top: 16px; }
  .tag-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  .tag { background: rgba(255,255,255,0.06); border: 1px solid var(--border); color: var(--muted); font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 20px; }
  .tag.accent { background: rgba(255,215,0,0.1); border-color: rgba(255,215,0,0.3); color: var(--gold); }
</style>
</head>
<body>

<nav>
  <a class="nav-logo" href="/">FUND<span>FINDER</span> AI</a>
  <a class="back-btn" href="opportunity-hub.html">← All Opportunities</a>
</nav>

<div class="hero">
  <div class="hero-tag">🇳🇬 Nigeria Funding Opportunity</div>
  ${opp.amount !== 'See details' ? `<div class="hero-amount">${opp.amount}</div>` : ''}
  <div class="hero-title">${opp.title}</div>
  ${opp.funder ? `<div class="hero-funder">by ${opp.funder}</div>` : ''}
</div>

<div class="content">

  <div class="section">
    <h2>Key Details</h2>
    <ul class="meta-list">
      <li><span class="icon">⏰</span><span><strong>Deadline:</strong> ${opp.deadline}</span></li>
      <li><span class="icon">👤</span><span><strong>Who can apply:</strong> ${opp.eligibility}</span></li>
      <li><span class="icon">💰</span><span><strong>Amount:</strong> ${opp.amount !== 'See details' ? opp.amount : 'Check official page'}</span></li>
      <li><span class="icon">🏛️</span><span><strong>Funder:</strong> ${opp.funder || 'See official page'}</span></li>
      <li><span class="icon">🌍</span><span><strong>Scope:</strong> ${opp.scope || 'Nigeria'}</span></li>
    </ul>
    <div class="tag-row">
      <span class="tag accent">${opp.category.charAt(0).toUpperCase() + opp.category.slice(1)}</span>
      <span class="tag">🇳🇬 Nigeria</span>
      ${opp.deadline === 'Rolling' ? '<span class="tag">Rolling Deadline</span>' : ''}
    </div>
  </div>

  <div class="section">
    <h2>About This Opportunity</h2>
    <p class="desc">${opp.description}</p>
  </div>

  ${opp.howToApply ? `
  <div class="section">
    <h2>How to Apply</h2>
    <p class="desc">${opp.howToApply}</p>
  </div>
  ` : ''}

  <a class="apply-btn" href="${opp.applyUrl}" target="_blank" rel="noopener">
    Apply Now →
  </a>
  <p class="disclaimer">FundFinder AI surfaces opportunities — always verify details on the official source before applying.</p>

</div>
</body>
</html>`;
}

// ─── Hub card HTML ────────────────────────────────────────────────────────────

function generateCard(opp) {
  const catClass = opp.category;
  const badgeColor = {
    grants: 'badge-green',
    loans: 'badge-gold',
    empowerment: 'badge-orange',
    training: 'badge-blue',
    investment: 'badge-purple',
  }[opp.category] || 'badge-green';

  return `
    <!-- AUTO: ${opp.id} | ${TODAY} -->
    <a class="card" href="${opp.slug}.html">
      <div class="card-top ${catClass}">
        <div class="card-amount">${opp.amount !== 'See details' ? opp.amount : 'Open Now'}</div>
        <div class="card-badges">
          <span class="badge ${badgeColor}">${opp.category.charAt(0).toUpperCase() + opp.category.slice(1)}</span>
          <span class="badge badge-nigeria">🇳🇬 Nigeria</span>
        </div>
        ${opp.funder ? `<div class="card-funder">${opp.funder}</div>` : ''}
        <div class="card-title">${opp.title}</div>
      </div>
      <div class="card-body">
        <div class="card-meta">
          <div class="meta-row">⏰ <span><strong>Deadline:</strong> ${opp.deadline}</span></div>
          <div class="meta-row">👤 <span>${opp.eligibility}</span></div>
          <div class="meta-row">💰 <span>${opp.amount !== 'See details' ? opp.amount : 'Check official page'}</span></div>
          <div class="meta-row">🌍 <span>${opp.scope || 'Nigeria eligible'}</span></div>
        </div>
        <span class="card-cta">View Details &amp; Apply →</span>
      </div>
    </a>`;
}

// ─── Social caption generator (plain text, used by the social poster) ────────

function generateCaption(opp) {
  const lines = [
    '🚨 NEW FUNDING OPPORTUNITY 🇳🇬',
    '',
    opp.title,
    '',
  ];
  if (opp.amount && opp.amount !== 'See details') lines.push('💰 ' + opp.amount);
  if (opp.deadline && opp.deadline !== 'Check official page') lines.push('⏰ Deadline: ' + opp.deadline);
  if (opp.funder) lines.push('🏛️ ' + opp.funder);
  lines.push('');
  lines.push('👉 Apply here: https://fundfinder.ng/' + opp.slug + '.html');
  lines.push('');
  lines.push('More funding for Nigerian entrepreneurs → https://fundfinder.ng');
  lines.push('');
  lines.push('#Funding #Grants #Nigeria #SME #Entrepreneurs');
  return lines.join('\n');
}

// ─── Main scraper logic ───────────────────────────────────────────────────────

function isGarbage(title) {
  return GARBAGE_PATTERNS.some((p) => p.test(title));
}

async function scrapeRSS(source) {
  console.log(`  [RSS] ${source.name}`);
  const xml = await fetch(source.url);
  const items = parseRSS(xml);
  const results = [];
  for (const item of items) {
    if (results.length >= 5) break; // cap per source per day — stop resolving once we have enough
    const title = cleanTitle(item.title);
    if (title.length < 16 || title.length > 180) continue;
    if (!containsKeywords(title + ' ' + item.desc, source.keywords)) continue;
    const desc = sanitizeDesc(item.desc, title);
    if (!isRealOpportunity(title, desc)) continue;
    const fullText = title + ' ' + desc;

    // Resolve the real program-principal apply link out of the aggregator's post.
    // If we can't confidently find one, skip this item — better to publish fewer,
    // correct flyers than ones that just point back at the blog/news post.
    const applyUrl = await resolveApplyUrl(item.link, title);
    if (!applyUrl) {
      console.log(`    ⏭️  Skipped (no resolvable apply link): ${title}`);
      continue;
    }

    results.push({
      id: slugify(item.title) + '-' + source.id,   // keep old id scheme so seen-ids.json stays valid
      titleSlug: titleSlugOf(title),                    // used for cross-source dedupe
      title,
      funder: extractFunder(title, ''),             // '' = unknown; templates handle it gracefully
      amount: extractAmount(fullText),
      deadline: extractDeadline(fullText),
      eligibility: 'See who qualifies on the official page',
      category: categorize(fullText),
      description: desc,
      applyUrl,
      sourceUrl: item.link, // the aggregator post this was discovered on, kept for reference/debugging
      scope: 'Nigeria',
      source: source.id,
      discoveredOn: TODAY,
    });
  }
  return results;
}

async function scrapePage(source) {
  console.log(`  [PAGE] ${source.name}`);
  const html = await fetch(source.url);
  const headings = extractHeadings(html).filter((h) =>
    containsKeywords(h, source.keywords)
  );
  const links = extractLinks(html, source.url).filter((l) =>
    containsKeywords(l.text, source.keywords)
  );

  const seen = new Set();
  const results = [];
  for (const item of [...headings.map((h) => ({ text: h, url: source.url })), ...links]) {
    const id = slugify(item.text) + '-' + source.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const title = cleanTitle(item.text);
    if (!isRealOpportunity(title, '')) continue;
    results.push({
      id,
      titleSlug: titleSlugOf(title),
      title,
      funder: extractFunder(title, ''),
      amount: extractAmount(title),
      deadline: extractDeadline(title),
      eligibility: 'See who qualifies on the official page',
      category: categorize(title),
      description: `${title} is now open. Visit the official page for full details on who can apply, what you'll receive, and how to submit your application.`,
      applyUrl: item.url,
      scope: 'Nigeria',
      source: source.id,
      discoveredOn: TODAY,
    });
  }
  return results.slice(0, 3); // cap per source
}

async function main() {
  console.log(`\n🔍 FundFinder Scraper — ${TODAY}\n`);

  ensureDir(DATA_DIR);
  ensureDir(SUMMARY_DIR);

  // Load seen IDs
  const seenIds = new Set(loadJson(SEEN_FILE, []));
  // Title-slugs of everything already seen (ids are "<title-slug>-<source-id>")
  const SOURCE_ID_SUFFIX = new RegExp('-(' + SOURCES.map((s) => s.id).join('|') + ')$');
  const seenTitleSlugs = new Set([...seenIds].map((id) => id.replace(SOURCE_ID_SUFFIX, '')));

  // Load manual opportunities (never auto-scraped, always included)
  const manualOpps = loadJson(MANUAL_FILE, []);

  // Scrape all sources
  const discovered = [];
  for (const source of SOURCES) {
    try {
      let items = [];
      if (source.strategy === 'rss') {
        items = await scrapeRSS(source);
      } else if (source.strategy === 'page') {
        items = await scrapePage(source);
      }
      // Filter out already seen (by id, and by title-slug so the same story
      // from a different feed doesn't become a duplicate flyer)
      const newItems = items.filter(
        (i) =>
          !seenIds.has(i.id) &&
          !(i.titleSlug && seenTitleSlugs.has(i.titleSlug)) &&
          !discovered.some((d) => d.titleSlug && d.titleSlug === i.titleSlug)
      );
      console.log(`  → ${newItems.length} new from ${source.name}`);
      discovered.push(...newItems);
    } catch (err) {
      console.warn(`  ⚠️  ${source.name}: ${err.message}`);
    }
  }

  // Include manual opps that haven't been published yet
  const newManual = manualOpps.filter((o) => !seenIds.has(o.id));
  if (newManual.length) {
    console.log(`\n📋 ${newManual.length} manual opportunities to publish`);
    discovered.push(...newManual);
  }

  // Always write last-run.json — guarantees git always has something to commit
  fs.writeFileSync(LAST_RUN_FILE, JSON.stringify({
    lastRun: new Date().toISOString(),
    date: TODAY,
    newOpportunities: discovered.length,
  }, null, 2), 'utf8');
  console.log(`  💾 Updated data/last-run.json`);

  // Always update the "Last Run" date in opportunity-hub.html
  if (fs.existsSync(HUB_FILE)) {
    let hub = fs.readFileSync(HUB_FILE, 'utf8');
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const now = new Date();
    const dateStr = `${monthNames[now.getUTCMonth()]} ${now.getUTCDate()}`;
    hub = hub.replace(
      /(<div class="stat-num" id="last-run-date">)[^<]*/,
      `$1${dateStr}`
    );
    fs.writeFileSync(HUB_FILE, hub, 'utf8');
    console.log(`  📅 Updated "Last Run" date to ${dateStr}`);
  }

  if (discovered.length === 0) {
    console.log('\n✅ No new opportunities today — hub date updated.\n');
    // Still write a summary
    fs.writeFileSync(
      path.join(SUMMARY_DIR, `${TODAY}-summary.md`),
      `# FundFinder Daily Summary — ${TODAY}\n\nNo new opportunities found today. All sources checked.\n`
    );
    return;
  }

  console.log(`\n🎉 ${discovered.length} new opportunities found!\n`);

  // Generate flyer HTML files & collect cards
  const newCards = [];
  for (const opp of discovered) {
    opp.slug = `opportunity-${slugify(opp.title)}-${TODAY}`;
    const flyerPath = path.join(ROOT, `${opp.slug}.html`);
    fs.writeFileSync(flyerPath, generateFlyer(opp));
    console.log(`  ✅ Created ${opp.slug}.html`);
    newCards.push(generateCard(opp));
    seenIds.add(opp.id);
    if (opp.titleSlug) seenIds.add(opp.titleSlug); // dedupe same story from other feeds in future runs
  }

  // Write social caption files for the top opportunities (max 3/day).
  // The social poster picks up files named <YYYY-MM-DD>-*.txt
  const ranked = [...discovered].sort((a, b) => {
    const score = (o) => (o.amount !== 'See details' ? 2 : 0) + (o.deadline !== 'Check official page' ? 1 : 0);
    return score(b) - score(a);
  });
  for (const opp of ranked.slice(0, 3)) {
    const capPath = path.join(ROOT, `${TODAY}-${slugify(opp.title).slice(0, 50)}.txt`);
    fs.writeFileSync(capPath, generateCaption(opp), 'utf8');
    console.log(`  📣 Caption written: ${path.basename(capPath)}`);
  }

  // Inject cards into opportunity-hub.html
  if (fs.existsSync(HUB_FILE)) {
    let hub = fs.readFileSync(HUB_FILE, 'utf8');
    if (hub.includes(HUB_INSERT_MARKER)) {
      const injection = newCards.join('\n') + '\n    ' + HUB_INSERT_MARKER;
      hub = hub.replace(HUB_INSERT_MARKER, injection);
      fs.writeFileSync(HUB_FILE, hub, 'utf8');
      console.log(`\n  📄 Injected ${newCards.length} cards into opportunity-hub.html`);
    } else {
      console.warn('\n  ⚠️  Insert marker not found in opportunity-hub.html — skipping hub update.');
      console.warn(`  Add this comment to the hub HTML where new cards should appear:`);
      console.warn(`  ${HUB_INSERT_MARKER}`);
    }
  }

  // Upsert new opportunities to Supabase (slug used as unique key for merge-duplicates)
  await upsertOpportunitiesToSupabase(discovered);

  // Save updated seen IDs
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seenIds], null, 2));

  // Write daily summary markdown
  const summaryLines = [
    `# FundFinder Daily Summary — ${TODAY}`,
    '',
    `**${discovered.length} new opportunities discovered**`,
    '',
    ...discovered.map(
      (o) =>
        `- **${o.title}** (${o.funder}) — ${o.amount} — [Apply](${o.applyUrl})`
    ),
    '',
    `_Scraped automatically by FundFinder AI. Live at [fundfinder.ng](https://fundfinder.ng)_`,
  ];
  fs.writeFileSync(
    path.join(SUMMARY_DIR, `${TODAY}-summary.md`),
    summaryLines.join('\n')
  );

  console.log(`\n✅ Done. Summary saved to summaries/${TODAY}-summary.md\n`);
}

main().catch((err) => {
  console.error('❌ Scraper failed:', err);
  process.exit(1);
});
