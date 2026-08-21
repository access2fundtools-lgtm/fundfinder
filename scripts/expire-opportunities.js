#!/usr/bin/env node
/**
 * FundFinder AI — expiry sweep for public.opportunities.
 *
 * WHY THIS EXISTS
 * Nothing in the stack ever flipped `is_active` to false. The scraper only ever
 * writes `is_active: true`, so a call that closed months ago stayed in the pool
 * that fundfinder-profile.html's matching engine reads — which meant closed calls
 * were being scored and written into users' opportunity_matches rows.
 * (QA run 2026-08-05 found 1 such row live: the FCMB AgriTech Hackathon, deadline
 * 2026-07-31.) The client-side query now filters expired rows too; this sweep is
 * the server-side half, so the data itself stays clean.
 *
 * WHAT IT TOUCHES — deliberately narrow:
 *   - only rows where is_active = true
 *   - only rows with a NON-NULL deadline (NULL = rolling/evergreen programme:
 *     Y Combinator, Antler, the A2F principal programmes. Never deactivate those.)
 *   - only rows whose deadline is more than GRACE_DAYS in the past, so a slightly
 *     mis-parsed date or a last-minute extension cannot kill a live opportunity.
 *
 * SAFE BY DEFAULT: dry run. Prints what it would change and exits.
 *   node scripts/expire-opportunities.js               # dry run, no writes
 *   SUPABASE_SERVICE_KEY=... node scripts/expire-opportunities.js --commit
 *
 * Without SUPABASE_SERVICE_KEY the anon key is read-only, so --commit cannot
 * accidentally write anything.
 */

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zrkxigbmlprrowiofhjy.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_bLh6vRkyGXTZD2253Ll1wA_BSPy3S54';
const WRITE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const COMMIT = process.argv.includes('--commit');

// Days of slack after the stated deadline before a row is retired.
const GRACE_DAYS = 7;

// Evergreen rows (deadline IS NULL) were previously exempt from every sweep, on
// the assumption that "no deadline" means "always open". 2026-08-21 disproved
// that: Cartier Women's Initiative (closed 16 Jun 2026), Standard Chartered
// Women in Tech (closed 26 Apr 2026) and AfDB YouthADAPT (no 2026 call) were all
// still being served to users as live opportunities, because each is an ANNUAL
// programme and so legitimately carries a NULL deadline.
//
// An undated listing needs a FRESHNESS check, not a deadline check. Anything not
// confirmed within STALE_DAYS is reported so it can be re-verified or captioned
// "verify before applying". This sweep only REPORTS undated rows — it never
// retires them, because a genuinely rolling programme must not be deleted.
const STALE_DAYS = 60;

const cutoff = new Date(Date.now() - GRACE_DAYS * 86400000).toISOString().slice(0, 10);

function request(method, pathAndQuery, key, body) {
  return new Promise((resolve) => {
    const u = new URL(pathAndQuery, SUPABASE_URL);
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    if (method === 'PATCH') headers.Prefer = 'return=minimal';

    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(data); } catch (e) { /* non-JSON body */ }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: parsed, raw: data });
        });
      }
    );
    req.on('error', (e) => resolve({ ok: false, status: 0, error: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

// Report undated ("evergreen") rows that have not been confirmed recently.
// Never writes. A rolling programme is legitimately undated — the risk is not
// that it is undated, but that nobody has checked it in months.
async function reportStaleEvergreen() {
  const staleCut = new Date(Date.now() - STALE_DAYS * 86400000).toISOString().slice(0, 10);
  const base = 'opportunities?is_active=eq.true&deadline=is.null&order=created_at.asc&select=';
  // Prefer verified_on; fall back to created_at so this works before the migration.
  let res = await request('GET', '/rest/v1/' + base + 'id,slug,title,verified_on,created_at', ANON_KEY);
  let haveVerified = res.ok && Array.isArray(res.body);
  if (!haveVerified) {
    res = await request('GET', '/rest/v1/' + base + 'id,slug,title,created_at', ANON_KEY);
    if (!res.ok || !Array.isArray(res.body)) {
      console.log('\u26a0\ufe0f  Could not read evergreen rows [' + res.status + '] — skipping freshness check.\n');
      return;
    }
    console.log('\u2139\ufe0f  verified_on column not present — using created_at instead.');
    console.log('    Run migrations/add-verified-on.sql for accurate freshness tracking.');
  }
  const stale = res.body.filter((o) => {
    const last = o.verified_on || (o.created_at || '').slice(0, 10);
    return !last || last < staleCut;
  });
  console.log('\u{1F50E} Evergreen freshness check — undated rows not confirmed since ' + staleCut + ':');
  if (!stale.length) { console.log('   \u2705 none stale.\n'); return; }
  stale.forEach((o) =>
    console.log('   \u00b7 last confirmed ' + ((o.verified_on || (o.created_at || '').slice(0, 10)) || 'never') +
                '  ' + (o.title || o.slug)));
  console.log('   \u2192 ' + stale.length + ' undated listing(s) need re-verification. These are still being shown');
  console.log('     to users as live opportunities. Confirm each, or caption them "verify before applying".\n');
}

async function main() {
  console.log('\n\u{1F9F9} FundFinder expiry sweep — retiring opportunities with a deadline before ' + cutoff + ' (' + GRACE_DAYS + '-day grace)\n');

  const q =
    'opportunities?is_active=eq.true&deadline=not.is.null&deadline=lt.' +
    cutoff +
    '&select=id,slug,title,deadline&order=deadline.asc';

  const read = await request('GET', '/rest/v1/' + q, ANON_KEY);
  if (!read.ok || !Array.isArray(read.body)) {
    console.error('❌ Could not read opportunities [' + read.status + ']: ' + (read.raw || read.error));
    process.exit(1);
  }

  const stale = read.body;
  if (!stale.length) {
    console.log('✅ Nothing to retire — no active opportunity is past its deadline.\n');
    await reportStaleEvergreen();
    return;
  }

  await reportStaleEvergreen();

  console.log('Found ' + stale.length + ' expired-but-active opportunit' + (stale.length === 1 ? 'y' : 'ies') + ':');
  stale.forEach((o) => console.log('  · ' + o.deadline + '  ' + (o.title || o.slug)));
  console.log('');

  if (!COMMIT) {
    console.log('DRY RUN — nothing written. Re-run with --commit (and SUPABASE_SERVICE_KEY set) to retire them.\n');
    return;
  }
  if (!WRITE_KEY) {
    console.error('❌ --commit given but SUPABASE_SERVICE_KEY is not set. The anon key is read-only; refusing to continue.\n');
    process.exit(1);
  }

  let retired = 0;
  for (const o of stale) {
    const res = await request(
      'PATCH',
      '/rest/v1/opportunities?id=eq.' + encodeURIComponent(o.id),
      WRITE_KEY,
      { is_active: false }
    );
    if (res.ok) {
      retired++;
      console.log('  ✅ retired  ' + (o.title || o.slug));
    } else {
      console.warn('  ⚠️  failed [' + res.status + ']  ' + o.slug + ': ' + (res.raw || '').slice(0, 160));
    }
  }

  console.log('\n✅ Expiry sweep done — ' + retired + '/' + stale.length + ' retired.\n');
}

main().catch((err) => {
  console.error('❌ Expiry sweep failed:', err);
  process.exit(1);
});
