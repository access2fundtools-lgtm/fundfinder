# FundFinder AI — Zoho Campaigns Setup Guide (Cloudflare Pages)

Once done: every email submitted on fundfinder.ng goes straight into your Zoho Campaigns mailing list, and Zoho automatically sends each new lead an email asking them to create a full account and complete their business profile — no manual follow-up needed.

This replaces the old Netlify-based setup (the site now runs on **Cloudflare Pages**, not Netlify — the old instructions no longer apply).

---

## STEP 1 — Create Your Zoho Campaigns Account (skip if already done)

1. Go to **https://www.zoho.com/campaigns/**
2. Click **Sign Up Free**
3. Sign in with your Zoho account (or create one — same login for all Zoho apps)
4. Free plan: up to **2,000 contacts** and **12,000 emails/month**

---

## STEP 2 — Create a Mailing List

1. In Zoho Campaigns, click **Contacts** → **Mailing Lists** → **Create List**
2. Name it: `FundFinder AI Subscribers`
3. Sender name: `FundFinder AI by A2F Partners`
4. Sender email: `funding@a2fpartners.com`
5. Click **Save**
6. Open the list → **Setup** tab → scroll to **List Key**. Click the copy icon rather than manually selecting the text — the field visually truncates the value (looks ~50 characters, is actually ~67+), and a partial copy will fail silently with a Zoho "Invalid Listkey" error later. If in doubt, verify against the API directly: `GET https://campaigns.zoho.com/api/v1.1/getmailinglists` (with your access token) returns the exact `listkey` field for every list.

---

## STEP 3 — Generate a Self Client (needed for the non-expiring token)

Zoho access tokens expire after 1 hour, so instead of using one directly, the site exchanges a long-lived **refresh token** for a fresh access token on every signup. This step creates the credentials for that.

1. Go to **https://api-console.zoho.com/** (Zoho API Console — replaces the old developerconsole link)
2. Click **Add Client** → **Self Client** → **Create**
3. On the Self Client's **Client Secret** tab, copy:
   - **Client ID** → this is `ZOHO_CLIENT_ID`
   - **Client Secret** → this is `ZOHO_CLIENT_SECRET`
4. Go to the **Generate Code** tab
5. Scope field, enter exactly:
   ```
   ZohoCampaigns.contact.ALL
   ```
   (The subscribe API specifically requires the `UPDATE` scope — `CREATE,READ` alone returns a 401. `ALL` covers create/update/delete/read so nothing else needs regenerating later.)
6. Time duration: **10 minutes** (expires fast — do the next step immediately)
7. Click **Create** → copy the code shown

---

## STEP 4 — Exchange the Code for a Refresh Token

The code from Step 3 is one-time use and expires in 10 minutes — it needs to be exchanged immediately for a refresh token (which does *not* expire, unless unused for 100+ days).

Send me (in chat) the code from Step 3 right after generating it, along with your Client ID and Client Secret from Step 3, and I'll make the exchange call and hand you back the `ZOHO_REFRESH_TOKEN` value — I won't store your Client Secret anywhere outside this one exchange.

(If you'd rather do it yourself: `POST https://accounts.zoho.com/oauth/v2/token` with `code`, `client_id`, `client_secret`, `redirect_uri=https://campaigns.zoho.com`, `grant_type=authorization_code` — the response's `refresh_token` field is the value you want.)

---

## STEP 5 — Add the Credentials to Cloudflare Pages

1. Go to **https://dash.cloudflare.com** → **Workers & Pages** → open the FundFinder AI project
2. **Settings** → **Environment variables** → **Add variable** (do this for the **Production** environment)
3. Add all four:

| Key | Value |
|-----|-------|
| `ZOHO_CLIENT_ID` | from Step 3 |
| `ZOHO_CLIENT_SECRET` | from Step 3 (mark as **Encrypt**) |
| `ZOHO_REFRESH_TOKEN` | from Step 4 (mark