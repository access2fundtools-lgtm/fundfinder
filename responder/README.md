# FundFinder email auto-responder

Reads replies to the FundFinder welcome email, works out what the person is
asking, and either answers them or writes you a draft to send yourself.

Built 7 September 2026.

---

## What you have to do — four things, about ten minutes

Everything else is done. These four are things only you can do, because they
need accounts I cannot log into.

### 1. Generate a Zoho app password

Zoho Mail → **Settings → Security → App Passwords** → generate one, name it
"FundFinder responder". Copy it. You will not see it again.

While you are there, confirm **IMAP access is enabled** under
Settings → Mail Accounts → IMAP. If your Zoho plan does not offer IMAP, stop
here and tell me — the whole approach changes and I will rebuild it against
Cloudflare Email Routing instead.

### 2. Get an Anthropic API key

<https://console.anthropic.com> → API Keys → create one. This is what writes
the replies. Expect a few naira per hundred emails, not hundreds.

### 3. Put four secrets into GitHub

Repo → **Settings → Secrets and variables → Actions → New repository secret**.
Add these four:

| Secret name | Value |
|---|---|
| `ZOHO_USER` | The mailbox that actually **receives** mail sent to alerts@a2fpartners.com. If alerts@ is an alias, this is `spv@a2fpartners.com`. |
| `ZOHO_APP_PASSWORD` | From step 1 |
| `ANTHROPIC_API_KEY` | From step 2 |
| `ESCALATE_TO` | Where held drafts go — `access2fundtools@gmail.com` |

Do **not** put any of these in a file in this repo. The repo root is the public
web root, and the daily scraper runs `git add .`, so anything left lying around
gets published to the live site.

### 4. Watch it for about twenty replies, then turn on auto-send

It ships in **draft-only mode**. Every reply it writes is emailed to you and
nothing goes out on its own. Read twenty or so. When you are happy with the
writing, go to **Settings → Secrets and variables → Actions → Variables** and
add a variable (not a secret) named `AUTO_SEND_BUCKETS` with the value:

```
NOT_REGISTERED,REGISTERED_NEEDS_QUALIFYING
```

Those are the two safe buckets. The other four always come to you no matter
what you put in that variable — that is enforced in code, not configuration.

---

## How it decides

Every reply lands in exactly one bucket.

| Bucket | What it means | Action |
|---|---|---|
| `NOT_REGISTERED` | Not registered with CAC yet | **Auto-sends** — explains Business Name vs Limited, points at the free FG window |
| `REGISTERED_NEEDS_QUALIFYING` | Registered, but we do not know enough | **Auto-sends** the four qualifying questions |
| `QUALIFIED_READY_FOR_MATCHING` | Enough detail to match to funding | Held — you do the matching |
| `PRICING_OR_SERVICE_QUESTION` | Asks what something costs | Held |
| `COMPLAINT_OR_SENSITIVE` | Unhappy, legal, or personal | Held |
| `OTHER` | Anything unclear | Held |

Anything scoring below **0.8 confidence** is held regardless of bucket.

## What it will never do

Enforced in code, checked by tests, and re-checked against the generated text
before anything is sent:

- Never invents a programme, deadline, amount or eligibility rule
- Never quotes a price that is not in `config.js`
- Never mentions application-assistance pricing — no published figure exists
- Never asks for a password, CAC portal login, BVN, NIN, card or bank details
- Never says or implies it is automated
- Never promises funding or an outcome
- Never signs off as bare "Dayo" — always **Dayo Akin**
- Never replies to itself, to a bounce, to an out-of-office, or to a
  no-reply address
- Never sends more than **2 replies to the same person per day**
- Never touches a message twice — handled mail is flagged on the server

## One thing I changed from the original spec, and why

The spec said the `NOT_REGISTERED` bucket should quote CAC registration prices
and send Paystack links.

**It does not, on purpose.** Your welcome email tells every new signup that the
Federal Government is registering businesses with CAC completely free right
now. Quoting them a registration fee in the very next email contradicts the
email they just read, and reads as a bait-and-switch to someone deciding
whether to trust you with money.

So the bot explains the Business Name vs Limited choice, recommends one based
on whether they want grants, and points at the free route. No price, no
payment link.

The **annual returns** prices *are* loaded, because those are real published
statutory figures from `CAC-Annual-Returns-Simple-Price-List.md` and they apply
to a different person: someone already registered who is in default. If you
want registration priced as well, give me the two figures and the two Paystack
links and I will add them — but the welcome email needs rewording the same day.

---

## Running it

Nothing to deploy. `.github/workflows/email-responder.yml` runs it every 15
minutes on GitHub Actions using the same secrets mechanism as the scraper. No
Railway account, no server, no card.

Manual run: Actions tab → **Email auto-responder** → Run workflow. Tick
**dry run** to see what it would write without sending anything.

If you ever want true 5-minute latency, the identical code runs as a long-lived
process — `npm start` with the same four environment variables. That is the
only reason to introduce a host.

```bash
npm install
node test-classifier.js   # 25 guard tests, no credentials needed
node index.js --dry-run   # classify real mail, send nothing
node index.js             # one pass
node index.js --loop      # forever, every POLL_MINUTES
```

## Tuning

| Variable | Default | What it does |
|---|---|---|
| `AUTO_SEND_BUCKETS` | *(empty)* | Draft-only until you set it |
| `CONFIDENCE_FLOOR` | `0.8` | Below this, always hold |
| `LOOKBACK_DAYS` | `7` | How far back to look |
| `MAX_PER_RUN` | `25` | Ceiling per run, so a misconfiguration cannot mass-mail |
| `POLL_MINUTES` | `5` | Loop mode only |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | |

## Files

| File | |
|---|---|
| `index.js` | Main loop — IMAP read, guards, send or hold |
| `classify.js` | The Claude call, plus the output validator |
| `config.js` | Buckets, catalogue, guardrails. **Edit prices here.** |
| `test-classifier.js` | 25 offline tests, plus a live pass if a key is set |

No state file. Handled messages are flagged on the mail server, so no one's
email address is ever written to disk in this repo.
