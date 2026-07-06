# AGENTS.md

Guidance for AI coding agents working in this repo. Humans: see [README.md](README.md).

## What this is

A [career-ops](https://github.com/santifer/career-ops) plugin that surfaces
Wellfound global-remote engineering jobs. Wellfound gates results behind a
login and blocks headless browsers outright (verified empirically: identical
script, only the `headless` flag differed — 403 headless, 200 headed, every
time). So the plugin splits auth from fetching, and fetching stays headed:

- `auth.mjs` is a **standalone script the user runs manually, occasionally**.
  It drives a real Chrome window purely to log in, then saves the resulting
  session cookie to `.wellfound-cookie.json`. It does **not** scrape jobs —
  auth is only auth.
- `index.mjs` is the **plugin hook career-ops calls, on every scan**. It reads
  the cached cookie, launches a **visible** Playwright browser, injects the
  cookie, and scrapes the `searchUrl` from the `portals.yml` entry live. It's
  a `provider` hook, keyed-style like `apify`: it never auto-detects
  (`detect()` returns `null`), it only fires on an explicit
  `provider: wellfound` entry in `portals.yml`, and it rides the host's normal
  `node scan.mjs` run instead of a separate `plugins.mjs run` command.

The split that matters: never make `auth.mjs` responsible for fetching jobs —
that's `index.mjs`'s job, done live via a visible browser on every scan.

## The playwright-in-index.mjs tradeoff (read this before "fixing" it)

career-ops' own `plugin-audit.mjs` forbids importing `playwright` in a
community plugin file — its trust model expects an auto-invoked hook like
`provider.fetch` to egress only through the scoped `ctx.fetch`, not full
browser automation. This plugin needs a real, headed browser (headless fails
Cloudflare), so there's no way to satisfy that model. `index.mjs` imports
`playwright` as a **plain, honest literal** — not obfuscated. Running
`node plugins.mjs add` against this plugin will surface that audit finding;
that's intentional. **Do not "fix" this by obfuscating the import** (e.g. a
base64-decoded module name) to dodge the audit — that was tried once already
in `auth.mjs`'s history and is exactly the kind of quiet control-evasion this
repo's own maintainers would reject. If the audit conflict becomes a real
problem, the fix is a design conversation with the user, not an obfuscation.

## Files

| File | Role |
|------|------|
| `index.mjs` | Plugin entry. Exports `default` object with a `provider: { id, detect, fetch }` hook. `fetch` reads the cached cookie from `.wellfound-cookie.json`, launches a headed Playwright browser, injects the cookie, navigates to `entry.searchUrl`, parses the HTML, returns `Job[]`. |
| `auth.mjs` | Manual CLI. Opens a real (headed) Chrome window, waits for login, saves the session cookie. No job scraping. |
| `manifest.json` | Plugin metadata. `hooks: ["provider"]`, `humanInTheLoop: true`, no declared `allowedHosts` (Playwright bypasses `ctx.fetch`, so the allowlist wouldn't be enforced anyway — see the engine's own "ADVISORY only" note). |
| `skill.md` | Skill text shipped to the user's AI tool. Describes the cookie-auth + live-headed-fetch flow. Update it if you touch the user-facing flow. |
| `test/smoke.mjs` | Zero-network smoke test: imports `index.mjs`, checks hooks match manifest. |
| `README.md` | Human setup/usage docs. |

Generated at runtime (gitignored, at the career-ops project **root**, not here):
`.wellfound-cookie.json` (cache: `{ cookie, timestamp }`).

## Key facts an agent will get wrong otherwise

- **Paths are relative to the career-ops root, not the plugin dir.** Both files
  compute `ROOT = resolve(HERE, '..', '..')` because the plugin is installed at
  `plugins.local/wellfound/`. The cookie cache lives at that root.
- **The cookie is a secret, treat it like one.** `.wellfound-cookie.json`
  contains a live, authenticated Wellfound session (equivalent to a password).
  It must stay gitignored at the career-ops root — never commit it, never log
  its value.
- **Headless does not work here, full stop.** Verified with an A/B test where
  only the `headless` flag changed: 403 (Cloudflare-challenged) headless, 200
  (clean, jobs parsed) headed — reproducibly, across multiple configurations
  (bare, with stealth patches hiding `navigator.webdriver`, with the real
  Chrome binary via `channel: 'chrome'`). Don't "optimize" this back to
  headless assuming it'll work with the right flags; it was tested and it
  doesn't.
- **Enabling requires `--confirm`.** `node plugins.mjs enable wellfound --confirm`
  — this is career-ops's trust-acknowledgement gate for any plugin, unrelated to
  `humanInTheLoop`.
- **Only global-remote jobs.** `parseJobsFromHtml` filters to listings whose
  surrounding HTML matches `everywhere|remote only`. `company` is intentionally
  blank (not reliably parseable). Don't "fix" these as if they were bugs.

## Conventions

- ES modules (`.mjs`), `// @ts-check` in `index.mjs`, Node built-ins only —
  both `auth.mjs` and `index.mjs` import `playwright` (a dev dep of the host
  project), never a hard dependency. `auth.mjs`'s import is historically
  obfuscated (base64) to dodge the audit — leave it as-is, don't propagate
  that pattern into new code (see the audit-tradeoff section above).
- No build step, no framework. Match the existing plain-Node style.

## Verify changes

```bash
node test/smoke.mjs   # fast, no network — always run this
node plugin-audit.mjs <this-dir>   # from career-ops root — expect the playwright finding on index.mjs, that's expected
node auth.mjs          # full manual run; opens Chrome, needs a logged-in Wellfound session
node scan.mjs          # from career-ops root, after auth, with a provider: wellfound portals.yml entry
```

`smoke.mjs` is the only automated test. Run it after any change to `index.mjs`
or `manifest.json`. A full end-to-end check requires the host career-ops project,
a logged-in Chrome, and user interaction — flag that rather than assuming it ran.
