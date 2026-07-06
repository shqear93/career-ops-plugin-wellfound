---
name: career-ops-plugin-wellfound
description: How to configure and run the Wellfound provider plugin.
license: MIT
---

# career-ops-plugin-wellfound

Fetches Wellfound's global-remote job listings live via a visible Playwright
browser, authenticated with a cached session cookie.

## Setup

Wellfound gates full results behind a login, and blocks headless browsers
outright. Run the standalone auth script once — it drives a real, visible
Chrome window purely to capture a session cookie:

```bash
node plugins.local/wellfound/auth.mjs
```

This writes `.wellfound-cookie.json`. Re-run it whenever the session goes
stale (roughly every 24 hours). No `.env` or API key is needed — the provider
hook fetches jobs live on every scan using this cookie.

## How to run it

Add a `provider: wellfound` entry to `portals.yml` with a `searchUrl`:

```yaml
tracked_companies:
  - name: "Wellfound — Global Remote"
    provider: wellfound
    searchUrl: "https://wellfound.com/jobs?remote=true&locationSlugs[]=everywhere"
```

Then it runs automatically as part of your normal scan:

```bash
node scan.mjs
```

Expect a visible Chrome window per configured entry — headless doesn't get
past Wellfound's bot protection, so this is a deliberate tradeoff, not a bug.

## What it produces

`Job[]` — each entry has:
- `title` — derived from the URL slug
- `url` — direct link to the job posting on wellfound.com
- `company` — blank (employer name isn't reliably parseable from the listing page)
- `location` — `"Remote · Everywhere"` (only global-remote jobs are returned)
- `salary` — `{min, max, currency}` when parseable from the listing context, else `null`

## Settings

`provider: wellfound` + `searchUrl` in a `portals.yml` entry. Authentication is
handled by running `auth.mjs` once, which logs in via a real browser to cache
a session cookie — there are no env vars or API keys to configure.
