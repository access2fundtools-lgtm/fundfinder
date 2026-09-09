# FundFinder tooling branch

Scripts that GitHub Actions needs but that must NOT be published on the live
site. Cloudflare Pages deploys `main` and serves every file in it — including
dot-directories, verified 2026-09-09 when `.github/scripts/fb_post.py` returned
HTTP 200 on fundfinder.ng. `_redirects` cannot fix that, because Pages matches
static assets before it consults redirect rules.

So this branch exists purely to hold tooling off `main`. The workflow checks it
out into a subdirectory at run time.

- `ff/fb_post.py` — Facebook Graph API poster. Tokens come from the
  `FB_PAGE_TOKENS` secret; never commit a token here.
