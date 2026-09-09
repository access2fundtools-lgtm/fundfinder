#!/usr/bin/env python3
"""
FundFinder — direct Facebook Page posting via Graph API.
Replaces the dead Zapier webhook (404 "please unsubscribe me!", 2026-08-24).

Tokens are NOT stored here. This folder is a git repo with a remote.
Reads them from:  <Downloads>/fundfinder-fb-page-tokens.json
Expected shape:
    {
      "105038935504207": {"name": "Africa's Blockchain Research Institute", "token": "EAA..."},
      "102734475720623": {"name": "Ibadan Smart City",                      "token": "EAA..."},
      "1877250312603236":{"name": "DayoAkin",                               "token": "EAA..."},
      "106941541688478": {"name": "Accesstofunds",                          "token": "EAA..."}
    }

Usage:
    python3 fb_post.py --check                       # verify all tokens, post nothing
    python3 fb_post.py --file CAPTION.txt --page ID  # post one caption to one page
    python3 fb_post.py --file CAPTION.txt --all      # post one caption to all 4 pages
    python3 fb_post.py --backlog A.txt B.txt --all   # post several, all pages
Add --dry-run to print what would happen without calling the API.
"""

import argparse, json, os, re, sys, time, urllib.parse, urllib.request, urllib.error

GRAPH = "https://graph.facebook.com/v25.0"
DELAY_SECONDS = 3

TOKEN_PATHS = [
    "/sessions/practical-upbeat-thompson/mnt/Downloads/fundfinder-fb-page-tokens.json",
    os.path.expanduser("~/Downloads/fundfinder-fb-page-tokens.json"),
    r"C:\Users\user\Downloads\fundfinder-fb-page-tokens.json",
]


def load_tokens():
    # 1. Environment first. This is how GitHub Actions supplies them, and it is
    #    the only source that does not depend on a folder being mounted — which
    #    is what kept breaking this script between sessions.
    raw = os.environ.get("FB_PAGE_TOKENS")
    if raw:
        try:
            return json.loads(raw), "env:FB_PAGE_TOKENS"
        except json.JSONDecodeError as e:
            sys.exit(f"ERROR: FB_PAGE_TOKENS is set but is not valid JSON — {e}")

    # 2. Fall back to the local file, for running by hand on Dayo's machine.
    for p in TOKEN_PATHS:
        if os.path.exists(p):
            with open(p, encoding="utf-8") as fh:
                return json.load(fh), p

    sys.exit(
        "ERROR: no tokens found. Either set FB_PAGE_TOKENS (JSON) in the "
        "environment, or put fundfinder-fb-page-tokens.json in Downloads. "
        "See FACEBOOK-GRAPH-API-SETUP.txt."
    )


# --- caption discovery ------------------------------------------------------
# Watermark logic, moved out of the scheduled task's prose and into code so it
# behaves identically every run.
#
# Do NOT filter to today's date. The scraper runs on days the poster does not,
# so date-only matching strands captions permanently.

CAPTION_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-(?!.*(?:SYNC-LOG|SOCIAL-LOG|QA-REPORT))(.+)\.txt$")
EXCLUDE_PREFIXES = ("SYNC-LOG", "SOCIAL-LOG", "QA-REPORT", "A2F-DRAFT", "X-SETUP-LOG")


def find_unposted(folder, limit=8):
    """Return (captions, watermark). Captions are dated after the newest
    SOCIAL-LOG, up to and including today, oldest first."""
    names = os.listdir(folder)

    logs = sorted(n[11:21] for n in names
                  if n.startswith("SOCIAL-LOG-") and n.endswith(".txt") and len(n) >= 21)
    watermark = logs[-1] if logs else "0000-00-00"
    today = time.strftime("%Y-%m-%d")

    out = []
    for n in sorted(names):
        if not n.endswith(".txt") or n.startswith(EXCLUDE_PREFIXES):
            continue
        m = CAPTION_RE.match(n)
        if not m:
            continue
        d = m.group(1)
        if watermark < d <= today:
            out.append(os.path.join(folder, n))

    return out[:limit], watermark


def api_get(url):
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"raw": body[:300]}
    except Exception as e:
        return 0, {"error": {"message": f"{type(e).__name__}: {e}"}}


def check(tokens):
    """Verify each token is alive and can create content. Posts nothing."""
    ok = True
    for page_id, meta in tokens.items():
        url = f"{GRAPH}/{page_id}?fields=name,tasks&access_token={urllib.parse.quote(meta['token'])}"
        status, body = api_get(url)
        if status == 200:
            tasks = body.get("tasks", [])
            can_post = "CREATE_CONTENT" in tasks
            ok = ok and can_post
            flag = "OK  " if can_post else "NO CREATE_CONTENT"
            print(f"[{flag}] {page_id}  {body.get('name', meta.get('name'))}  tasks={tasks}")
        else:
            ok = False
            msg = body.get("error", {}).get("message", body)
            print(f"[FAIL] {page_id}  HTTP {status}  {msg}")
    return ok


