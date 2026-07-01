---
name: career-ops-plugin-wellfound
description: How to configure and run the Wellfound provider plugin.
license: MIT
---

# career-ops-plugin-wellfound

Scrapes Wellfound's public job search page and returns global-remote job listings.

## Setup

Wellfound gates full results behind a login. For best results:

1. Log in to wellfound.com in your browser
2. Open DevTools → Application → Cookies → `wellfound.com`
3. Copy the value of the session cookie (usually `_session` or similar)
4. Add it to your `.env`:
   ```
   WELLFOUND_COOKIE=<your-cookie-value>
   ```

Without a cookie the provider still runs but may return empty results.

## portals.yml entry

```yaml
tracked_companies:
  - name: Wellfound Remote Engineering
    provider: wellfound
    searchUrl: "https://wellfound.com/jobs?remote=true&keywords=platform+engineer&locationSlugs[]=everywhere"
    enabled: true
```

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

No non-secret settings. Authentication is handled via `WELLFOUND_COOKIE` in `.env`.
