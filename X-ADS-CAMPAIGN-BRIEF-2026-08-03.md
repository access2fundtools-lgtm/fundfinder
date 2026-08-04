# FundFinder — X (Twitter) Ads campaign brief

**Built:** 3 August 2026 · **Status:** built in Ads Manager, NOT launched
**Ad account:** Fundfinder (`18ce55wtrh1`) · **Handle:** @fundfinder_ai (verified ✓)

---

## What's waiting for you

The campaign is fully built in X Ads Manager. It stops at one blocker: **no payment
method on file.** X won't even let the campaign save as a draft until a card is added
— the "Save draft" button stays disabled. So the two remaining steps are yours:

1. Add a card under **Funding source → Add a card**
2. Review the summary, then click **Publish**

> ⚠️ Because the draft can't be saved without a card, **keep that browser tab open**.
> If it's closed before a card is added, the form will need rebuilding.
> Tab URL: `ads.x.com/manager/18ce55wtrh1/campaigns/new/review`

---

## Campaign settings as built

| Setting | Value |
|---|---|
| Campaign name | FundFinder — Website Traffic — Aug 2026 |
| Objective | Website traffic (optimising for Link clicks) |
| Ad group | NG Founders & SMEs 22-45 — Traffic |
| Daily budget | **USD 3.50** |
| Total spend cap | **USD 25.00** |
| Schedule | 3 Aug 2026, 08:13 → 10 Aug 2026 (7 days) |
| Bid strategy | Auto bid |
| Pay by | Impressions (CPM) |
| Pacing | Standard |
| Placements | All placements |
| Estimated audience | 4.6m – 5.3m |

### Targeting

- **Location:** Nigeria
- **Age:** 21–49 *(see note below)*
- **Gender:** Any
- **Interests:** Business & Finance / Entrepreneurship
- **Follower look-alikes:** @TechCabal, @TechpointAfrica, @BusinessDayNg
- **Keywords (13):** grant, grants, funding, business grant, startup funding, SME loan,
  CBN loan, BOI loan, SMEDAN, NIRSAL, accelerator, call for applications, seed funding

---

## Decisions I made that you should sanity-check

**1. The ad account bills in USD, not naira.**
This is the big one. You asked for ₦5,000/day for 7 days (~₦35k). X has this account
set to USD, and account currency is fixed at creation — it can't be switched later.
At the ~₦1,410/$ parallel rate on 2 Aug, I converted to **$3.50/day, $25.00 cap**,
which comes to roughly ₦35,250 total. Your card issuer sets the actual naira rate at
the time of charge, so the final naira figure will drift a little either way.

**2. Age is 21–49, not 22–45.**
X only offers fixed brackets (18/21/25/35/50 on the lower bound, 34/49/54/"and up" on
the upper). 21–49 is the closest available fit to the 22–45 you picked.

**3. Landing page is the homepage, not the opportunity hub.**
The homepage carries both the "Browse Open Opportunities" button and the signup CTA,
so it serves click-throughs and signups. The hub is one click deeper. Verified live
(HTTP 200) with the tracking URL attached.

**4. Interests are thin — keywords are carrying the targeting.**
X's interest taxonomy has only one relevant entry ("Business & Finance /
Entrepreneurship"); there's no "small business" or "SME" interest at all. That's why I
leaned on 13 intent keywords plus three Nigerian business-media look-alike audiences.

**5. I dropped the WhatsApp claim from the creative.**
Your existing `ad_square.png` promises "Free alerts on WhatsApp + Email". The WhatsApp
Cloud API alerting is built but still dormant — waiting on Meta credentials and
template approval. Advertising it now would be promising something that doesn't
deliver, so the X creative says "Free daily funding alerts" instead.

**6. The creative was rebuilt for X's card format.**
X overlays the headline across the bottom third of a website-card image. My first
version had the yellow CTA bar down there and it got buried. v2 keeps all content in
the top 70% and leaves the bottom clear for X's own overlay.

---

## The ad

**Post copy** (247 chars, 33 to spare):

> Nigerian founders: 22+ funding opportunities are open right now — grants, loans,
> accelerators and agri funding.
>
> FundFinder AI scans hundreds of sources every morning and surfaces the ones you
> actually qualify for.
>
> Free to browse. No card needed.

**Card headline:** 22+ funding opportunities open to Nigerian businesses

**Destination:**
`https://fundfinder.ng/?utm_source=x&utm_medium=paid_social&utm_campaign=aug2026_traffic&utm_content=never_miss_funding`

X automatically moved the query string into its own "URL tracking" field — that's
normal behaviour, and the final click-through URL is unchanged. Verified HTTP 200.

**Creative:** `x-ad-fundfinder-card-v2-1200x628.png` (1.91:1, X website card spec)

A square 1:1 variant is also in the folder — `x-ad-fundfinder-1080x1080.png` — if you
want to test that format later. It carries an extra stat strip (22+ open now / Daily
new listings / Free forever).

---

## One accuracy note on "22+"

The "22+ Opportunities Open Now" figure comes from fundfinder.ng's own homepage
counter. The hub currently renders 83 cards against 78 opportunity pages, so the
larger number includes closed calls. "22+" is the conservative, defensible claim —
but it's worth confirming that homepage counter is being driven by live data rather
than a hardcoded value, because it's now a claim in a paid ad.

Separately: there's still no expiry sweep on the scraper, and 45 opportunity rows have
a NULL deadline. If closed opportunities are sitting on the hub, paid traffic will land
on them. Worth fixing before spend scales beyond this test.

---

## After launch — what to watch

- **First 48h:** X needs volume to exit the learning phase. At $3.50/day the campaign
  is thin, so expect noisy numbers on days 1–2. Don't judge it before day 3.
- **CPC:** Nigerian traffic on X typically runs cheap. If CPC comes in above ~$0.15,
  the keyword list is probably pulling in too broad a crowd — cut the generic terms
  ("funding", "grant") first and keep the specific ones (BOI loan, SMEDAN, NIRSAL).
- **Attribution:** filter by `utm_campaign=aug2026_traffic` to separate paid traffic
  from the organic Mon/Thu flyer posts.
