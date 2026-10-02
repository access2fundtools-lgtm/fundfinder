/**
 * FundFinder AI — audit every published opportunity page against the landing-page gate.
 *
 *   node scripts/audit-published.js            # report only
 *   node scripts/audit-published.js --commit   # also unpublish pages that DEFINITELY fail
 *
 * Unpublish = delete the opportunity-*.html page, remove its card from opportunity-hub.html,
 * delete any caption .txt pointing at it, record it in data/removed-opportunities.json and,
 * when SUPABASE_SERVICE_KEY is set, flip is_active=false for that slug.
 * Pages that merely "could not be confirmed" (bot walls, timeouts) are reported, not removed.
 * Run gen-sitemap.js and gen-ticker.js afterwards (the workflow does).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { verifyLandingPage } = require('./verify-landing');

const ROOT = path.resolve(__dirname, '..');
const HUB = path.join(ROOT, 'opportunity-hub.html');
const ARCHIVE = path.join(ROOT, 'opportunity-archive.html');
const REMOVED = path.join(ROOT, 'data', 'removed-opportunities.json');
const REPORT = path.join(ROOT, 'data', 'landing-audit.json');
const COMMIT = process.argv.includes('--commit');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zrkxigbmlprrowiofhjy.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function deactivate(slug) {
  if (!SERVICE_KEY) return Promise.resolve('skipped (no service key)');
  return new Promise((resolve) => {
    const body = JSON.stringify({ is_active: false });
    const u = new URL(`${SUPABASE_URL}/rest/v1/opportunities?slug=eq.${encodeURIComponent(slug)}`);
    const req = https.request(u, { method: 'PATCH', headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json',
      Prefer: 'return=minimal', 'Content-Length': Buffer.byteLength(body) } },
      (res) => { res.resume(); res.on('end', () => resolve(`HTTP ${res.statusCode}`)); });
    req.on('error', (e) => resolve('error ' + e.message));
    req.end(body);
  });
}

function removeCard(file, slug) {
  if (!fs.existsSync(file)) return 0;
  let html = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`(\\s*<!-- AUTO:[^>]*-->)?\\s*<a class="card" href="${esc(slug)}\\.html">[\\s\\S]*?<\\/a>`, 'g');
  const n = (html.match(re) || []).length;
  if (n) fs.writeFileSync(file, html.replace(re, ''), 'utf8');
  return n;
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

(async () => {
  const files = fs.readdirSync(ROOT).filter((f) => /^opportunity-.*\.html$/.test(f) && !/^opportunity-(hub|archive)\.html$/.test(f));
  const rows = files.map((f) => {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const title = ((html.match(/<title>([^<]*)/) || [])[1] || '').split(' — FundFinder')[0].trim();
    const href = ((html.match(/class="apply-btn"[^>]*href="([^"]+)"/) || html.match(/href="([^"]+)"[^>]*class="apply-btn"/) || [])[1] || '').replace(/&amp;/g, '&');
    return { file: f, slug: f.replace(/\.html$/, ''), title, href };
  });
  console.log(`Auditing ${rows.length} published pages…`);
  const results = await pool(rows, 6, async (r) => (r.href
    ? { ...r, ...(await verifyLandingPage(r.href, r.title)) }
    // Hand-built pages use different button markup; a missing match is our parser, not proof.
    : { ...r, ok: false, definitive: false, reason: 'could not find the Apply button on the page (check manually)' }));

  const bad = results.filter((r) => !r.ok && r.definitive);
  const unsure = results.filter((r) => !r.ok && !r.definitive);
  console.log(`\nPASS ${results.length - bad.length - unsure.length} | REMOVE ${bad.length} | UNCONFIRMED ${unsure.length}\n`);
  for (const r of bad) console.log(`  ❌ ${r.title}\n     ${r.href}\n     → ${r.reason}`);
  for (const r of unsure) console.log(`  ⚠️  ${r.title}\n     ${r.href}\n     → ${r.reason}`);

  fs.writeFileSync(REPORT, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));

  if (COMMIT && bad.length) {
    const removed = fs.existsSync(REMOVED) ? JSON.parse(fs.readFileSync(REMOVED, 'utf8')) : [];
    for (const r of bad) {
      fs.unlinkSync(path.join(ROOT, r.file));
      const cards = removeCard(HUB, r.slug) + removeCard(ARCHIVE, r.slug);
      const caps = fs.readdirSync(ROOT).filter((f) => /^\d{4}-\d{2}-\d{2}-.*\.txt$/.test(f) && fs.readFileSync(path.join(ROOT, f), 'utf8').includes(r.slug));
      caps.forEach((c) => fs.unlinkSync(path.join(ROOT, c)));
      const sb = await deactivate(r.slug);
      removed.push({ slug: r.slug, title: r.title, href: r.href, reason: r.reason, removedOn: new Date().toISOString().slice(0, 10), supabase: sb });
      console.log(`  🗑️  ${r.slug} (cards ${cards}, captions ${caps.length}, supabase ${sb})`);
    }
    fs.writeFileSync(REMOVED, JSON.stringify(removed, null, 2));
  }

  // Pages removed while no Supabase key was available (e.g. a local run): deactivate now.
  if (COMMIT && SERVICE_KEY && fs.existsSync(REMOVED)) {
    const removed = JSON.parse(fs.readFileSync(REMOVED, 'utf8'));
    let changed = false;
    for (const r of removed) {
      if (/^HTTP 2/.test(r.supabase || '')) continue;
      r.supabase = await deactivate(r.slug); changed = true;
      console.log(`  🔕 Supabase deactivate ${r.slug}: ${r.supabase}`);
    }
    if (changed) fs.writeFileSync(REMOVED, JSON.stringify(removed, null, 2));
  }
})();
