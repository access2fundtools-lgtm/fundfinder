/**
 * FundFinder AI — landing-page gate.
 *
 * Added 2026-10-02 after two "opportunities" went live whose Apply button led to
 * uphillnews.com, a dead news domain now parked for sale on HugeDomains:
 *   - "[Watch] Why SMEs Are Not Getting Their Loans Approved"
 *   - "Preparing Your Business for Bank Loan"
 *
 * RULE (from Dayo): FundFinder only publishes a page if its Apply link lands on
 *   (a) an application / registration form for a funding opportunity, or
 *   (b) the funder's own page describing a programme that is currently open.
 * Anything else (news articles, blogs, videos, advice posts, ads/affiliate links,
 * parked or for-sale domains, dead links, closed calls) is never published.
 *
 * verifyLandingPage() actually FETCHES the apply URL, follows every redirect and
 * inspects the final page. Fail-closed: if we cannot positively confirm the page,
 * the item is not published.
 */
const https = require('https');
const http = require('http');

// ── Titles that are articles/advice/video, never an opportunity ───────────────
const ARTICLE_TITLE_PATTERNS = [
  /^\s*\[(watch|video|listen|podcast|read|opinion|op-ed|explainer)\]/i,
  /^\s*(watch|video|podcast)\s*[:\-|]/i,
  /^\s*(why|how|what|when|where|should|can|is|are|do|does)\b/i,
  /\b(all you need to know|everything you need to know|things to know|tips (for|to|on)|ways to|steps to|guide to|beginner'?s guide)\b/i,
  /^\s*preparing (your|for)\b/i,
  /\bquick loans?\b/i,
  /\b(expand|grow|scale) your business with\b/i,
  /\bwhy it is a good option\b/i,
  /\bmutual fund(ing|s)? in nigeria\b/i,
  /\b(loan apps?|instant loans?) in nigeria\b/i,
];

// ── Hosts that are never an application page ──────────────────────────────────
// Domain parking / registrar "for sale" landers.
const PARKED_HOSTS = [
  'hugedomains.com', 'sedo.com', 'sedoparking.com', 'dan.com', 'afternic.com', 'godaddy.com',
  'bodis.com', 'parkingcrew.net', 'above.com', 'uniregistry.com', 'domainmarket.com',
  'buydomains.com', 'undeveloped.com', 'domainnamesales.com', 'brandbucket.com', 'squadhelp.com',
  'atom.com', 'efty.com', 'sav.com', 'namecheap.com', 'porkbun.com', 'parked.com',
  'domainlore.co.uk', 'perfectdomain.com', 'epik.com', 'dynadot.com', 'spaceship.com',
];
// News / blogs / aggregators / affiliate funnels seen in bad listings.
const NON_APPLY_HOSTS = [
  'uphillnews.com', 'oyaschool.com', 'oyaop.com', 'opportunitydesk.org', 'fundsforngos.org',
  'msmeafricaonline.com', 'entrepreneurs.ng', 'afterschoolafrica.com', 'opportunitiesforafricans.com',
  'smedigest.com.ng', 'reputiva.ng', 'reputiva.com', 'youtube.com', 'youtu.be', 'facebook.com', 'instagram.com',
  'tiktok.com', 'x.com', 'twitter.com', 't.me', 'whatsapp.com', 'wa.me', 'linkedin.com',
  'punchng.com', 'vanguardngr.com', 'guardian.ng', 'thisdaylive.com', 'premiumtimesng.com',
  'businessday.ng', 'nairametrics.com', 'techcabal.com', 'techpoint.africa', 'legit.ng',
  'dailypost.ng', 'channelstv.com', 'thecable.ng', 'leadership.ng', 'tribuneonlineng.com',
  'medium.com', 'blogspot.com', 'wordpress.com', 'news.google.com', 'bit.ly-preview.invalid',
];
// Hosted form builders: a form is exactly what we want.
const FORM_HOSTS = [
  'forms.gle', 'docs.google.com', 'forms.office.com', 'typeform.com', 'jotform.com', 'airtable.com',
  'smapply.io', 'smapply.org', 'submittable.com', 'fluxx.io', 'f6s.com', 'tally.so', 'paperform.co',
  'formstack.com', 'cognitoforms.com', 'zohopublic.com', 'surveymonkey.com', 'gust.com',
  'wufoo.com', 'hsforms.com', 'formsite.com', 'kobotoolbox.org', 'reviewr.com', 'good-grants.com',
];

const PARKED_BODY_RE = /(this domain (name )?(is|may be) for sale|buy this domain|domain is for sale|make an offer on this domain|the domain .{0,40} is for sale|is available for purchase|parked free|this domain is parked|domain has expired|this web page is parked|start your payment plan|domain profile|hugedomains)/i;
const CLOSED_BODY_RE = /(applications? (are|is) (now )?closed|application (period|window) (has )?closed|no longer accepting (responses|applications)|this form is no longer accepting|call (is|has) (now )?closed|submissions? (are|is) (now )?closed|registration (is|has) (now )?closed)/i;
const APPLY_SIGNAL_RE = /\b(apply( now| here| online| today)?|application( form| portal)?|applications? (open|close|deadline)|register|registration|submit (your|an) (application|proposal)|eligibility|eligible|who can apply|call for (applications|proposals)|deadline|enrol|sign up)\b/gi;
const PROGRAM_SIGNAL_RE = /\b(grants?|funding|fund|loans?|prize|award|fellowship|accelerator|incubat\w*|programme|program|challenge|competition|cohort|investment|seed|equity|bootcamp)\b/i;

function hostOf(url) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } }
function hostMatches(host, list) { return list.some((d) => host === d || host.endsWith('.' + d)); }

