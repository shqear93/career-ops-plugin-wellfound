---
name: career-ops-plugin-wellfound
description: How to configure and run the Wellfound provider plugin.
license: MIT
---

# career-ops-plugin-wellfound

Scrapes Wellfound's public job search page and returns global-remote job listings.

## Setup

Wellfound gates full results behind a login, so the plugin doesn't scrape live
on every scan. Instead, run the standalone auth script — it drives your real,
already-logged-in Chrome browser (via CDP) to fetch listings into a local cache:

```bash
node plugins.local/wellfound/auth.mjs
```

This writes `.wellfound-jobs.json`. Re-run it whenever you want fresh listings
(the cache is good for 24 hours). No `portals.yml` entry, `.env`, or API key is
needed — the ingest hook only reads the cache file.

## How to run it

```bash
node plugins.mjs run wellfound
```

## What it produces

`Job[]` — each entry has:
- `title` — derived from the URL slug
- `url` — direct link to the job posting on wellfound.com
- `company` — blank (employer name isn't reliably parseable from the listing page)
- `location` — `"Remote · Everywhere"` (only global-remote jobs are returned)

## Settings

None. Authentication is handled by running `auth.mjs`, which reuses your logged-in
Chrome session — there are no env vars or secrets to configure.
