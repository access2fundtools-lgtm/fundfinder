#!/usr/bin/env node
/**
 * FundFinder AI — one-off Supabase backfill for previously published opportunities.
 *
 * WHY THIS EXISTS
 * The scraper only upserts the opportunities it discovers *on that run*
 * (scripts/scraper.js -> upsertOpportunitiesToSupabase(discovered)).
 * The SUPABASE_SERVICE_KEY secret was only added to CI in mid-July 2026, so every
 * opportunity page published before then exists on the website but was never written
 * to public.opportunities — which means the matcher can't offer them to users.
 *
 * This script rebuilds those rows from what is already published in the repo
 * (opportunity-hub.html cards + each opportunity detail page) and upserts them
 * on the `slug` conflict target, exactly like the scraper does.
 *
 * SAFE BY DEFAULT: dry run. It prints what it would write and exits.
 *   node scripts/backfill-opportunities.js               # dry run, no writes
 *   SUPABASE_SERVICE_KEY=... node scripts/backfill-opportunities.js --commit
 *
 * Without SUPABASE_SERVICE_KEY the anon key is read-only, so --commit cannot
 * accidentally write anything.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HUB_FILE = path.join(ROOT, 'opportunity-hub.html');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zrkxigbmlprrowiofhjy.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_bLh6vRkyGXTZD2253Ll1wA_BSPy3S54';
const WRITE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const COMMIT = process.argv.includes('--commit');
const TODAY = new Date().toISOString().slice(0, 10);

// ─── tiny HTML helpers ────────────────────────────────────────────────────────
const decode = (s) =>
  s.replace(/&#0?38;/g, '&')
   .replace(/&amp;/g, '&')
   .replace(/&#8217;|&rsquo;/g, "'")
   .replace(/&#8216;|&lsquo;/g, "'")
   .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
   .replace(/&#8211;|&ndash;/g, '-')
   .replace(/&#8212;|&mdash;/g, '-')
   .replace(/&nbsp;/g, ' ')
   .replace(/&quot;/g, '"')
   .replace(/&lt;/g, '<')
   .replace(/&gt;/g, '>')
   .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));

const strip = (s) => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const pick = (html, re) => { const m = html.match(re); return m ? strip(m[1]) : ''; };

// ─── field derivation (mirrors scripts/scraper.js) ────────────────────────────
function capitalType(category) {
  return { grants: 'grant', loans: 'loan', investment: 'equity', training: 'training', empowerment: 'grant' }[category] || 'grant';
}
function parseDeadlineDate(text) {
  if (!text || ['See source', 'See official site', 'Open', 'Rolling', 'TBA'].includes(text)) return null;
  const d = new Date(text);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function detectGenderTarget(title, desc) {
  return /\b(women|female|girl|she)\b/.test((title + ' ' + desc).toLowerCase()) ? 'female' : 'all';
}
function requiresCac(title, desc) {
  return /\b(cac|registered (business|company)|incorporation)\b/.test((title + ' ' + desc).toLowerCase());
}
function requiresStudent(title, desc) {
  return /\b(student|undergraduate|postgraduate|academic|university|college)\b/.test((title + ' ' + desc).toLowerCase());
}

// ─── parse the hub cards ──────────────────────────────────────────────────────
function parseHubCards() {
  const hub = fs.readFileSync(HUB_FILE, 'utf8');
  const cards = [];
  const re = /<a class="card" href="([^"]+\.html)">([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(hub)) !== null) {
    const file = m[1];
    const body = m[2];
    if (!/^(opportunity-|20\d{2}-)/.test(file)) continue; // skip nav/CTA cards
    const topClass = (body.match(/class="card-top ([a-z]+)"/) || [])[1] || 'grants';
    const metas = [...body.matchAll(/<div class="meta-row">([\s\S]*?)<\/div>/g)].map((x) => strip(x[1]));
    const deadlineRaw = (metas.find((t) => /Deadline:/i.test(t)) || '').replace(/^.*Deadline:\s*/i, '').trim();
    cards.push({
      slug: file.replace(/\.html$/, ''),
      file,
      category: topClass,
      amount: pick(body, /class="card-amount">([\s\S]*?)<\/div>/) || 'See details',
      funder: pick(body, /class="card-funder">([\s\S]*?)<\/div>/),
      title: pick(body, /class="card-title">([\s\S]*?)<\/div>/),
      deadline: deadlineRaw || 'See official site',
      eligibility: metas[1] || '',
    });
  }
  // de-dupe by slug, keep first
  const seen = new Set();
  return cards.filter((c) => (seen.has(c.slug) ? false : (seen.add(c.slug), true)));
}

