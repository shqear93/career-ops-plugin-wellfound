# AGENTS.md

Guidance for AI coding agents working in this repo. Humans: see [README.md](README.md).

## What this is

A [career-ops](https://github.com/santifer/career-ops) plugin that surfaces
Wellfound global-remote engineering jobs. Wellfound gates results behind a login,
so the plugin **does not scrape on every scan**. Instead:

- `auth.mjs` is a **standalone script the user runs manually**. It drives the
  user's real Chrome, scrapes the jobs page, and writes a local cache.
- `index.mjs` is the **plugin hook career-ops calls**. It only ever reads that
  cache — no network, no keys, no `portals.yml` entry.

The split matters: never move scraping/browser/network logic into `index.mjs`,
and never make the `ingest` hook do I/O beyond reading the cache file.

## Files

| File | Role |
|------|------|
| `index.mjs` | Plugin entry. Exports `default` object with an `ingest(ctx)` hook. Reads `.wellfound-jobs.json`, warns if >24h old, returns `Job[]`. |
| `auth.mjs` | Manual CLI. Copies the Chrome profile, launches Chrome w/ CDP, scrapes jobs, writes the cache. No cookie/`.env` handling. |
| `manifest.json` | Plugin metadata. `hooks: ["ingest"]`, `humanInTheLoop: true`, no env/hosts. |
| `skill.md` | Skill text shipped to the user's AI tool. Describes the CDP-auth + ingest-cache flow. Update it if you touch the user-facing flow. |
| `test/smoke.mjs` | Zero-network smoke test: imports `index.mjs`, checks hooks match manifest. |
| `README.md` | Human setup/usage docs. |

Generated at runtime (gitignored, at the career-ops project **root**, not here):
`.wellfound-jobs.json` (cache: `{ jobs, timestamp }`).

## Key facts an agent will get wrong otherwise

- **Paths are relative to the career-ops root, not the plugin dir.** Both files
  compute `ROOT = resolve(HERE, '..', '..')` because the plugin is installed at
  `plugins.local/wellfound/`. The cache lives at that root.
- **No secrets, no Keychain, no `.env`.** Auth works purely by reusing the
  logged-in Chrome session over CDP — there's no cookie decryption and no
  password prompt. Don't reintroduce cookie/`.env` handling.
- **Enabling requires `--confirm`.** `node plugins.mjs enable wellfound --confirm`
  — this is career-ops's trust-acknowledgement gate for any plugin, unrelated to
  `humanInTheLoop`.
- **macOS only.** `auth.mjs` hardcodes the macOS Chrome binary path
  (`/Applications/Google Chrome.app/...`) and profile dir
  (`~/Library/Application Support/Google/Chrome/Default`); Linux/Windows unsupported.
- **Only global-remote jobs.** `parseJobLinks` filters to listings whose
  surrounding HTML matches `everywhere|remote only`. `company` is intentionally
  blank (not reliably parseable). Don't "fix" these as if they were bugs.

## Conventions

- ES modules (`.mjs`), `// @ts-check` in `index.mjs`, Node built-ins only —
  `auth.mjs` dynamically imports `playwright` (a dev dep of the host project),
  never a hard dependency.
- No build step, no framework. Match the existing plain-Node style.

## Verify changes

```bash
node test/smoke.mjs            # fast, no network — always run this
node auth.mjs                  # full manual run; opens Chrome, needs a logged-in Wellfound session
node plugins.mjs run wellfound # from career-ops root, after auth
```

`smoke.mjs` is the only automated test. Run it after any change to `index.mjs`
or `manifest.json`. A full end-to-end check requires the host career-ops project,
a logged-in Chrome, and user interaction — flag that rather than assuming it ran.
