# FundFinder — WhatsApp Alerts Setup (Meta Cloud API)

This is the one-time setup to turn on automated WhatsApp alerts. Once done, every
Mon/Thu scrape sends a WhatsApp message to everyone who ticked **WhatsApp Alerts**
at signup. Until you finish this, nothing sends — the code is already deployed and
safely dormant.

**Number to use:** `08062085464` (fresh number — keeps your personal 08060972236 untouched)
**Unverified limit:** up to **250 alerts/day** (plenty to start; verify A2F later to lift it)

---

## Part A — Get your Meta credentials

1. **Business Portfolio** — go to https://business.facebook.com. If A2F Partners isn't
   there yet, create a portfolio (Business Settings → Business Info).
2. **Create the app** — go to https://developers.facebook.com/apps → **Create App** →
   use case **"Other" → Business** → name it e.g. "FundFinder Alerts" → link it to your
   A2F business portfolio.
3. **Add WhatsApp** — in the app dashboard, find **WhatsApp** and click **Set up**.
4. **Register your number** — in **WhatsApp → API Setup**, under "From", click
   **Add phone number** and register `08062085464` (as `+2348062085464`). You'll get
   an OTP on that number to confirm it.
5. **Copy two IDs from that same API Setup page:**
   - **Phone number ID** (a long number *under* the phone number — NOT the phone number itself)
   - **WhatsApp Business Account ID** (WABA ID) — keep it for reference
6. **Get a token:**
   - *To test today:* copy the **temporary access token** shown on the API Setup page (valid ~24h).
   - *For production (do this once you've tested):* Business Settings → **Users → System users**
     → Add a system user (Admin) → **Generate token** → select your app → tick
     **`whatsapp_business_messaging`** and **`whatsapp_business_management`** → generate.
     This token is **permanent** — use this one for the live env var.

## Part B — Create the message template (needs Meta approval, usually minutes–hours)

In **WhatsApp Manager → Account tools → Message templates → Create template**:

- **Name:** `new_funding_alert`   *(must match exactly, lowercase)*
- **Category:** Marketing
- **Language:** English  *(code `en`)*
- **Body:**

  > 🇳🇬 *New funding for your business!*
  >
  > FundFinder AI just added {{1}} new opportunity(ies) — including *{{2}}*.
  >
  > Tap below to see full details and apply before the deadline 👇

- **Footer:** `Reply STOP to unsubscribe`
- **Button:** type **Visit website** (static URL) → text `View Opportunities` →
  URL `https://fundfinder.ng/opportunity-hub.html`
- **Sample values** (Meta asks for these to review): {{1}} = `3`, {{2}} = `Fidelity Bank YEIDEP ₦500,000 Grant`

Submit. Wait for status **Approved**.

> If you pick a language code other than `en` (e.g. `en_US`), set `WHATSAPP_TEMPLATE_LANG`
> to match in Part C. Same if you rename the template — set `WHATSAPP_TEMPLATE_NAME`.

## Part C — Set the secrets (this is what switches it ON)

**1) Cloudflare** — Pages project → **Settings → Environment variables → Production**, add:

| Variable | Value |
|---|---|
| `WHATSAPP_TOKEN` | the token from Part A step 6 |
| `WHATSAPP_PHONE_NUMBER_ID` | the Phone number ID from Part A step 5 |
| `WHATSAPP_BROADCAST_SECRET` | invent a long random string (e.g. from a password generator) |
| `SUPABASE_SERVICE_KEY` | *(should already exist — it's used by subscribe.js)* |

(Optional overrides, only if you changed them: `WHATSAPP_TEMPLATE_NAME`,
`WHATSAPP_TEMPLATE_LANG`, `WHATSAPP_DAILY_CAP`.)
Then **redeploy** the Pages project (or push any commit) so the new vars take effect.

**2) GitHub** — repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `WHATSAPP_BROADCAST_SECRET` | **the same** long random string as in Cloudflare |

(`FF_BASE_URL` is already hard-set to `https://fundfinder.ng` in the workflow.)

## Part D — Test it

1. **Send yourself a test** (after the template is Approved and env vars are set). From a
   terminal, replace the secret and your number:

   ```bash
   curl -X POST https://fundfinder.ng/api/whatsapp-broadcast \
     -H "Authorization: Bearer YOUR_BROADCAST_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"test":true,"testNumber":"08062085464","count":3,"headline":"Fidelity Bank YEIDEP ₦500,000 Grant"}'
   ```

   You should get a WhatsApp message on that number and a JSON reply like
   `{"success":true,"sent":1,...}`. (Ask me and I can run this for you.)

2. **Live:** the next Mon/Thu scrape (or a manual "Run workflow" in the GitHub Actions tab)
   will automatically alert all opted-in subscribers.

---

### How it works (for reference)
- `functions/api/whatsapp-broadcast.js` — reads opted-in numbers from Supabase
  (`user_profiles.notify_whatsapp = true`), normalises them to international format,
  caps at 250/run, and sends the approved template via the Meta Graph API. It refuses
  any request without the correct `WHATSAPP_BROADCAST_SECRET`.
- The daily scraper POSTs `{count, headline}` to that endpoint after publishing new
  opportunities. If the secret isn't set, it silently skips — so runs never break.
- **Cost:** Meta charges a small per-message fee for marketing templates (a few naira
  each); the first batch of service conversations each month is free. 250/day max while
  unverified.