// ─── enrich from the detail page (apply URL + description) ─────────────────────
function enrich(card) {
  const p = path.join(ROOT, card.file);
  if (!fs.existsSync(p)) return { ...card, missingPage: true };
  const h = fs.readFileSync(p, 'utf8');
  const applyUrl = (h.match(/<a class="apply-btn" href="([^"]+)"/) || [])[1] || '';
  const description = pick(h, /<p class="desc">([\s\S]*?)<\/p>/);
  return { ...card, applyUrl, description };
}

function toRow(o) {
  return {
    slug: o.slug,
    title: o.title,
    source_url: o.applyUrl || null,
    apply_url: o.applyUrl || null,
    organiser: o.funder || null,
    summary: (o.description || '').slice(0, 600),
    capital_type: capitalType(o.category),
    sectors: [],
    amount_text: o.amount !== 'See details' ? o.amount : null,
    eligibility: o.eligibility || '',
    gender_target: detectGenderTarget(o.title, o.description || ''),
    requires_cac: requiresCac(o.title, o.description || ''),
    requires_student: requiresStudent(o.title, o.description || ''),
    target_states: [],
    target_sectors: [],
    deadline: parseDeadlineDate(o.deadline),
    scraped_at: (o.slug.match(/(20\d{2}-\d{2}-\d{2})$/) || [null, TODAY])[1],
    is_active: true,
  };
}

// ─── Supabase I/O ─────────────────────────────────────────────────────────────
function get(pathname) {
  return new Promise((resolve, reject) => {
    const u = new URL(pathname, SUPABASE_URL);
    https.get(
      { hostname: u.hostname, path: u.pathname + u.search, headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(`bad JSON [${res.statusCode}]: ${d.slice(0, 150)}`)); }
        });
      }
    ).on('error', reject);
  });
}

function upsert(rows) {
  return new Promise((resolve) => {
    const body = JSON.stringify(rows);
    const u = new URL('/rest/v1/opportunities', SUPABASE_URL);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          apikey: WRITE_KEY,
          Authorization: `Bearer ${WRITE_KEY}`,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () =>
          resolve(res.statusCode >= 200 && res.statusCode < 300 ? { ok: true } : { ok: false, status: res.statusCode, body: d.slice(0, 300) })
        );
      }
    );
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(body);
    req.end();
  });
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const cards = parseHubCards().map(enrich);
  const bad = cards.filter((c) => c.missingPage || !c.title || !c.applyUrl);
  const good = cards.filter((c) => !c.missingPage && c.title && c.applyUrl);

  const existing = new Set((await get('/rest/v1/opportunities?select=slug&limit=2000')).map((r) => r.slug));
  const rows = good.filter((c) => !existing.has(c.slug)).map(toRow);

  console.log(`\n🔍 hub cards parsed:        ${cards.length}`);
  console.log(`   usable (title+applyUrl): ${good.length}`);
  console.log(`   skipped (incomplete):    ${bad.length}${bad.length ? ' -> ' + bad.map((b) => b.slug).join(', ') : ''}`);
  console.log(`   already in Supabase:     ${existing.size}`);
  console.log(`   TO BACKFILL:             ${rows.length}\n`);

  rows.forEach((r) =>
    console.log(`   • ${r.capital_type.padEnd(8)} ${(r.organiser || '—').slice(0, 28).padEnd(30)} ${r.title.slice(0, 60)}`)
  );

  fs.writeFileSync(path.join(ROOT, 'data', 'backfill-preview.json'), JSON.stringify(rows, null, 2));
  console.log(`\n📝 Full preview written to data/backfill-preview.json`);

  if (!COMMIT) {
    console.log('\n💤 DRY RUN — nothing written. Re-run with --commit and SUPABASE_SERVICE_KEY set to apply.\n');
    return;
  }
  if (!WRITE_KEY) {
    console.error('\n❌ --commit given but SUPABASE_SERVICE_KEY is not set. The anon key cannot write. Aborting.\n');
    process.exit(1);
  }
  for (let i = 0; i < rows.length; i += 25) {
    const batch = rows.slice(i, i + 25);
    const res = await upsert(batch);
    console.log(res.ok ? `   ✅ upserted ${batch.length}` : `   ⚠️  batch failed: ${JSON.stringify(res)}`);
  }
  const after = (await get('/rest/v1/opportunities?select=slug&limit=2000')).length;
  console.log(`\n✅ Done. opportunities rows now visible to anon: ${after}\n`);
}

main().catch((e) => {
  console.error('❌ backfill failed:', e.message);
  process.exit(1);
});
