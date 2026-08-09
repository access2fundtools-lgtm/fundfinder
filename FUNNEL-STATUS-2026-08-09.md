# FundFinder funnel — status after the 9 August repair session

## What now works

| Piece | State | Evidence |
|---|---|---|
| Supabase trigger + funnel view | ✅ Live | `config_rows` 2, `funnel_stage` view 1, trigger 1, `pg_net` 1 |
| Notify secret matches both sides | ✅ Live | Endpoint returns 200 with the bearer token; returned 401 before the redeploy |
| Cloudflare `NOTIFY_SECRET` | ✅ Set | Needed an empty-commit redeploy — Pages Functions only read variables at build time |
| **Signup capture in Supabase** | ✅ **Reliable** | This is the source of truth. Every signup lands here regardless of Zoho |

## What is still broken

### 1. Zoho Campaigns — every API call fails

`listsubscribe` returns **code 2007, "Invalid Contact Email address."** on all four
`contactinfo` shapes tried: real JSON bare, real JSON with name, Zoho's documented
unquoted pseudo-JSON bare, and pseudo-JSON with name. Same result with the parameters in
the query string, which is where Zoho's own documentation puts them.

**2007 does not appear anywhere in Zoho's published error-code table.** The documented
codes are 2004 for a bad email and 2002/2501 for a bad list key — neither is what we get.

What has been ruled out:

- **Not the payload format** — four shapes, identical failure
- **Not the query-string bug** — fixed, no change in behaviour
- **Not OAuth authentication** — the token exchange succeeds; we receive authenticated
  API responses rather than auth failures
- **Not the custom `Funnel_Stage` field** — the bare email-only payload fails too

What remains, and needs someone inside the Zoho console:

1. **OAuth scopes.** `listsubscribe` requires `ZohoCampaigns.contact.UPDATE` (or
   CREATE-UPDATE / WRITE / ALL). If the refresh token was minted without it, every write
   fails. Check at `api-console.zoho.com` → the connected app → scopes granted.
2. **List key.** The configured key ends `...37545566`. Compare against the real key in
   Zoho Campaigns → Contacts → Manage Lists → the list → Setup/API.
3. **Account status.** The July notes recorded the autoresponder as "Active pending Zoho
   compliance review". An account still under review may be blocked from adding contacts.
4. **Data centre.** If the Campaigns account lives on `.eu`, `.in` or another region,
   `campaigns.zoho.com` is the wrong host. Confirm the URL you see when logged in.

### 2. Newsletter signups have been failing silently — since launch

`subscribe.js` had the **same query-string bug** and, worse, never checked Zoho's reply at
all — there was a comment explaining that this was deliberate so a Zoho hiccup could not
break the visitor's experience. The consequence is that nobody ever saw the failures.

Both files now send parameters correctly and record the real outcome. **Assume the Zoho
list is missing every newsletter subscriber collected to date.** Supabase should still hold
them; they can be exported and imported into Zoho by hand once the API is fixed.

### 3. Email alerts not configured

`emailed:false` on every call. The function accepts either `RESEND_API_KEY` or
`ZEPTOMAIL_TOKEN`; neither is set in Cloudflare. ZeptoMail is the better fit — same vendor
as Campaigns, and `alerts@fundfinder.ng` already sits on a domain with verified SPF and
DKIM from the July work.

## What this means for the ad

**It does not block it.** Signups land in Supabase reliably, which is the thing that
matters. Zoho is the nurture leg and the email alert is a convenience. Running traffic now
means capturing real users into a real database — the risk is only that they do not get an
automated welcome until Zoho is fixed.

The 3 August rule was "funnel first, ads second" because signups were vanishing entirely.
That is no longer true.

## Standing lesson

Three separate silent failures surfaced in one session, all the same shape: **a green
signal that meant nothing.**

- Supabase "Success. No rows returned" — told us nothing about whether the trigger worked
- `zoho:true` — was only `res.ok`, and Zoho answers HTTP 200 on failure
- `subscribe.js` — never read the reply at all

**Never trust a success flag that has not been proven to read the actual outcome.**
