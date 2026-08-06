# Chat Synergy & Handover — how the A2F chats stay in sync

**Written 6 August 2026.** Read this if you are a chat working on A2F, or if two chats
have produced work that doesn't match.

---

## The rule, in one line

**Every chat working on A2F must have the `Funding Opportunities` folder mounted as a
session source. A chat without it can only write to its own private scratchpad, and that
work is invisible to everyone else — including Dayo.**

---

## What went wrong on 6 August 2026

The "A2F PARTNERS fundfinder work" chat did a full four-site SEO pass:

- FAQ section + FAQPage schema on the FundFinder homepage
- verified X + Facebook profiles added to the Organization schema
- paste-ready `head-snippet.html`, `robots.txt` and `sitemap.xml` for a2fpartners.com,
  farmid.ng and myoneuphair.com
- a GSC verification walkthrough

It reported this as *"committed locally."* It was not. Checked in this folder the same
morning:

| Check | Result |
|---|---|
| `git status` | clean — nothing uncommitted |
| Latest commit | `b1e22a7`, the 07:31 automated scraper sync |
| `grep FAQPage index.html` | **0 matches** |
| `head-snippet.html` anywhere | not found |
| SEO zip anywhere | not found |

Its own phrasing gave the reason away: *"it ships with the two new programs the moment you
add the repo to session sources."* That chat never had this folder mounted. "Locally" meant
its own sandbox, which is discarded when the session ends.

**Nothing was recoverable. The work has to be redone in a chat that can see this folder.**

---

## Why Google Drive is not the fix

Drive is a fine place for finished business documents. It is a bad place to sync working
code, and it has already failed at it once:

- On 24 July a bulk "copy everything" pushed the entire `.git` directory into Drive as
  loose binary files — `HEAD`, `main`, `patch`, `git-rebase-todo`, `author-script`,
  `main.lock.dead.1784843440`. Those are still sitting there.
- It also carried up Word lock files (`~$F-iDICE-ESO-Capability-Statement.docx`).
- The folder is 1,093 files / 71 MB before `.git`, and 651 of those are generated
  opportunity flyers that already live on GitHub and deploy from there.

**GitHub is the backup for the repo. Drive is for documents a human reads.** Do not try to
make Drive the sync layer between chats — it will produce exactly the mess above, and it
still won't deploy anything.

---

## It is not just chats — scheduled tasks hit this too

The same fault surfaced independently in the **facebook-poster** task the same morning, and
it had been silently wrong for weeks:

- The 07:45 run could not see this folder. Only `Downloads` was connected to that session.
- It fell back to `Downloads`, found stale captions dated **2026-06-28**, and concluded the
  scraper had been dead for 39 days.
- That was false. The scraper had been running normally the whole time — captions exist for
  07-20, 07-23, 07-27, 07-28, 07-30 and 08-03.
- **Seven prior "no-op run" logs written into `Downloads` (10 Jul → 3 Aug) are wrong for the
  same reason.** They should be ignored.

A task that cannot see its data does not fail loudly. It reads whatever it *can* see and
reports a confident, wrong answer. Check the mount before trusting any run log.

**Action:** every scheduled task in this project — `nigeria-funding-daily-scraper`,
`facebook-poster`, `cac-delisting-watch` — must have `Funding Opportunities` connected as a
session source, not `Downloads`.

---

## The correct setup

| Layer | What lives there | Who writes to it |
|---|---|---|
| **`Funding Opportunities` folder** (mounted) | The live fundfinder.ng repo + all working documents | Every A2F chat. This is the shared truth |
| **GitHub** `access2fundtools-lgtm/fundfinder` | Same content, versioned. Deploys to Cloudflare Pages | Chats push here; GitHub Actions pushes back |
| **Google Drive** `A2f / Funding Opportunities /` | Finished business documents only — briefs, proposals, price lists | Synced deliberately, never bulk-copied |

**Never move this folder into Drive.** It is the live repo. Moving it breaks the Cloudflare
deploy and the 07:30 scraper task. (The mount also blocks deletion, so a true "move" cannot
complete anyway — it would leave a half-copied folder.)

---

## Prompt to paste into any A2F chat that lacks the folder

> Before you do any work: this project's shared folder is `Funding Opportunities`. Please
> confirm you can see it — run `ls` on it and tell me the latest commit with `git log
> --oneline -1`. If you cannot see it, stop and tell me, because anything you write will be
> invisible to my other chats and will be lost when this session ends. Do not report work as
> "committed locally" unless you have pushed to
> `github.com/access2fundtools-lgtm/fundfinder` and can quote the commit hash.

---

## The verification habit that would have caught this

A chat claiming it committed something should be able to answer three questions. If it
can't, the work isn't real:

1. **What is the commit hash?** — "committed locally" with no hash means nothing.
2. **Does the remote have it?** — `git rev-list --left-right --count HEAD...origin/main`.
   `0 0` means the remote is current. Anything else is unpushed or unpulled.
3. **Is the change actually in the file?** — `grep` for the thing it says it added. This is
   the check that caught the missing FAQ schema in ten seconds.

---

## What still needs doing on the SEO work

The four-site SEO pass has to be rebuilt from scratch in a folder-mounted chat. Its
substantive conclusions were checked and hold up:

| Claim from the other chat | Verified? |
|---|---|
| farmid.ng is live (NDFR farmer registry) | ✅ Confirmed 6 Aug — page renders, register flow present |
| myoneuphair.com renders, no 402 | ⚠️ Reported by that chat; the apex/Shopify split still needs a checkout test |
| No domain is verified in Google Search Console | ⚠️ Reported; needs Dayo's Google login to confirm |
| FundFinder already had schema, canonicals, 96-URL auto-sitemap | ✅ Consistent with this repo |

**The blocker is unchanged and it is not code.** Until each of the four domains is verified
in Google Search Console and its sitemap submitted, no amount of schema markup does
anything. That step needs Dayo's Google login and about 30 minutes. Everything else is
downstream of it.

The master brief has been updated with the corrected FarmID and OneUp rows, and Search
Console has been added as an explicit blocker.
