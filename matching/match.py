#!/usr/bin/env python3
"""A2F group matching engine.

Reads every live FundFinder opportunity (structured JSON + published pages),
scores each one against the A2F group entity profiles, and writes matches.json.

Honest by design: where the scraper never captured eligibility text, the match
is labelled NEEDS-CHECK rather than being asserted as a fit.
"""
import json, re, glob, os, sys, datetime, html

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
TODAY = datetime.date.today()

PLACEHOLDER = "see who qualifies on the official page"

MONTHS = {m.lower(): i for i, m in enumerate(
    ["January","February","March","April","May","June","July",
     "August","September","October","November","December"], 1)}

def parse_deadline(s):
    if not s: return None
    s = s.strip()
    if re.search(r'rolling|ongoing|evergreen|continuous|not yet published|open until', s, re.I):
        return "ROLLING"
    m = re.search(r'(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})', s)            # 30 September 2026
    if m and m.group(2).lower() in MONTHS:
        return datetime.date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1)))
    m = re.search(r'([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})', s)          # September 30, 2026
    if m and m.group(1).lower() in MONTHS:
        return datetime.date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2)))
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})', s)
    if m: return datetime.date(*map(int, m.groups()))
    return None

AMT_PREFIX = re.compile(
    r'^(up to\s+)?(£|\$|₦|N|USD|NGN)?\s?[\d,.]+\s*(k|m|million|billion)?\s*'
    r'(\+)?\s*(equity-free|standard deal|prizes?|cheque|investment|grants?|funding|'
    r'acceleration|incubation|coaching|fellowship|investor [a-z ]+|seed[a-z /-]*|'
    r'series [a-z+]+[a-z ]*|pre-seed[a-z /-]*|subsidised[^A-Z]*|see details)?\s*'
    r'([+&][a-z ]+)?\s*', re.I)

def norm_title(t):
    prev = None
    while prev != t:
        prev = t
        t = AMT_PREFIX.sub('', t, count=1).strip(' -—:')
    return re.sub(r'[^a-z0-9]+', '', t.lower())[:60]

BOILER = [
    r'FundFinder AI surfaces opportunities.*?before applying\.?',
    r'FUND\s*FINDER\s*AI', r'FundFinder AI \| A2F Partners',
    r'← All Opportunities', r'Curated by A2F Partners.*?$',
    r'Built on principle\. Scaled by discipline\.',
]
def strip_tags(h):
    h = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', h, flags=re.S)
    h = re.sub(r'<[^>]+>', ' ', h)
    t = html.unescape(re.sub(r'\s+', ' ', h)).strip()
    for b in BOILER:
        t = re.sub(b, ' ', t, flags=re.I|re.S)
    return re.sub(r'\s+', ' ', t).strip()

def closed_titles():
    """Titles verified closed/not-yet-open. Page-sourced rows carry no status
    field, so they must be filtered by title or a retired programme leaks back in
    through its published HTML page."""
    p = os.path.join(ROOT, 'data', 'manual-opportunities.json')
    d = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else []
    recs = d if isinstance(d, list) else d.get('opportunities', [])
    out = set()
    for r in recs:
        if r.get('status') in ('closed', 'not_yet_open'):
            t = re.sub(r'[^a-z0-9]+', '', (r.get('title') or '').lower())
            if len(t) >= 12:
                out.add(t)
    return out

