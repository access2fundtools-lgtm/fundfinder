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
    return;
  }

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
