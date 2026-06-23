# FundFinder AI — Zoho Campaigns Setup Guide

Once done, every email submitted on the website goes directly into your Zoho Campaigns mailing list and you can blast up to 10,000 emails from there.

---

## STEP 1 — Create Your Zoho Campaigns Account

1. Go to **https://www.zoho.com/campaigns/**
2. Click **Sign Up Free**
3. Sign in with your Zoho account (or create one — it's the same login for all Zoho apps)
4. The free plan supports up to **2,000 contacts** and **12,000 emails/month**
5. To unlock 10,000 emails, upgrade to the Standard plan (starts very cheaply)

---

## STEP 2 — Create a Mailing List

1. In Zoho Campaigns, click **Contacts** → **Mailing Lists** → **Create List**
2. Name it something like: `FundFinder AI Subscribers`
3. Fill in sender name: `FundFinder AI by A2F Partners`
4. Sender email: `funding@a2fpartners.com`
5. Click **Save**
6. Open the list you just created — look at the URL in your browser, it will look like:
   `https://campaigns.zoho.com/campaigns/org.../mailing-lists/XXXXXXXXXX/details`
   The number at the end (`XXXXXXXXXX`) is your **List Key** — copy it.

---

## STEP 3 — Get Your API Auth Token

1. Go to **https://accounts.zoho.com/developerconsole**
2. Click **Add Client** → **Self Client**
3. Click **Create**
4. In the Self Client page, click **Generate Code**
5. In the scope field, enter exactly:
   ```
   Campaigns.Lists.ALL,Campaigns.Contacts.ALL
   ```
6. Time duration: **10 minutes** (the code expires fast — complete the next step immediately)
7. Click **Create** → copy the code shown
8. Now click **Generate Token** tab, paste the code, set grant_type to `authorization_code`
9. Copy the **access_token** value — this is your **Auth Token**

> ⚠️ **Note:** Zoho access tokens expire after 1 hour. For a permanent token, use the refresh_token flow — ask FundFinder AI to help you set that up once you have your initial token working.
>
> **Simpler alternative:** In Zoho Campaigns → Settings → Developer Space → there may be a direct API Key option depending on your account version. Use that if available — it doesn't expire.

---

## STEP 4 — Add the Credentials to Netlify

1. Go to **https://app.netlify.com** → open your FundFinder AI site
2. Click **Site configuration** → **Environment variables** → **Add a variable**
3. Add these two variables:

| Key | Value |
|-----|-------|
| `ZOHO_AUTH_TOKEN` | the auth token from Step 3 |
| `ZOHO_LIST_KEY` | the list key number from Step 2 |

4. Click **Save** — Netlify will automatically make these available to the serverless function

---

## STEP 5 — Deploy and Test

After adding the environment variables, trigger a new deploy (push to GitHub or run `deploy-to-netlify.ps1`).

Then go to **https://opportunities.a2fpartners.com**, enter a test email in the subscribe form, and check your Zoho Campaigns mailing list — the contact should appear within seconds.

---

## HOW TO SEND YOUR FIRST CAMPAIGN

Once subscribers are flowing in:

1. Zoho Campaigns → **Campaigns** → **Email Campaigns** → **Create Campaign**
2. Choose your mailing list (`FundFinder AI Subscribers`)
3. Design your email (or use a template)
4. Schedule or send immediately
5. Track opens, clicks, and unsubscribes from the dashboard

---

## QUESTIONS?

Email: funding@a2fpartners.com
