#!/usr/bin/env node
/**
 * make-reel.js — renders the daily FundFinder compilation reel.
 *
 * Reads the newest opportunity-*.html pages (published by the scraper),
 * extracts title / funder / amount / deadline, renders branded 1080x1920
 * cards as SVG -> PNG (ImageMagick), and assembles a ~21s vertical MP4
 * with a music bed (ffmpeg). Also writes a ready-to-post caption.
 *
 * Music: Kevin MacLeod (incompetech.com), CC BY 4.0 — attribution is
 * baked into the caption and the end card. Tracks live in assets/reel-music/.
 *
 * Usage:  node scripts/make-reel.js [--count 3] [--out reels/]
 * Output: reels/reel-YYYY-MM-DD.mp4 + reels/reel-YYYY-MM-DD-caption.txt
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = argVal('--out') || path.join(ROOT, 'reels');
const COUNT = parseInt(argVal('--count') || '3', 10);
const MUSIC_DIR = path.join(ROOT, 'assets', 'reel-music');
const SITE = 'https://fundfinder.ng';

const GOLD = '#FFD700';
const BG = '#0B0B0F';
const CARD = '#15151C';
const MUTED = '#9AA0AC';
const W = 1080, H = 1920;
const FPS = 30;
const INTRO_S = 3.0, CARD_S = 5.0, CTA_S = 3.5;

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}
function sh(cmd) { execSync(cmd, { stdio: ['ignore', 'pipe', 'inherit'], cwd: ROOT }); }
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function clip(s, n) { s = String(s).trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }

// Split a string into <=maxChars lines, <=maxLines total.
function wrap(s, maxChars, maxLines) {
  const words = String(s).trim().split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length <= maxChars) cur = (cur + ' ' + w).trim();
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = clip(lines[maxLines - 1], maxChars - 1) ;
    if (!lines[maxLines - 1].endsWith('…')) lines[maxLines - 1] += '…';
  }
  return lines;
}

// ---------------------------------------------------------------- extraction
function latestOpportunities(count) {
  const files = fs.readdirSync(ROOT)
    .filter(f => /^opportunity-.*-\d{4}-\d{2}-\d{2}\.html$/.test(f))
    .map(f => ({ f, date: f.match(/(\d{4}-\d{2}-\d{2})\.html$/)[1] }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.f.localeCompare(b.f));

  const seenTitles = new Set();
  const out = [];
  for (const { f } of files) {
    const h = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const g = (re) => (h.match(re) || [, ''])[1].replace(/\s+/g, ' ').trim();
    let title = g(/<div class="hero-title">([^<]+)</);
    title = title.replace(/^call for applications:\s*/i, '').replace(/\s*\(\s*up to[^)]*\)\s*$/i, '');
    if (!title || seenTitles.has(title.toLowerCase())) continue;
    seenTitles.add(title.toLowerCase());
    out.push({
      file: f,
      title,
      funder: g(/<div class="hero-funder">(?:by\s*)?([^<]+)</),
      amount: g(/<strong>Amount:<\/strong>\s*([^<]+)</) || g(/<div class="hero-amount">([^<]+)</),
      deadline: g(/<strong>Deadline:<\/strong>\s*([^<]+)</) || 'See listing',
      url: `${SITE}/${f}`,
    });
    if (out.length === count) break;
  }
  return out;
}

