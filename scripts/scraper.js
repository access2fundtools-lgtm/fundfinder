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

// ─── Config ──────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');          // repo root
const DATA_DIR = path.join(ROOT, 'data');
const SEEN_FILE = path.join(DATA_DIR, 'seen-ids.json');
const MANUAL_FILE = path.join(DATA_DIR, 'manual-opportunities.json');
const HUB_FILE = path.join(ROOT, 'opportunity-hub.html');
const SUMMARY_DIR = path.join(ROOT, 'summaries');

// Marker comment in opportunity-hub.html where new cards get injected
const HUB_INSERT_MARKER = '<!-- SCRAPER_AUTO_INSERT -->';

const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// ─── Sources ──────────────────────────────────────────────────────────────────
// Each source has a fetch strategy: 'rss', 'page', or 'manual'
const SOURCES = [
  {
    id: 'tef',
    name: 'Tony Elumelu Foundation',
    url: 'https://tonyelumelufoundation.org/tef-programme/',
    strategy: 'page',
    selector: 'h1, h2, h3',
    keywords: ['application', 'programme', 'grant', 'fund', 'open', 'apply'],
  },
  {
    id: 'boi',
    name: 'Bank of Industry',
    url: 'https://www.boi.ng/products/',
    strategy: 'page',
    selector: 'h2, h3, .product-title, .entry-title',
    keywords: ['loan', 'fund', 'financing', 'grant', 'msme', 'sme'],
  },
  {
    id: 'nirsal',
    name: 'NIRSAL',
    url: 'https://nirsal.com/products/',
    strategy: 'page',
    selector: 'h2, h3, .product-name',
    keywords: ['facility', 'loan', 'fund', 'agriculture', 'agric'],
  },
  {
    id: 'nitda',
    name: 'NITDA',
    url: 'https://nitda.gov.ng/ncc/',
    strategy: 'page',
    selector: 'h2, h3, a',
    keywords: ['fund', 'grant', 'startup', 'tech', 'call', 'open'],
  },
  {
    id: 'lsetf',
    name: 'Lagos State Employment Trust Fund',
    url: 'https://lsetf.ng/loan-and-grants',
    strategy: 'page',
    selector: 'h2, h3, .title',
    keywords: ['loan', 'grant', 'fund', 'apply', 'open'],
  },
  {
    id: 'smedan',
    name: 'SMEDAN',
    url: 'https://smedan.gov.ng/programmes/',
    strategy: 'page',
    selector: 'h2, h3, .entry-title',
    keywords: ['programme', 'fund', 'grant', 'loan', 'support'],
  },
  // Google News RSS — catches press releases from CBN, FMITI, NDE, YouWiN
  {
    id: 'gnews-ng-funding',
    name: 'Google News — Nigeria Funding',
    url: 'https://news.google.com/rss/search?q=Nigeria+grant+fund+entrepreneurs+2025+OR+2026&hl=en-NG&gl=NG&ceid=NG:en',
    strategy: 'rss',
    keywords: ['grant', 'fund', 'loan', 'empowerment', 'sme', 'msme', 'startup', 'entrepreneur'],
  },
  {
    id: 'gnews-cbn',
    name: 'Google News — CBN Schemes',
    url: 'https://news.google.com/rss/search?q=CBN+SMEDAN+BOI+Nigeria+SME+fund+2026&hl=en-NG&gl=NG&ceid=NG:en',
    strategy: 'rss',
    keywords: ['cbn', 'smedan', 'boi', 'fund', 'grant', 'loan', 'nigeria'],
  },
];

// ─── Utilities ────────────────────────────────────────────────────────────────

function fetch(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; FundFinderBot/1.0; +https://opportunities.a2fpartners.com)',
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
  const naira = text.match(/₦[\d,]+(?:\s*(?:million|billion|M|B))?/i);
  if (naira) return naira[0];
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
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${opp.title} — FundFinder AI | A2F Partners</title>
<meta property="og:title" content="${opp.title} — FundFinder AI">
<meta property="og:description" content="${opp.description}">
<meta name="description" content="${opp.description}">
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
  <div class="hero-amount">${opp.amount}</div>
  <div class="hero-title">${opp.title}</div>
  <div class="hero-funder">by ${opp.funder}</div>
</div>

<div class="content">

  <div class="section">
    <h2>Key Details</h2>
    <ul class="meta-list">
      <li><span class="icon">⏰</span><span><strong>Deadline:</strong> ${opp.deadline}</span></li>
      <li><span class="icon">👤</span><span><strong>Who can apply:</strong> ${opp.eligibility}</span></li>
      <li><span class="icon">💰</span><span><strong>Amount:</strong> ${opp.amount}</span></li>
      <li><span class="icon">🏛️</span><span><strong>Funder:</strong> ${opp.funder}</span></li>
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
        <div class="card-amount">${opp.amount}</div>
        <div class="card-badges">
          <span class="badge ${badgeColor}">${opp.category.charAt(0).toUpperCase() + opp.category.slice(1)}</span>
          <span class="badge badge-nigeria">🇳🇬 Nigeria</span>
        </div>
        <div class="card-funder">${opp.funder}</div>
        <div class="card-title">${opp.title}</div>
      </div>
      <div class="card-body">
        <div class="card-meta">
          <div class="meta-row">⏰ <span><strong>Deadline:</strong> ${opp.deadline}</span></div>
          <div class="meta-row">👤 <span>${opp.eligibility}</span></div>
          <div class="meta-row">💰 <span>${opp.amount}</span></div>
          <div class="meta-row">🌍 <span>${opp.scope || 'Nigeria eligible'}</span></div>
        </div>
        <span class="card-cta">View Details &amp; Apply →</span>
      </div>
    </a>`;
}

// ─── Main scraper logic ───────────────────────────────────────────────────────

async function scrapeRSS(source) {
  console.log(`  [RSS] ${source.name}`);
  const xml = await fetch(source.url);
  const items = parseRSS(xml);
  const matches = items.filter((item) =>
    containsKeywords(item.title + ' ' + item.desc, source.keywords)
  );
  return matches.map((item) => ({
    id: slugify(item.title) + '-' + source.id,
    title: item.title,
    funder: source.name,
    amount: extractAmount(item.title + ' ' + item.desc),
    deadline: 'See source',
    eligibility: 'Nigerian entrepreneurs and businesses',
    category: categorize(item.title + ' ' + item.desc),
    description: item.desc.slice(0, 500) || item.title,
    applyUrl: item.link,
    scope: 'Nigeria',
    source: source.id,
    discoveredOn: TODAY,
  }));
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
    results.push({
      id,
      title: item.text,
      funder: source.name,
      amount: extractAmount(item.text),
      deadline: 'See official site',
      eligibility: 'Nigerian businesses and entrepreneurs',
      category: categorize(item.text),
      description: `${source.name} has announced: "${item.text}". Visit the official site for full details, eligibility criteria, and how to apply.`,
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
      // Filter out already seen
      const newItems = items.filter((i) => !seenIds.has(i.id));
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

  if (discovered.length === 0) {
    console.log('\n✅ No new opportunities today — hub unchanged.\n');
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
    `_Scraped automatically by FundFinder AI. Live at [opportunities.a2fpartners.com](https://opportunities.a2fpartners.com)_`,
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
