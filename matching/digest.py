#!/usr/bin/env python3
"""A2F group match digest.

Reads matches.json (produced by match.py), diffs it against the previous run,
and writes a digest of what CHANGED — new matches, newly-closing deadlines.

Sending is gated. With no credentials it still writes the digest to disk, so it
is useful before any token exists:
    python3 digest.py                 # write digest only
    ZEPTOMAIL_TOKEN=... python3 digest.py --send --to you@example.com
"""
import json, os, sys, datetime, urllib.request, html

BASE = os.path.dirname(os.path.abspath(__file__))
CUR  = os.path.join(BASE, 'matches.json')
PREV = os.path.join(BASE, '.digest-state.json')

def load(p, d=None):
    try:    return json.load(open(p, encoding='utf-8'))
    except Exception: return d

def key(r): return r['title'].strip().lower()[:70]

def build():
    cur = load(CUR)
    if not cur:
        sys.exit('matches.json not found — run match.py first')
    prev = load(PREV, {'seen': {}})
    seen = prev.get('seen', {})

    ents = {e['id']: e['name'] for e in cur['entities']}
    new_rows, closing, still = [], [], 0
    now_seen = {}

    for r in cur['opportunities']:
        hits = {i: m for i, m in r['matches'].items()
                if m['verdict'] in ('STRONG', 'NEEDS-CHECK')}
        if not hits:
            continue
        k = key(r)
        now_seen[k] = sorted(hits)
        still += 1
        if k not in seen:
            new_rows.append((r, hits))
        elif sorted(hits) != seen[k]:
            new_rows.append((r, hits))           # match set changed
        d = r.get('days_left')
        if d is not None and 0 <= d <= 21:
            closing.append((r, hits))

    closing.sort(key=lambda x: x[0]['days_left'])
    return cur, ents, new_rows, closing, still, now_seen

def render(cur, ents, new_rows, closing, still):
    today = cur['today']
    def names(hits): return ', '.join(ents[i].split(' (')[0] for i in sorted(hits))

    md = [f"# A2F funding digest — {today}", ""]
    if not new_rows and not closing:
        md.append("No new matches and nothing closing in the next 21 days.")
    if new_rows:
        md.append(f"## {len(new_rows)} new or changed")
        for r, h in new_rows[:25]:
            dl = r['deadline'] if r['deadline'] not in ('unknown',) else 'not published'
            flag = ' ⚠️ unverified' if r.get('unverified') else ''
            md.append(f"- **{r['title'][:90]}** — {names(h)} · {dl}{flag}")
        md.append("")
    if closing:
        md.append("## Closing within 21 days")
        for r, h in closing[:15]:
            md.append(f"- **{r['days_left']}d** · {r['title'][:80]} — {names(h)}")
        md.append("")
    md.append(f"_{still} live opportunities currently match at least one entity. "
              f"{cur['stats'].get('unverified', 0)} are unverified — no confirmed open date._")
    md.append("")
    md.append("_Nothing here is confirmed open. Verify before applying._")
    text = "\n".join(md)

    rows = ""
    for r, h in (new_rows[:25] or []):
        dl = r['deadline'] if r['deadline'] not in ('unknown',) else 'not published'
        rows += (f"<tr><td style='padding:6px 10px;border-bottom:1px solid #eee'>{html.escape(r['title'][:90])}</td>"
                 f"<td style='padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap'>{html.escape(names(h))}</td>"
                 f"<td style='padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap'>{html.escape(dl)}</td></tr>")
    body = (f"<div style='font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1a1a'>"
            f"<h2 style='margin:0 0 4px'>A2F funding digest</h2>"
            f"<div style='color:#6b7280;font-size:12.5px;margin-bottom:14px'>{today} · "
            f"{still} live matches · {cur['stats'].get('unverified',0)} unverified</div>")
    if rows:
        body += ("<table style='border-collapse:collapse;width:100%;font-size:13px'>"
                 "<tr><th align='left' style='padding:6px 10px;background:#f9fafb'>Opportunity</th>"
                 "<th align='left' style='padding:6px 10px;background:#f9fafb'>Matches</th>"
                 "<th align='left' style='padding:6px 10px;background:#f9fafb'>Deadline</th></tr>"
                 + rows + "</table>")
    else:
        body += "<p>No new or changed matches since the last run.</p>"
    if closing:
        body += "<h3 style='margin:18px 0 6px'>Closing within 21 days</h3><ul style='margin:0;padding-left:18px'>"
        for r, h in closing[:15]:
            body += f"<li><b>{r['days_left']}d</b> — {html.escape(r['title'][:80])} ({html.escape(names(h))})</li>"
        body += "</ul>"
    body += ("<p style='color:#9ca3af;font-size:12px;margin-top:18px'>Nothing here is confirmed open. "
             "Verify before applying — aggregators republish closed calls.</p></div>")
    return text, body

def send_zepto(token, to, subject, html_body, sender):
    req = urllib.request.Request(
        'https://api.zeptomail.com/v1.1/email',
        data=json.dumps({
            'from': {'address': sender},
            'to': [{'email_address': {'address': to}}],
            'subject': subject,
            'htmlbody': html_body,
        }).encode(),
        headers={'Authorization': token, 'Content-Type': 'application/json'},
        method='POST')
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status

def main():
    cur, ents, new_rows, closing, still, now_seen = build()
    text, body = render(cur, ents, new_rows, closing, still)
    open(os.path.join(BASE, 'digest-latest.md'), 'w', encoding='utf-8').write(text)
    open(os.path.join(BASE, 'digest-latest.html'), 'w', encoding='utf-8').write(body)
    print(f"digest written · {len(new_rows)} new/changed · {len(closing)} closing soon · {still} live matches")

    if '--send' in sys.argv:
        tok = os.environ.get('ZEPTOMAIL_TOKEN')
        to  = os.environ.get('DIGEST_TO') or (sys.argv[sys.argv.index('--to')+1] if '--to' in sys.argv else None)
        sender = os.environ.get('DIGEST_FROM', 'noreply@a2fpartners.com')
        if not tok:
            print('SKIP send: ZEPTOMAIL_TOKEN not set (digest still written to disk)'); return
        if not to:
            print('SKIP send: no recipient (set DIGEST_TO or pass --to)'); return
        if not new_rows and not closing:
            print('SKIP send: nothing new — not emailing a no-op'); return
        try:
            st = send_zepto(tok, to, f"A2F funding digest — {cur['today']}", body, sender)
            print('sent, HTTP', st)
        except Exception as e:
            print('SEND FAILED:', e); return

    json.dump({'seen': now_seen, 'run': cur['today']},
              open(PREV, 'w', encoding='utf-8'))

if __name__ == '__main__':
    main()