// ------------------------------------------------------------------- SVG art
function svgShell(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${BG}"/><stop offset="1" stop-color="#101018"/>
  </linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#F5C400"/><stop offset="1" stop-color="#FFE066"/>
  </linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<circle cx="980" cy="140" r="340" fill="${GOLD}" opacity="0.05"/>
<circle cx="80" cy="1800" r="280" fill="${GOLD}" opacity="0.05"/>
${inner}
</svg>`;
}
const F = 'DejaVu Sans';
function txt(x, y, size, fill, weight, content, anchor = 'start', spacing = '') {
  return `<text x="${x}" y="${y}" font-family="${F}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}" ${spacing ? `letter-spacing="${spacing}"` : ''}>${content}</text>`;
}

function logoBlock(y) {
  return txt(W / 2, y, 64, '#FFFFFF', 'bold',
    `FUND<tspan fill="${GOLD}">FINDER</tspan> AI`, 'middle', '2');
}

function introSvg(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const nice = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return svgShell(`
${logoBlock(560)}
<rect x="${W / 2 - 90}" y="620" width="180" height="8" rx="4" fill="url(#gold)"/>
${txt(W / 2, 840, 92, '#FFFFFF', 'bold', "TODAY'S", 'middle')}
${txt(W / 2, 960, 92, GOLD, 'bold', 'FUNDING', 'middle')}
${txt(W / 2, 1080, 92, '#FFFFFF', 'bold', 'OPPORTUNITIES', 'middle')}
${txt(W / 2, 1230, 44, MUTED, 'normal', esc(nice), 'middle')}
${txt(W / 2, 1560, 40, MUTED, 'normal', 'Verified daily · Free for every founder', 'middle')}
`);
}

function oppSvg(o, idx, total) {
  const titleLines = wrap(o.title, 20, 3);
  const titleSvg = titleLines.map((l, i) =>
    txt(90, 720 + i * 100, 76, '#FFFFFF', 'bold', esc(l))).join('\n');
  const byY = 720 + titleLines.length * 100 + 10;
  const amountLines = wrap(o.amount || 'See listing', 32, 2);

  // offer box
  const boxY = 1140;
  const boxH = 150 + amountLines.length * 60;
  const amountSvg = amountLines.map((l, i) =>
    txt(150, boxY + 130 + i * 60, 48, GOLD, 'bold', esc(l))).join('\n');
  // deadline box
  const dY = boxY + boxH + 40;
  return svgShell(`
${logoBlock(180)}
${txt(90, 420, 46, MUTED, 'normal', `Opportunity ${idx} of ${total}`, 'start', '4')}
<rect x="90" y="460" width="140" height="8" rx="4" fill="url(#gold)"/>
${titleSvg}
${txt(90, byY, 46, MUTED, 'normal', esc(clip('by ' + (o.funder || '—'), 42)))}
<rect x="70" y="${boxY}" width="${W - 140}" height="${boxH}" rx="28" fill="${CARD}" stroke="${GOLD}" stroke-opacity="0.25" stroke-width="2"/>
${txt(150, boxY + 62, 34, MUTED, 'normal', 'WHAT&apos;S ON OFFER')}
${amountSvg}
<rect x="70" y="${dY}" width="${W - 140}" height="160" rx="28" fill="${CARD}" stroke="${GOLD}" stroke-opacity="0.25" stroke-width="2"/>
${txt(150, dY + 62, 34, MUTED, 'normal', 'DEADLINE')}
${txt(150, dY + 118, 44, '#FFFFFF', 'bold', esc(clip(o.deadline, 38)))}
${txt(W / 2, 1730, 38, MUTED, 'normal', 'Full details + apply link on fundfinder.ng', 'middle')}
`);
}

function ctaSvg(count) {
  return svgShell(`
${logoBlock(700)}
<rect x="${W / 2 - 90}" y="760" width="180" height="8" rx="4" fill="url(#gold)"/>
${txt(W / 2, 940, 62, '#FFFFFF', 'bold', `${count} live programmes today`, 'middle')}
${txt(W / 2, 1060, 56, MUTED, 'normal', 'Browse, match &amp; apply — free', 'middle')}
<rect x="${W / 2 - 330}" y="1160" width="660" height="130" rx="65" fill="url(#gold)"/>
${txt(W / 2, 1245, 56, '#000000', 'bold', 'fundfinder.ng', 'middle')}
${txt(W / 2, 1800, 26, '#6B7280', 'normal', 'Music: Kevin MacLeod (incompetech.com) · CC BY 4.0', 'middle')}
`);
}

// --------------------------------------------------------------------- build
function main() {
  const today = new Date().toISOString().slice(0, 10);
  const opps = latestOpportunities(COUNT);
  if (!opps.length) { console.error('No opportunity pages found.'); process.exit(1); }

  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'reel-'));
  const frames = [];
  const add = (name, svg, dur) => {
    const svgP = path.join(tmp, name + '.svg');
    const pngP = path.join(tmp, name + '.png');
    fs.writeFileSync(svgP, svg);
    sh(`convert -density 96 -background none "${svgP}" "${pngP}"`);
    frames.push({ png: pngP, dur });
  };

  add('00-intro', introSvg(today), INTRO_S);
  opps.forEach((o, i) => add(`0${i + 1}-opp`, oppSvg(o, i + 1, opps.length), CARD_S));
  add('99-cta', ctaSvg(opps.length), CTA_S);

  // music: rotate deterministically by date
  const tracks = fs.existsSync(MUSIC_DIR)
    ? fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith('.mp3')).sort() : [];
  const dayNum = parseInt(today.replace(/-/g, ''), 10);
  const track = tracks.length ? path.join(MUSIC_DIR, tracks[dayNum % tracks.length]) : null;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outMp4 = path.join(OUT_DIR, `reel-${today}.mp4`);

  // Build filtergraph: each still gets a gentle Ken Burns zoom, then xfade chain.
  const XF = 0.5; // crossfade seconds
  let inputs = '', filters = '', labels = [];
  frames.forEach((f, i) => {
    inputs += ` -loop 1 -framerate ${FPS} -t ${f.dur + XF} -i "${f.png}"`;
    // upscale for smooth zoompan, slow zoom in (even) / out (odd)
    const zoom = i % 2 === 0
      ? `z='min(1.0+0.04*on/(${FPS}*${f.dur + XF}),1.08)'`
      : `z='max(1.08-0.04*on/(${FPS}*${f.dur + XF}),1.0)'`;
    filters += `[${i}:v]scale=2160:3840,zoompan=${zoom}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},format=yuv420p[v${i}];`;
    labels.push(`v${i}`);
  });
  let prev = labels[0], offset = 0;
  for (let i = 1; i < labels.length; i++) {
    offset += frames[i - 1].dur;
    const outL = i === labels.length - 1 ? 'vout' : `x${i}`;
    filters += `[${prev}][${labels[i]}]xfade=transition=fade:duration=${XF}:offset=${offset}[${outL}];`;
    prev = outL;
  }
  const totalDur = frames.reduce((s, f) => s + f.dur, 0) + XF;

  let audioIn = '', audioMap = '';
  if (track) {
    inputs += ` -i "${track}"`;
    const aIdx = frames.length;
    filters += `[${aIdx}:a]atrim=0:${totalDur},afade=t=in:st=0:d=0.8,afade=t=out:st=${(totalDur - 1.2).toFixed(1)}:d=1.2,volume=0.9[aout];`;
    audioMap = `-map "[aout]" -c:a aac -b:a 128k`;
  }
  filters = filters.replace(/;$/, '');

  sh(`ffmpeg -y${inputs} -filter_complex "${filters}" -map "[vout]" ${audioMap} -c:v libx264 -preset medium -crf 21 -r ${FPS} -movflags +faststart -t ${totalDur} "${outMp4}"`);

  // caption
  const capLines = [
    `🇳🇬 Today's funding opportunities — ${today}`,
    '',
    ...opps.map(o => `• ${o.title} (${o.funder}) — deadline: ${o.deadline}`),
    '',
    `Full details & apply links, free: ${SITE}`,
    '',
    '#FundingOpportunities #NigerianStartups #SMEfunding #FundFinderAI',
    '',
    'Music: Kevin MacLeod (incompetech.com), licensed under CC BY 4.0',
  ];
  const capPath = path.join(OUT_DIR, `reel-${today}-caption.txt`);
  fs.writeFileSync(capPath, capLines.join('\n'));

  console.log(JSON.stringify({ video: outMp4, caption: capPath, duration: totalDur, opportunities: opps.map(o => o.title), track: track && path.basename(track) }, null, 2));
}

main();
