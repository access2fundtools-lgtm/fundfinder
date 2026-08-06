#!/usr/bin/env python3
# One-off generator for the guides section — produces guides.html + article pages
# matching the FundFinder design system. Not part of the deploy pipeline.
import json, os
ROOT = os.path.join(os.path.dirname(__file__), '..')
SITE = "https://fundfinder.ng"
TODAY = "2026-08-06"

STYLE = """
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root { --bg:#0a0a0a; --surface:#111; --surface2:#1a1a1a; --border:rgba(255,255,255,0.08);
 --text:#f0f0f0; --muted:rgba(255,255,255,0.55); --gold:#FFD700; --green:#22c55e; }
body { font-family:'Segoe UI',-apple-system,Arial,sans-serif; background:var(--bg); color:var(--text); line-height:1.7; }
nav { border-bottom:1px solid var(--border); padding:18px 40px; display:flex; align-items:center; justify-content:space-between;
 position:sticky; top:0; background:rgba(10,10,10,0.96); backdrop-filter:blur(12px); z-index:100; }
.nav-logo { font-size:18px; font-weight:800; letter-spacing:1px; text-decoration:none; color:var(--text); }
.nav-logo span { color:var(--gold); }
.back-btn { background:var(--surface2); border:1px solid var(--border); color:var(--muted); padding:8px 16px;
 border-radius:8px; text-decoration:none; font-size:13px; font-weight:600; }
.back-btn:hover { color:var(--text); }
.wrap { max-width:760px; margin:0 auto; padding:48px 24px 80px; }
.kicker { display:inline-block; background:rgba(255,215,0,0.1); border:1px solid rgba(255,215,0,0.3); color:var(--gold);
 font-size:11px; font-weight:700; letter-spacing:2px; text-transform:uppercase; padding:5px 14px; border-radius:20px; margin-bottom:18px; }
h1 { font-size:clamp(26px,5vw,38px); font-weight:800; line-height:1.25; margin-bottom:10px; }
.byline { color:var(--muted); font-size:14px; margin-bottom:32px; }
h2 { font-size:20px; font-weight:800; margin:36px 0 12px; color:var(--gold); }
p { margin-bottom:16px; color:rgba(255,255,255,0.87); }
a { color:var(--gold); }
table { width:100%; border-collapse:collapse; margin:16px 0 24px; font-size:15px; }
th, td { text-align:left; padding:10px 12px; border:1px solid var(--border); }
th { background:var(--surface2); font-size:12px; text-transform:uppercase; letter-spacing:1px; color:var(--muted); }
ul, ol { margin:0 0 16px 22px; }
li { margin-bottom:8px; color:rgba(255,255,255,0.87); }
.callout { background:var(--surface); border:1px solid rgba(255,215,0,0.25); border-left:4px solid var(--gold);
 border-radius:10px; padding:18px 20px; margin:24px 0; font-size:15px; }
.cta { display:block; background:var(--gold); color:#000; font-weight:900; letter-spacing:1px; text-transform:uppercase;
 padding:16px 28px; border-radius:12px; text-decoration:none; text-align:center; margin:36px 0 8px; }
.disclaimer { font-size:12.5px; color:var(--muted); margin-top:28px; border-top:1px solid var(--border); padding-top:16px; }
.rel { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:20px 22px; margin-top:32px; }
.rel h3 { font-size:13px; text-transform:uppercase; letter-spacing:2px; color:var(--muted); margin-bottom:12px; }
.rel a { display:block; margin-bottom:8px; font-weight:600; }
"""

def page(slug, title, desc, kicker, body, related):
    url = f"{SITE}/{slug}.html"
    ld_article = json.dumps({"@context":"https://schema.org","@type":"Article","headline":title,
        "description":desc,"datePublished":TODAY,"dateModified":TODAY,"inLanguage":"en-NG",
        "mainEntityOfPage":url,"author":{"@type":"Organization","name":"FundFinder AI","url":SITE+"/"},
        "publisher":{"@id":SITE+"/#org"}})
    ld_crumbs = json.dumps({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
        {"@type":"ListItem","position":1,"name":"Home","item":SITE+"/"},
        {"@type":"ListItem","position":2,"name":"Guides","item":SITE+"/guides.html"},
        {"@type":"ListItem","position":3,"name":title,"item":url}]})
    rel_html = "".join(f'<a href="{h}">{t} &rarr;</a>' for t, h in related)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} | FundFinder AI</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:type" content="article">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/og-image.png">
<meta property="og:site_name" content="FundFinder AI">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{ld_article}</script>
<script type="application/ld+json">{ld_crumbs}</script>
<style>{STYLE}</style>
</head>
<body>
<nav>
  <a class="nav-logo" href="index.html">Fund<span>Finder</span> AI</a>
  <a class="back-btn" href="guides.html">&larr; All Guides</a>