def post(page_id, token, message, dry_run=False):
    if dry_run:
        print(f"[DRY-RUN] would post {len(message)} chars to {page_id}")
        return True, "dry-run"
    payload = json.dumps({"message": message, "access_token": token}).encode()
    req = urllib.request.Request(
        f"{GRAPH}/{page_id}/feed", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = json.loads(r.read().decode())
            # Judge success on the BODY, never on the status code alone.
            # The dead Zapier hook returned HTTP 200 with the body
            # "please unsubscribe me!" and fooled the old health check into
            # reporting a healthy channel. Graph returns a post id on success;
            # anything else is a failure however encouraging the status looks.
            post_id = body.get("id")
            if not post_id:
                return False, f"HTTP 200 but no post id returned — body: {str(body)[:200]}"
            return True, post_id
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            err = json.loads(raw)["error"]
            return False, f"HTTP {e.code} (#{err.get('code')}) {err.get('message')}"
        except Exception:
            return False, f"HTTP {e.code} {raw[:200]}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--file")
    ap.add_argument("--backlog", nargs="*")
    ap.add_argument("--page")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--auto", metavar="FOLDER",
                    help="find every unposted caption in FOLDER (watermarked by the "
                         "newest SOCIAL-LOG), post to all pages, and write today's log")
    ap.add_argument("--limit", type=int, default=8,
                    help="max captions per --auto run (default 8). Each one posts to "
                         "every page, so 8 captions is 32 calls across 4 pages.")
    args = ap.parse_args()

    tokens, path = load_tokens()
    print(f"Tokens loaded from {path} ({len(tokens)} pages)\n")

    if args.check:
        sys.exit(0 if check(tokens) else 1)

    watermark = None
    if args.auto:
        files, watermark = find_unposted(args.auto, limit=args.limit)
        args.all = True
        print(f"Watermark (newest SOCIAL-LOG): {watermark}")
        print(f"Unposted captions found: {len(files)}")
        for f in files:
            print(f"  · {os.path.basename(f)}")
        print()
        if not files:
            write_log(args.auto, watermark, [], dry=args.dry_run)
            print("Nothing to post. Log written.")
            sys.exit(0)
    else:
        files = args.backlog or ([args.file] if args.file else [])
        if not files:
            sys.exit("Nothing to post. Pass --file, --backlog or --auto, or use --check.")

    targets = list(tokens.items()) if args.all else [(args.page, tokens[args.page])]
    sent = failed = 0
    results = []

    for f in files:
        caption = open(f, encoding="utf-8").read().strip()
        print(f"=== {os.path.basename(f)} ({len(caption)} chars)")
        for page_id, meta in targets:
            good, detail = post(page_id, meta["token"], caption, args.dry_run)
            print(f"    {'SENT' if good else 'FAIL'}  {meta.get('name', page_id):<45} {detail}")
            results.append((os.path.basename(f), page_id, meta.get("name", page_id), good, detail))
            sent, failed = (sent + 1, failed) if good else (sent, failed + 1)
            time.sleep(DELAY_SECONDS)
        print()

    print(f"TOTAL: {sent} sent, {failed} failed")

    if args.auto:
        # Only advance the watermark if something actually went out. Writing a
        # log after a total failure would bury every one of these captions
        # forever, because the next run only looks at dates AFTER the newest log.
        if sent > 0:
            write_log(args.auto, watermark, results, dry=args.dry_run)
            print("Log written — watermark advanced.")
        else:
            print("NOTHING SENT — deliberately not writing a log, so these "
                  "captions stay in the queue for the next run.")

    sys.exit(1 if failed else 0)


def write_log(folder, watermark, results, dry=False):
    today = time.strftime("%Y-%m-%d")
    path = os.path.join(folder, f"SOCIAL-LOG-{today}.txt")
    sent = sum(1 for r in results if r[3])
    failed = len(results) - sent

    lines = [
        f"FUNDFINDER SOCIAL LOG — {today}",
        f"Run at {time.strftime('%Y-%m-%d %H:%M:%S')} UTC by fb_post.py --auto",
        "",
        f"Previous watermark: {watermark}",
        f"Calls: {sent} sent, {failed} failed",
        "",
    ]
    if not results:
        lines.append("No unposted captions qualified. Nothing attempted.")
    else:
        lines.append("RESULTS")
        for cap, pid, name, good, detail in results:
            lines.append(f"  [{'SENT' if good else 'FAIL'}] {cap} -> {name} ({pid})  {detail}")

    bad = [r for r in results if not r[3]]
    lines += ["", "ITEMS NEEDING HUMAN ATTENTION"]
    lines += ([f"  - {r[0]} -> {r[2]}: {r[4]}" for r in bad] if bad else ["  None."])
    lines += [
        "",
        "CHANNELS NOT COVERED BY THIS RUN",
        "  - LinkedIn: token expired (see LINKEDIN-TOKEN-REFRESH-STEPS.txt).",
        "  - X / @fundfinder_ai: developer account has $0.00 credits; ~$7/month needed.",
        "  - Zapier hook: dead since 2026-08-24, returns 'please unsubscribe me!'. "
        "Replaced by this Graph API path.",
        "",
    ]
    text = "\n".join(lines)
    if dry:
        print("[DRY-RUN] would write log:\n" + text)
        return
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


if __name__ == "__main__":
    main()
