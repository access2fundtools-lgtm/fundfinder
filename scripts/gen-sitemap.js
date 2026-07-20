#!/usr/bin/env node
// Regenerates sitemap.xml from the public *.html files in the repo root.
// Run by the daily scrape workflow so new opportunity pages are indexed automatically.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://fundfinder.ng';
const NOINDEX = new Set([
  'admin.html','admin-briefs.html','export-flyers.html','fundfinder-auth.html',
  'fundfinder-chat.html','fundfinder-dashboard.html','fundfinder-growth-suite.html',
  'fundfinder-profile.html','fundfinder-wallet.html','program-principal-register.html'
]);
const isOpp = fn => fn.startsWith('opportunity-') || /^20\d{2}-/.test(fn);
const dateFromName = (fn) => {
  const m = fn.match(/(20\d{2}-\d{2}-\d{2})/);
  if (m) return m[1];
  try { return new Date(fs.statSync(path.join(ROOT, fn)).mtime).toISOString().slice(0,10); }
  catch { return new Date().toISOString().slice(0,10); }
};
const meta = (fn) => {
  if (fn === 'index.html') return ['1.0','daily'];
  if (fn === 'opportunity-hub.html') return ['0.9','daily'];
  if (isOpp(fn)) return ['0.8','weekly'];
  return ['0.5','monthly'];
};
const loc = (fn) => fn === 'index.html' ? SITE + '/' : `${SITE}/${fn}`;

const files = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.html') && !NOINDEX.has(f))
  .sort();

const rows = files.map(fn => {
  const [pri, freq] = meta(fn);
  const lm = isOpp(fn) ? dateFromName(fn) : new Date(fs.statSync(path.join(ROOT, fn)).mtime).toISOString().slice(0,10);
  return `  <url>\n    <loc>${loc(fn)}</loc>\n    <lastmod>${lm}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${pri}</priority>\n  </url>`;
});

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml, 'utf8');
console.log(`🗺️  sitemap.xml regenerated with ${files.length} URLs`);
