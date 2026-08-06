# Apply the mobile chat's SEO + programs + guides work — 3 commits, 1 minute

**For the desktop chat with the `Funding Opportunities` folder mounted.**

The 6 Aug SEO work was NOT lost — it was stranded in the mobile session's sandbox,
which has no push authorization for the repo. These files carry it over.

## What the two commits contain

| Commit | What |
|---|---|
| `146cfdc` | Two verified programs added to `data/manual-opportunities.json`: Commonwealth Startup Fellowship Cohort 3 (deadline 1 Sept 2026, verified on Imperial Enterprise Lab — note: up to £2,000 equity-free per team, NOT the £35k the Google AI overview claimed) and SMEDAN Conditional Grant Scheme ₦50,000 (portal.smedan.gov.ng, verified on smedan.gov.ng) |
| `7b6bae4` | FundFinder homepage: FAQ section + FAQPage JSON-LD (5 questions targeting "grants for small business in Nigeria" etc.); X + Facebook added to Organization sameAs; sitemap regenerated |
| `ba1148b` | Guides section: `guides.html` index + 3 verified articles (SMEDAN CGS ₦50k, Commonwealth Startup Fellowship, LSETF MSME loans) with Article/Breadcrumb schema, nav links on home + hub, sitemap weighting, and `scripts/gen-article.py` for future guides. **Dayo approved publishing 6 Aug** |

All three are rebased onto `fac28f6` (origin/main as of 6 Aug morning).

## Apply — pick one

In the repo root:

    git am 0001-*.patch 0002-*.patch 0003-*.patch
    git push origin main

Or, if `git am` complains, use the bundle:

    git fetch a2f-seo-commits.bundle main:mobile-seo
    git merge mobile-seo
    git push origin main

## After pushing

1. Confirm: `git rev-list --left-right --count HEAD...origin/main` → `0 0`
2. Confirm: `grep -c FAQPage index.html` → not 0
3. Trigger the scraper workflow (Actions tab → Daily Funding Opportunities Scraper →
   Run workflow) so the two new programs get their pages and hub cards today instead
   of Monday.
4. Cloudflare deploys on push — check https://fundfinder.ng/ renders the FAQ section.

The three-site paste-ready fixes (a2fpartners.com, farmid.ng, myoneuphair.com) are in
`seo-pack.zip`, re-sent alongside these patches — head snippets, robots.txt, sitemap.xml
per site. Those don't need the fundfinder repo; paste into wherever each site deploys from.

Google Search Console remains the blocker above all of this — item 7b in the master brief.
