# career-ops-plugin-wellfound

A [career-ops](https://github.com/santifer/career-ops) plugin that surfaces
Wellfound's global-remote engineering job listings in your pipeline.

## How it works

Wellfound gates full results behind a login, and its Cloudflare/DataDome
protection blocks headless browsers outright (verified: identical script,
only the `headless` flag differed — 403 headless, 200 headed, every time). So
this plugin splits auth from fetching, and fetching stays headed:

- **Auth (occasional, run by you).** `auth.mjs` is a standalone script — not a
  hook career-ops calls automatically. It launches Chrome, waits until you
  reach the jobs page, and saves the session cookie to `.wellfound-cookie.json`
  (project root, gitignored). It does not scrape jobs — auth is only auth.
- **Provider (every scan, run by career-ops).** The plugin's `provider` hook
  (`index.mjs`) reads the cached cookie, launches a **visible** Playwright
  browser, injects the cookie, and scrapes your `searchUrl` live — once per
  `provider: wellfound` entry in `portals.yml`.

The upshot: log in once to get a session cookie, and every scan pops a
(visible) browser window per configured entry to fetch fresh listings live.

## A note on the security tradeoff

career-ops' own plugin audit (`plugin-audit.mjs`) forbids importing
`playwright` in a community plugin — its trust model expects automatically
invoked hooks to egress only through the scoped, host-allowlisted `ctx.fetch`,
not full browser automation. This plugin needs a real browser (headless
doesn't get past Cloudflare), so `index.mjs` imports `playwright` as a plain,
honest literal. Running `node plugins.mjs add` against this plugin will
surface that audit finding — that's intentional, not a bug. This plugin is
not registry-listed and isn't going to be; installing it means trusting the
author with real browser automation running as part of your scans, same as
running `auth.mjs` already does.

## Prerequisites

- A working [career-ops](https://github.com/santifer/career-ops) install
- Google Chrome, installed and **logged in to wellfound.com**
- Playwright available in your career-ops project: `npm i -D playwright`
  (skip if already installed)

## Setup (one time)

Run these from your career-ops project root, in order.

**1. Install the plugin**

`--sha` must be a full 40-character commit hash (not a branch or tag — see
[Why a commit SHA?](#why-a-commit-sha)). Get the latest one from this repo:

```bash
git ls-remote https://github.com/shqear93/career-ops-plugin-wellfound HEAD
```

Then install pinned to it:

```bash
node plugins.mjs add shqear93/career-ops-plugin-wellfound --sha <commit-sha>
```

This drops the plugin into `plugins.local/wellfound/`.

**2. Enable it** (if the install step didn't already)

```bash
node plugins.mjs enable wellfound --confirm
```

career-ops requires `--confirm` to enable any plugin: running the command
without it prints a summary of what the plugin does and the capabilities it
grants, then asks you to re-run with `--confirm` to acknowledge. For an
unverified community plugin like this one — with real browser automation, not
just scoped HTTP — that's your chance to review before trusting the author.

Confirm it's active:

```bash
node plugins.mjs list
# wellfound  [provider]  — ✅ enabled
```

**3. Add it to `portals.yml`**

```yaml
tracked_companies:
  - name: "Wellfound — Global Remote"
    provider: wellfound
    searchUrl: "https://wellfound.com/jobs?remote=true&locationSlugs[]=everywhere"
```

**4. Authenticate**

```bash
node plugins.local/wellfound/auth.mjs
```

This opens a Chrome window and waits until you reach the jobs page. You'll see
output like:

```
Fresh browser open. Navigating to Wellfound login...
Log in — the browser will close automatically once you reach /jobs.

✓ Reached /jobs. Saved 15 cookies to .wellfound-cookie.json.
```

## Everyday use

**Run a normal scan** — `scan.mjs` uses the cached cookie to launch a visible
browser per configured `provider: wellfound` entry, fetches your `searchUrl`
live, and feeds the listings into career-ops as job leads, merged with every
other source:

```bash
node scan.mjs
# wellfound: fetched 12 jobs live
```

Expect a Chrome window to pop up (briefly) for each wellfound entry in your
`portals.yml` while this runs.

**Refresh the session** — the cookie is good for roughly 24 hours (Wellfound
sessions rotate). Past that, the plugin still tries the fetch but logs a
warning:

```
wellfound: session cookie is 30h old — if results look empty, re-run auth.mjs
```

Just re-run step 4 (`node plugins.local/wellfound/auth.mjs`) whenever the
cookie goes stale — there's no need to reinstall or re-enable anything.

## Troubleshooting

**No jobs returned / results look empty.** Your session cookie has likely
expired — re-run `node plugins.local/wellfound/auth.mjs` to log in again.

### Why a commit SHA?

career-ops only trusts a curated registry of plugins by name; this plugin isn't
in it (hence the "❓ community-unverified" label you'll see), so `add` requires
an explicit `--sha`. It must be a full 40-character commit hash — career-ops
rejects branch names and tags, and fetches with `--no-tags`, because a tag or
branch can be moved to point at different code after you've reviewed it. A
commit SHA can't — it always resolves to the exact code you're installing.

## Limitations

- Returns only **global-remote** jobs (`Remote · Everywhere`)
- `company` field is blank — employer name can't be reliably extracted from the
  listing page HTML
- If `.wellfound-cookie.json` doesn't exist yet, the provider hook logs a
  reminder to run `auth.mjs` and returns no jobs (it won't error your scan)
- A visible browser window pops up per configured entry, every scan — headless
  doesn't work against Wellfound's bot protection

## License

MIT
