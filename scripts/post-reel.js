#!/usr/bin/env node
/**
 * post-reel.js — publishes the day's reel to the Facebook Page via the
 * Reels Publishing API (three-phase: start -> binary upload -> finish).
 *
 * Env (GitHub Actions secrets):
 *   FB_PAGE_ID      — numeric Page ID
 *   FB_PAGE_TOKEN   — long-lived Page access token with pages_manage_posts,
 *                     pages_read_engagement, pages_show_list
 *
 * Usage: node scripts/post-reel.js reels/reel-YYYY-MM-DD.mp4 reels/reel-YYYY-MM-DD-caption.txt
 *
 * LinkedIn note: no Reels product exists; org video posts need the
 * Community Management API (app review required). Until that approval
 * lands, LinkedIn is bridged manually or via the Zapier/Make layer.
 */
const fs = require('fs');

const GRAPH = 'https://graph.facebook.com/v21.0';
const PAGE_ID = process.env.FB_PAGE_ID;
const TOKEN = process.env.FB_PAGE_TOKEN;

async function jfetch(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`${url.split('?')[0]} -> ${r.status}: ${JSON.stringify(j.error || j)}`);
  return j;
}

async function main() {
  const [video, captionFile] = process.argv.slice(2);
  if (!PAGE_ID || !TOKEN) { console.log('FB_PAGE_ID / FB_PAGE_TOKEN not set — skipping post (render-only mode).'); return; }
  if (!video || !fs.existsSync(video)) throw new Error('video file missing: ' + video);
  const description = captionFile && fs.existsSync(captionFile)
    ? fs.readFileSync(captionFile, 'utf8').trim()
    : 'Today’s funding opportunities — free on https://fundfinder.ng';

  // Phase 1: start
  const start = await jfetch(`${GRAPH}/${PAGE_ID}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_phase: 'start', access_token: TOKEN }),
  });
  const { video_id, upload_url } = start;
  console.log('start ok, video_id:', video_id);

  // Phase 2: binary upload
  const buf = fs.readFileSync(video);
  await jfetch(upload_url, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${TOKEN}`,
      offset: '0',
      file_size: String(buf.length),
      'Content-Type': 'application/octet-stream',
    },
    body: buf,
  });
  console.log('upload ok:', buf.length, 'bytes');

  // Phase 3: finish + publish
  const fin = await jfetch(
    `${GRAPH}/${PAGE_ID}/video_reels?` + new URLSearchParams({
      access_token: TOKEN,
      video_id,
      upload_phase: 'finish',
      video_state: 'PUBLISHED',
      description,
    }), { method: 'POST' });
  console.log('publish ok:', JSON.stringify(fin));

  // Best-effort status check
  try {
    const st = await jfetch(`${GRAPH}/${video_id}?fields=status&access_token=${TOKEN}`);
    console.log('status:', JSON.stringify(st.status));
  } catch (e) { console.log('status check skipped:', e.message); }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