</nav>
<div class="wrap">
<span class="kicker">{kicker}</span>
<h1>{title}</h1>
<p class="byline">By FundFinder AI editorial &middot; Published 6 August 2026 &middot; Facts verified against official sources</p>
{body}
<a class="cta" href="opportunity-hub.html">&#128640; See every funding opportunity open right now</a>
<div class="rel"><h3>Related</h3>{rel_html}</div>
<p class="disclaimer">FundFinder AI (by A2F Partners Limited) is an independent funding-discovery platform. We are not affiliated with the program above and never charge for information about it. Always apply through the official portal linked in this guide — application is free unless the funder's own site says otherwise. Details were verified on the date of publication and can change; confirm on the official page before applying.</p>
</div>
</body>
</html>"""

# ---------------- ARTICLE BODIES ----------------
ARTICLES = []

ARTICLES.append(dict(
slug="guide-smedan-conditional-grant-50k-how-to-apply-2026",
title="SMEDAN ₦50,000 Conditional Grant Reopened: Who Qualifies and How to Apply (August 2026)",
desc="SMEDAN has reopened its Conditional Grant Scheme portal. Who qualifies for the ₦50,000 grant, the one condition attached, what to prepare, and how to apply free at portal.smedan.gov.ng.",
kicker="\U0001F1F3\U0001F1EC Government Grant · Open Now",
body="""
<p><strong>The short version:</strong> the Small and Medium Enterprises Development Agency of Nigeria (SMEDAN) reopened its Conditional Grant Scheme (CGS) portal in August 2026. It pays a one-time, non-repayable <strong>₦50,000</strong> to nano and micro businesses across all Local Government Areas. Application is free, online, and takes minutes if your documents are ready.</p>
<h2>Who qualifies</h2>
<ul>
<li>You run a <strong>nano or micro business</strong> operating in any LGA in Nigeria — market traders, artisans, food processors, small service providers all fit.</li>
<li>You accept the one condition: <strong>employ at least one additional person</strong>. The grant exists to create jobs, and SMEDAN attaches funding to that.</li>
<li>CAC registration is requested <em>if you have it</em> — it is not listed as mandatory for this scheme. (Most other government programs do require it, so registering still pays off. Check your status free with our <a href="cac-strike-off-checker.html">CAC strike-off checker</a>.)</li>
</ul>
<h2>What the ₦50,000 can be used for</h2>
<table>
<tr><th>Allowed use</th><th>Example</th></tr>
<tr><td>Equipment</td><td>A freezer, grinder, sewing machine, dryer</td></tr>
<tr><td>Working capital</td><td>Stock, raw materials</td></tr>
<tr><td>Technology</td><td>A smartphone for payments, POS setup</td></tr>
<tr><td>Expansion</td><td>A second stall, delivery costs</td></tr>
</table>
<h2>How to apply, step by step</h2>
<ol>
<li>Go to <a href="https://portal.smedan.gov.ng/" rel="noopener" target="_blank">portal.smedan.gov.ng</a> — the official SMEDAN portal. Nowhere else.</li>
<li>Create an account with your full name, email and phone number.</li>
<li>Complete the business profile: business name, type/industry, years in operation, and CAC number if you have one.</li>
<li>Submit under the Conditional Grant Scheme and keep your reference details.</li>
</ol>
<div class="callout"><strong>Two warnings.</strong> First: this is <em>not</em> the Presidential Conditional Grant Scheme — both pay ₦50,000, but they are different programs with different portals. Second: applying is <strong>free</strong>. Anyone charging a "processing fee" to get you the grant is defrauding you.</div>
<h2>No deadline published — what that means</h2>
<p>SMEDAN has not published a closing date. Government grant windows in Nigeria routinely close early when volume peaks, so treat "no deadline" as "apply this week", not "apply someday".</p>
""",
related=[("Commonwealth Startup Fellowship: fully funded, closes 1 Sept","guide-commonwealth-startup-fellowship-nigeria-2026.html"),
         ("LSETF MSME loans: ₦50,000–₦5,000,000 at 9% for Lagos businesses","guide-lsetf-msme-loans-lagos-2026.html"),
         ("Free funding diagnostic — see what your business qualifies for","business-diagnostic.html")]))

ARTICLES.append(dict(
slug="guide-commonwealth-startup-fellowship-nigeria-2026",
title="Commonwealth Startup Fellowship Cohort 3: The Nigerian Founder's Guide (Closes 1 September 2026)",
desc="Applications for Cohort 3 of the Commonwealth Startup Fellowship close 1 September 2026. Eligibility for Nigerian founders, the fully funded Accra bootcamp, London capstone, the real grant amount, and how to apply.",
kicker="\U0001F30D Fully Funded Fellowship · Closes 1 Sept",
body="""
<p><strong>The short version:</strong> the Commonwealth Scholarship Commission (CSC), with Imperial College London, is taking applications for Cohort 3 of the Commonwealth Startup Fellowship from <strong>3 August to 1 September 2026</strong>. Nigerian founders are eligible. It is fully funded — flights, accommodation, visa costs covered — and it is aimed at businesses that already have traction, not ideas.</p>
<h2>What you actually get</h2>
<table>
<tr><th>Component</th><th>Detail</th></tr>
<tr><td>Accra bootcamp</td><td>Two weeks in-person, 25 Jan – 4 Feb 2027. Travel, accommodation, meals, visa and vaccinations covered for one founder</td></tr>
<tr><td>Coaching</td><td>Five months of monthly 1-on-1 business coaching, peer sessions and expert workshops</td></tr>
<tr><td>London capstone</td><td>14–21 May 2027 — selected teams pitch international investors</td></tr>
<tr><td>Grant</td><td>Up to <strong>£2,000 equity-free</strong> per team from the Fellows Fund</td></tr>
</table>
<div class="callout"><strong>About the "£35,000" you may have seen online.</strong> Some summaries circulate £35,000 as the grant. That is the size of the overall Fellows Fund pool, not what a team receives. Per team, the published figure is up to £2,000, equity-free. Plan on that number.</div>
<h2>Who qualifies</h2>
<ul>
<li>Citizen of (or refugee status in) an eligible low- or middle-income Commonwealth country — <strong>Nigeria is eligible</strong>.</li>
<li>Business <strong>actively operating for at least 12 months</strong> with evidence of commercial traction and potential to scale. Idea-stage and prototype-stage ventures are explicitly out.</li>
<li>Founder holds a graduate-level qualification and is fluent in English.</li>
</ul>
<h2>What "evidence of traction" should look like</h2>
<p>Before you open the form, assemble: monthly revenue or user numbers for the last 12 months, two or three customer references, your CAC registration, and one paragraph on why your growth can scale beyond Nigeria. Applications that lead with verifiable numbers read differently from applications that lead with vision.</p>
<h2>How to apply</h2>
<p>Apply through the CSC's official candidates page: <a href="https://cscuk.fcdo.gov.uk/scholarships/commonwealth-startup-fellowship-information-for-candidates/" rel="noopener" target="_blank">cscuk.fcdo.gov.uk — Commonwealth Startup Fellowship</a>. Deadline: <strong>1 September 2026</strong>. That is under four weeks away — the traction evidence takes longer to assemble than the form does.</p>
""",
related=[("SMEDAN ₦50,000 grant reopened — who qualifies","guide-smedan-conditional-grant-50k-how-to-apply-2026.html"),
         ("LSETF MSME loans for Lagos businesses","guide-lsetf-msme-loans-lagos-2026.html"),
         ("Browse every opportunity open right now","opportunity-hub.html")]))

ARTICLES.append(dict(
slug="guide-lsetf-msme-loans-lagos-2026",
title="LSETF MSME Loans 2026: ₦50,000 to ₦5,000,000 at 9% for Lagos Businesses — Requirements and How to Apply",
desc="The Lagos State Employment Trust Fund lends ₦50,000–₦5,000,000 to Lagos MSMEs at 9% per annum. Every loan product, the full document list (LASRRA, LIRS, BVN), and how to apply at loans.lsetf.ng.",
kicker="\U0001F3DB️ Lagos State Loans · 9% Per Annum",
body="""
<p><strong>The short version:</strong> the Lagos State Employment Trust Fund (LSETF) runs standing loan programmes for businesses operating in Lagos, from ₦50,000 for market-level micro enterprises up to ₦5,000,000 for SMEs — at <strong>9% per annum</strong>, far below commercial lending rates. Two LGA-specific schemes go as low as <strong>5%</strong>. Here is the full menu and the exact document list.</p>
<h2>The loan products</h2>
<table>
<tr><th>Product</th><th>Amount</th><th>Rate</th><th>Tenor</th></tr>
<tr><td>Micro Enterprise Loan</td><td>₦50,000 – ₦500,000</td><td>9%/yr</td><td>12 months</td></tr>
<tr><td>Micro Enterprise Start-Up Loan</td><td>₦50,000 – ₦250,000</td><td>9%/yr</td><td>12 months</td></tr>
<tr><td>SME Loan</td><td>₦500,000 – ₦5,000,000</td><td>9%/yr</td><td>24–36 months</td></tr>
<tr><td>Ojo LGA / Onigbongbo LCDA schemes</td><td>₦50,000 – ₦200,000</td><td>5%/yr</td><td>12 months</td></tr>
</table>
<h2>Who qualifies</h2>
<ul>
<li>Business <strong>operating and resident in Lagos State</strong>.</li>
<li>Existing businesses: at least <strong>one year</strong> of operations, with 6 months of bank statements.</li>
<li>Start-ups: a vocational/technical training certificate from a Lagos State-recognised certifying body.</li>
</ul>
<h2>The document list — prepare this before you start</h2>
<ol>
<li>LASRRA ID (Lagos residents' registration — free at any LASRRA centre)</li>
<li>LIRS Tax ID</li>
<li>Valid government-issued ID</li>
<li>BVN</li>
<li>Passport photographs</li>
<li>6 months of bank statements</li>
</ol>
<div class="callout"><strong>Why applications fail:</strong> mostly missing LASRRA or LIRS registration, not weak businesses. Both are free-to-cheap and take days, so start them first — the loan form itself is the easy part.</div>
<h2>How to apply</h2>
<p>Applications go through the official portal: <a href="https://loans.lsetf.ng/" rel="noopener" target="_blank">loans.lsetf.ng</a>. These are standing programmes rather than one-off windows, but funds are disbursed in cycles — a complete application submitted early in a cycle moves faster.</p>
""",
related=[("SMEDAN ₦50,000 grant — free money vs this loan: which fits?","guide-smedan-conditional-grant-50k-how-to-apply-2026.html"),
         ("Commonwealth Startup Fellowship — fully funded, closes 1 Sept","guide-commonwealth-startup-fellowship-nigeria-2026.html"),
         ("Free funding diagnostic for your business","business-diagnostic.html")]))

# ---------------- WRITE ARTICLES ----------------
for a in ARTICLES:
    html = page(a["slug"], a["title"], a["desc"], a["kicker"], a["body"], a["related"])
    with open(os.path.join(ROOT, a["slug"] + ".html"), "w") as f:
        f.write(html)
    print("wrote", a["slug"] + ".html")

# ---------------- GUIDES INDEX ----------------
cards = "".join(f"""
<a class="card" href="{a['slug']}.html">
  <span class="kicker">{a['kicker']}</span>
  <h2>{a['title']}</h2>
  <p>{a['desc']}</p>
  <span class="read">Read the guide &rarr;</span>
</a>""" for a in ARTICLES)

ld_index = json.dumps({"@context":"https://schema.org","@type":"CollectionPage",
 "url":SITE+"/guides.html","name":"Funding Guides for Nigerian Businesses",
 "description":"Practical guides to grants, loans and fellowships open to Nigerian entrepreneurs — who qualifies, real amounts, and how to apply. Verified against official sources.",
 "inLanguage":"en-NG","isPartOf":{"@id":SITE+"/#website"},"publisher":{"@id":SITE+"/#org"}})

index_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Funding Guides for Nigerian Businesses | FundFinder AI</title>
<meta name="description" content="Practical guides to grants, loans and fellowships open to Nigerian entrepreneurs — who qualifies, real amounts, how to apply. Verified against official sources, updated as programs change.">
<link rel="canonical" href="{SITE}/guides.html">
<meta property="og:title" content="Funding Guides for Nigerian Businesses | FundFinder AI">
<meta property="og:description" content="Who qualifies, real amounts, how to apply — verified guides to Nigerian funding programs.">
<meta property="og:type" content="website">
<meta property="og:url" content="{SITE}/guides.html">
<meta property="og:image" content="{SITE}/og-image.png">
<script type="application/ld+json">{ld_index}</script>
<style>{STYLE}
.card {{ display:block; background:var(--surface); border:1px solid var(--border); border-radius:14px;
 padding:26px 26px 22px; margin-bottom:18px; text-decoration:none; transition:border-color .2s; }}
.card:hover {{ border-color:rgba(255,215,0,0.4); }}
.card h2 {{ margin:10px 0 8px; color:var(--text); font-size:19px; }}
.card p {{ color:var(--muted); font-size:14.5px; margin-bottom:12px; }}
.read {{ color:var(--gold); font-weight:700; font-size:14px; }}
</style>
</head>
<body>
<nav>
  <a class="nav-logo" href="index.html">Fund<span>Finder</span> AI</a>
  <a class="back-btn" href="opportunity-hub.html">Browse Opportunities &rarr;</a>
</nav>
<div class="wrap">
<span class="kicker">Guides</span>
<h1>Funding guides for Nigerian businesses</h1>
<p class="byline">Who qualifies, the real amounts, and how to apply — every guide verified against the official source before publishing. No rewritten press releases.</p>
{cards}
<a class="cta" href="opportunity-hub.html">&#128640; See every opportunity open right now</a>
</div>
</body>
</html>"""
with open(os.path.join(ROOT, "guides.html"), "w") as f:
    f.write(index_html)
print("wrote guides.html")