def load_opportunities():
    opps, seen = [], set()
    DEAD = closed_titles()
    # 1. structured records
    p = os.path.join(ROOT, 'data', 'manual-opportunities.json')
    if os.path.exists(p):
        d = json.load(open(p, encoding='utf-8'))
        recs = d if isinstance(d, list) else d.get('opportunities', [])
        for r in recs:
            key = norm_title((r.get('title') or '').strip())
            if not key or key in seen: continue
            seen.add(key)
            if r.get('status') in ('closed','not_yet_open'):
                continue                       # verified dead — never surface it
            opps.append({
                'verified_on': r.get('verified_on'), 'status': r.get('status','unverified'),
                'title': r.get('title',''), 'funder': r.get('funder',''),
                'category': r.get('category',''), 'amount': r.get('amount',''),
                'deadline_raw': str(r.get('deadline') or ''),
                'eligibility': r.get('eligibility') or '',
                'scope': r.get('scope',''), 'url': r.get('applyUrl',''),
                'text': ' '.join(str(r.get(k) or '') for k in
                                 ('title','category','eligibility','description','scope','funder')),
                'source': 'structured'})
    # 2. published pages
    SKIP = ('opportunity-hub', 'opportunity-index')
    for f in sorted(glob.glob(os.path.join(ROOT, 'opportunity-*.html'))):
        if any(k in os.path.basename(f) for k in SKIP): continue
        t = strip_tags(open(f, encoding='utf-8', errors='ignore').read())
        mt = re.search(r'Nigeria Funding Opportunity\s+(.{10,220}?)\s+by\s', t)
        if not mt:
            continue                      # title extraction failed — do not emit a filename as a title
        title = mt.group(1).strip()
        flat = re.sub(r'[^a-z0-9]+', '', title.lower())
        if any(dt in flat for dt in DEAD):
            continue                      # verified closed elsewhere — do not resurrect via its page
        key = norm_title(title)
        if key in seen: continue
        seen.add(key)
        def grab(lbl, span=170):
            m = re.search(lbl + r':\s*(.{0,%d})' % span, t)
            return m.group(1).strip() if m else ''
        elig = grab('Who can apply')
        for nxt in ('💰','Amount','Funder','Scope'):
            elig = elig.split(nxt)[0]
        opps.append({
            'title': title, 'funder': grab('Funder', 80).split('🌍')[0].strip(),
            'category': '', 'amount': grab('Amount', 60).split('🏛')[0].strip(),
            'deadline_raw': grab('Deadline', 40).split('👤')[0].strip(),
            'eligibility': elig.strip(), 'scope': grab('Scope', 40).split('About')[0].strip(),
            'url': '', 'text': t[:4000], 'source': 'page',
            'verified_on': None, 'status': 'unverified'})
    return opps

def score(entity, opp):
    """Return (points, matched_terms, blockers)."""
    if entity.get('INCOMPLETE'):
        return 0, [], ['profile incomplete — cannot match']
    hay = opp['text'].lower()
    elig = (opp['eligibility'] or '').lower()
    pts, hits, blocks = 0, [], []

    def present(term, text):
        t = term.strip()
        if not t: return False
        # short tokens must match as whole words ("ai" must not hit "training")
        if len(t) <= 4 or term != term.strip():
            return re.search(r'(?<![a-z])' + re.escape(t) + r'(?![a-z])', text) is not None
        return t in text
    for term in entity.get('include', []):
        if present(term, hay):
            pts += 3 if present(term, elig) else 1
            hits.append(term.strip())
    for term in entity.get('exclude', []):
        if present(term, elig):
            blocks.append(term.strip()); pts -= 5

    # hard gates read out of the eligibility text
    yrs = entity.get('registered_year')
    if yrs:
        age = 2026 - yrs
        m = re.search(r'(?:operating|trading|registered|in operation)[^.]{0,40}?(\d+)\s*\+?\s*year', elig)
        if m and age < int(m.group(1)):
            blocks.append(f"needs {m.group(1)}+ yrs operating; entity is {age}")
            pts -= 8
    if entity.get('stage') == 'pre-revenue' and re.search(r'minimum (annual )?(turnover|revenue)|must be revenue', elig):
        blocks.append('requires revenue; entity is pre-revenue'); pts -= 8
    if entity.get('woman_led') and re.search(r'women|female', elig):
        pts += 4; hits.append('women-led (explicit)')
    return pts, sorted(set(hits))[:8], blocks

def load_profiles():
    """Profiles are competitive intelligence and are NOT committed. On a dev
    machine they come from matching/profiles.json; in CI they come from the
    PROFILES_B64 secret, so the repo never carries them."""
    b64 = os.environ.get('PROFILES_B64')
    if b64:
        import base64
        return json.loads(base64.b64decode(b64).decode('utf-8'))
    p = os.path.join(BASE, 'profiles.json')
    if not os.path.exists(p):
        sys.exit('No profiles: set PROFILES_B64 or provide matching/profiles.json')
    return json.load(open(p, encoding='utf-8'))

