# Cloudflare Pages Migration Guide
**FundFinder AI — opportunities.a2fpartners.com**
*Replacing Netlify (credit-blocked) with Cloudflare Pages (free, no credit limits)*

---

## Before you start — what you'll need

- Your domain registrar login (wherever you bought `a2fpartners.com` — GoDaddy, Namecheap, etc.)
- Your GitHub account (you already have this)
- About 30–45 minutes (mostly waiting for DNS to propagate)

---

## Step 1 — Create a Cloudflare account

1. Go to **https://cloudflare.com** and click **Sign Up**
2. Enter your email and create a password
3. Choose the **Free plan** — it's all you need

**Cloudflare Pages free tier includes:**
- ✅ 500 builds/month (you use ~30/month — well within limit)
- ✅ Unlimited bandwidth — no surprise bills
- ✅ Custom domains
- ✅ Free SSL/HTTPS

---

## Step 2 — Add your domain to Cloudflare

1. In Cloudflare dashboard, click **Add a Site**
2. Enter `a2fpartners.com` → click **Add site**
3. Choose the **Free plan** → Continue
4. Cloudflare will scan your existing DNS records — review and click **Continue**
5. Cloudflare gives you **two nameserver addresses** like:
   - `aria.ns.cloudflare.com`
   - `bob.ns.cloudflare.com`
6. **Copy these — you'll need them in the next step**

---

## Step 3 — Update nameservers at your domain registrar

1. Log in to wherever you bought `a2fpartners.com` (GoDaddy, Namecheap, etc.)
2. Find **Domain Settings → Nameservers**
3. Replace the current nameservers with Cloudflare's two addresses from Step 2
4. Save changes

> ⏳ DNS propagation takes **10 minutes to 24 hours**. Cloudflare will email you when it's active. You can continue the next steps while waiting.

---

## Step 4 — Create a Cloudflare Pages project

1. In Cloudflare dashboard → **Pages** (left sidebar) → **Create a project**
2. Click **Connect to Git** → **Connect GitHub**
3. Authorize Cloudflare to access your GitHub account
4. Select your **FundFinder repo** (the one with all the opportunity HTML files)
5. Configure the build:
   - **Production branch:** `main`
   - **Build command:** *(leave empty — it's a static site, no build needed)*
   - **Build output directory:** `/` (or leave as default)
6. Click **Save and Deploy**

Cloudflare will do a first deploy immediately (takes ~1 minute). You'll see a URL like:
`https://your-project-name.pages.dev`

---

## Step 5 — Add your custom domain

1. In your Pages project → **Custom Domains** tab → **Set up a custom domain**
2. Enter: `opportunities.a2fpartners.com`
3. Click **Continue** → Cloudflare will automatically add the DNS record
4. Status changes from "Initializing" → "Active" once DNS propagates

> If the domain was already on Cloudflare DNS (from Step 2–3), this is instant.

---

## Step 6 — Verify everything works

Once the custom domain shows **Active**:

1. Visit **https://opportunities.a2fpartners.com** — should load your site
2. Visit **https://opportunities.a2fpartners.com/fundfinder-dashboard.html** — dashboard should load
3. Visit **https://opportunities.a2fpartners.com/fundfinder-profile.html** — profile page should load

---

## What happens after this

- Every time the GitHub Actions scraper runs (7 AM Nigeria time), it commits new files and pushes to GitHub
- Cloudflare Pages detects the push and **auto-deploys in ~1 minute** — no manual action needed ever again
- No credits, no billing surprises

---

## Monitoring your Cloudflare usage

To check how many builds you've used this month:
1. Cloudflare dashboard → **Pages** → your project → **Deployments** tab
2. Each scraper run = 1 build. You get **500 free per month**
3. At 1/day you use ~30/month — you have 470 builds of headroom

The GitHub Actions scraper (which runs separately from the deploy) does **not** count toward Cloudflare builds.

---

## If anything goes wrong

**Site not loading after DNS change:** Wait up to 24 hours for full propagation. Check status at https://dnschecker.org — search for `opportunities.a2fpartners.com`.

**Build failed in Cloudflare Pages:** Go to Pages → your project → Deployments → click the failed deploy → read the error log. Usually it's a file path issue (set output directory to `/`).

**Old Netlify site still showing:** Your browser may be caching the old DNS. Try in a private/incognito window or a different device.

---

*Guide prepared July 4, 2026 — FundFinder AI by A2F Partners*