function isArticleTitle(title) { return ARTICLE_TITLE_PATTERNS.some((p) => p.test(title || '')); }

/** GET with redirect following; resolves {status, finalUrl, body, chain}. */
function fetchFinal(url, { timeoutMs = 15000, maxHops = 8 } = {}) {
  const chain = [];
  const go = (u, hops) => new Promise((resolve, reject) => {
    let client;
    try { client = new URL(u).protocol === 'http:' ? http : https; } catch (e) { return reject(e); }
    chain.push(u);
    const req = client.get(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 FundFinderBot/1.1',
        Accept: 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'en',
      },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < maxHops) {
        res.resume();
        let next; try { next = new URL(res.headers.location, u).href; } catch { return reject(new Error('bad redirect')); }
        return go(next, hops + 1).then(resolve, reject);
      }
      let body = ''; let size = 0;
      res.setEncoding('utf8');
      res.on('data', (c) => { size += c.length; if (size < 1_500_000) body += c; });
      res.on('end', () => resolve({ status: res.statusCode, finalUrl: u, body, chain }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
  return go(url, 0);
}

function textOf(html) {
  return (html || '').replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * @returns {Promise<{ok:boolean, definitive:boolean, reason:string, finalUrl?:string}>}
 *  definitive=true means the page is certainly bad (safe to unpublish an existing listing);
 *  definitive=false means "could not confirm" (block new items, but don't remove old ones).
 */
async function verifyLandingPage(url, title = '') {
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, definitive: true, reason: 'no apply URL' };
  if (isArticleTitle(title)) return { ok: false, definitive: true, reason: 'title is an article/video/advice post, not an opportunity' };
  if (/[?&]utm_source=oyaop\b/i.test(url)) return { ok: false, definitive: true, reason: 'affiliate/ad link (utm_source=oyaop)' };
  const startHost = hostOf(url);
  if (startHost.endsWith('.invalid') || startHost.endsWith('.example')) return { ok: false, definitive: true, reason: `placeholder URL (${startHost})` };
  if (hostMatches(startHost, PARKED_HOSTS)) return { ok: false, definitive: true, reason: `parked/registrar domain (${startHost})` };
  if (hostMatches(startHost, NON_APPLY_HOSTS)) return { ok: false, definitive: true, reason: `news/blog/aggregator/ad domain (${startHost})` };

  let r;
  try { r = await fetchFinal(url); } catch (e) {
    const dns = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|CERT|certificate/i.test(String(e && (e.code || e.message)));
    // DNS failure = domain no longer exists. Only treated as proof when running on an
    // unrestricted network (GitHub Actions sets FF_STRICT_DNS=1); sandboxes with egress
    // allowlists also report ENOTFOUND for perfectly live sites.
    const nx = /ENOTFOUND/.test(String(e && (e.code || e.message)));
    return { ok: false, definitive: nx && process.env.FF_STRICT_DNS === '1', reason: `unreachable (${(e && (e.code || e.message)) || 'error'})` };
  }
  const finalHost = hostOf(r.finalUrl);
  for (const hop of r.chain) {
    const h = hostOf(hop);
    if (hostMatches(h, PARKED_HOSTS)) return { ok: false, definitive: true, reason: `redirects to parked/for-sale domain (${h})`, finalUrl: r.finalUrl };
  }
  if (hostMatches(finalHost, NON_APPLY_HOSTS)) return { ok: false, definitive: true, reason: `lands on news/blog/aggregator/ad domain (${finalHost})`, finalUrl: r.finalUrl };
  if (r.status === 404 || r.status === 410) return { ok: false, definitive: true, reason: `HTTP ${r.status} (page gone)`, finalUrl: r.finalUrl };
  const text = textOf(r.body);
  if (PARKED_BODY_RE.test(text.slice(0, 20000)) || PARKED_BODY_RE.test(r.body.slice(0, 5000))) {
    return { ok: false, definitive: true, reason: 'landing page is a parked / domain-for-sale page', finalUrl: r.finalUrl };
  }
  if (r.status >= 400) {
    // 401/403/429/5xx: bot walls and outages. Can't confirm; don't treat as proof of bad.
    return { ok: false, definitive: false, reason: `HTTP ${r.status} (could not confirm)`, finalUrl: r.finalUrl };
  }
  if (CLOSED_BODY_RE.test(text.slice(0, 30000))) return { ok: false, definitive: false, reason: 'page says applications are closed', finalUrl: r.finalUrl };

  if (hostMatches(finalHost, FORM_HOSTS)) return { ok: true, definitive: true, reason: `application form (${finalHost})`, finalUrl: r.finalUrl };

  const applyHits = (text.match(APPLY_SIGNAL_RE) || []).length;
  const programHit = PROGRAM_SIGNAL_RE.test(text);
  if (applyHits >= 1 && programHit) return { ok: true, definitive: true, reason: `programme page with application signals (${applyHits})`, finalUrl: r.finalUrl };
  if (text.length < 400) return { ok: false, definitive: false, reason: 'page has almost no readable content (JS-only or blocked)', finalUrl: r.finalUrl };
  return { ok: false, definitive: false, reason: 'page shows no application/eligibility/deadline signals', finalUrl: r.finalUrl };
}

module.exports = { verifyLandingPage, isArticleTitle, fetchFinal, hostOf };