def main():
    prof = load_profiles()
    opps = load_opportunities()
    live, closed, rolling = [], 0, 0
    for o in opps:
        d = parse_deadline(o['deadline_raw'])
        o['deadline'] = d.isoformat() if isinstance(d, datetime.date) else (d or 'unknown')
        if isinstance(d, datetime.date):
            if d < TODAY: closed += 1; continue
            o['days_left'] = (d - TODAY).days
        else:
            o['days_left'] = None
            if d == 'ROLLING': rolling += 1
        o['elig_known'] = bool(o['eligibility']) and PLACEHOLDER not in o['eligibility'].lower()
        # No parseable deadline means we do not know it is open — say so.
        o['date_known'] = isinstance(d, datetime.date)
        o['unverified'] = (not o['date_known']) and o.get('status') != 'open'
        live.append(o)

    rows = []
    for o in live:
        r = {k: o[k] for k in ('title','funder','deadline','days_left','amount','scope','url',
                               'elig_known','unverified','verified_on','status')}
        r['matches'] = {}
        for e in prof['entities']:
            pts, hits, blocks = score(e, o)
            if blocks:                         verdict = 'BLOCKED'
            elif pts >= 6 and o['elig_known'] and not o['unverified']: verdict = 'STRONG'
            elif pts >= 6:                     verdict = 'NEEDS-CHECK'
            elif pts >= 3:                     verdict = 'POSSIBLE'
            else:                              verdict = 'NO'
            r['matches'][e['id']] = {'verdict': verdict, 'score': pts,
                                     'why': hits, 'blockers': blocks}
        rows.append(r)

    # collapse benefit-prefixed variants: "Pre-seed cheque FirstCheck Africa" == "FirstCheck Africa"
    keys = sorted({re.sub(r'[^a-z0-9]+','',r['title'].lower()) for r in rows}, key=len)
    canon, kept = {}, []
    for r in rows:
        k = re.sub(r'[^a-z0-9]+','',r['title'].lower())
        base = next((c for c in keys if len(c) >= 14 and c != k and k.endswith(c)), None)
        tgt = base or k
        if tgt in canon:
            prev = canon[tgt]
            if len(r['title']) < len(prev['title']):   # keep the cleanest title
                prev['title'] = r['title']
            continue
        canon[tgt] = r; kept.append(r)
    rows = kept
    rows.sort(key=lambda r: (r['days_left'] if r['days_left'] is not None else 9999))
    out = {'generated': datetime.datetime.now().isoformat(timespec='seconds'),
           'today': TODAY.isoformat(),
           'entities': [{'id': e['id'], 'name': e['name'], 'notes': e.get('notes',''),
                         'incomplete': bool(e.get('INCOMPLETE'))} for e in prof['entities']],
           'stats': {'total_seen': len(opps), 'live': len(live),
                     'closed_filtered': closed, 'rolling': rolling,
                     'eligibility_unknown': sum(1 for o in live if not o['elig_known']),
                     'unverified': sum(1 for o in live if o['unverified'])},
           'opportunities': rows}
    json.dump(out, open(os.path.join(BASE, 'matches.json'), 'w', encoding='utf-8'),
              indent=1, ensure_ascii=False)

    print(f"seen {len(opps)} | live {len(live)} | closed {closed} | elig unknown {out['stats']['eligibility_unknown']}")
    for e in prof['entities']:
        c = {}
        for r in rows:
            v = r['matches'][e['id']]['verdict']; c[v] = c.get(v, 0) + 1
        print(f"  {e['name'][:34]:36s} STRONG {c.get('STRONG',0):3d}  CHECK {c.get('NEEDS-CHECK',0):3d}  POSS {c.get('POSSIBLE',0):3d}  BLOCKED {c.get('BLOCKED',0):3d}")

if __name__ == '__main__':
    main()
