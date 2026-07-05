# career-ops-plugin-wellfound

A [career-ops](https://github.com/santifer/career-ops) plugin that surfaces
Wellfound's global-remote engineering job listings in your pipeline.

## How it works

Wellfound gates full results behind a login, so this plugin doesn't scrape live
on every scan. It works in two phases:

- **Auth (occasional, run by you).** `auth.mjs` is a standalone script — not a
  hook career-ops calls automatically. It launches Chrome with
  `--remote-debugging-port` (using a temp copy of your profile, so your existing
  Wellfound login carries over), connects via the Chrome DevTools Protocol,
  scrapes the rendered jobs page, and writes the results to
  `.wellfound-jobs.json` (project root, gitignored). It also decrypts your
  Wellfound cookies and writes them to `.env` as `WELLFOUND_COOKIE`.
- **Ingest (every scan, run by career-ops).** The plugin's `ingest` hook
  (`index.mjs`) only ever reads `.wellfound-jobs.json`. It makes no network
  calls, needs no `portals.yml` entry, and doesn't read `WELLFOUND_COOKIE` — so
  the cookie in `.env` is currently unused by the plugin itself.

The upshot: one occasional auth step keeps a local cache fresh, and every scan
reads it instantly.

## Prerequisites

- A working [career-ops](https://github.com/santifer/career-ops) install
- Google Chrome, installed and **logged in to wellfound.com**
- Playwright available in your career-ops project: `npm i -D playwright`
  (skip if already installed)
- macOS or Linux (auth.mjs reads Chrome's cookie store; Windows isn't supported)

## Setup (one time)

Run these from your career-ops project root, in order.

**1. Install the plugin**

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
unverified community plugin like this one, that's your chance to review before
trusting the author.

Confirm it's active:

```bash
node plugins.mjs list
# wellfound  [ingest]  — ✅ enabled
```

**3. Authenticate and fetch listings**

```bash
node plugins.local/wellfound/auth.mjs
```

The first time you run this, macOS will pop up a password prompt — the script
needs to read "Chrome Safe Storage" from your Keychain to decrypt Chrome's
cookies. Enter your login password and click **Allow**, or **"Always Allow"** to
skip the prompt on future runs. (See
[Troubleshooting](#troubleshooting) for why.)

It then copies your Chrome profile to a temp dir (so your existing Wellfound
login carries over without a lock conflict), opens a Chrome window, navigates to
the jobs page, and pulls out global-remote listings. You'll see output like:

```
Copying Chrome profile to temp dir (this takes a few seconds)...
Launching Chrome with remote debugging port...
Waiting for Chrome to start...
Chrome CDP port ready.
Connecting to Chrome via CDP...
Navigating to https://wellfound.com/jobs?remote=true&locationSlugs[]=everywhere...
Waiting for jobs to render...
Found 9 global-remote jobs.

Reading Wellfound cookies from Chrome...
✓ 14 cookies saved to .env
✓ 9 jobs cached to .wellfound-jobs.json

Run:  node plugins.mjs run wellfound
```

## Everyday use

**Run the plugin** — reads `.wellfound-jobs.json` and feeds the listings into
career-ops as job leads:

```bash
node plugins.mjs run wellfound
# wellfound: loaded 10 jobs from cache
# wellfound ingest: 10 found, 3 new.
```

New listings flow into your normal career-ops pipeline from here — evaluate them
the same way as any other scanned offer.

**Refresh listings** — the cache is good for 24 hours. Past that, the plugin
still works but logs a warning:

```
wellfound: cache is 87h old — run auth.mjs to refresh
```

Just re-run step 3 (`node plugins.local/wellfound/auth.mjs`) whenever you want
new listings — there's no need to reinstall or re-enable anything.

## Troubleshooting

**auth.mjs reports 0 jobs.** Make sure you're logged in to wellfound.com in your
regular Chrome profile, then run it again.

<details>
<summary><strong>Why does macOS ask for my password during auth?</strong></summary>

It's a macOS **Keychain** prompt (your login password), not `sudo` — no root
access is involved. Here's the chain of why it's needed:

1. **Chrome encrypts your cookies at rest.** They live in a SQLite file
   (`~/Library/Application Support/Google/Chrome/Default/Cookies`), but the
   values aren't plaintext — each is AES-128-CBC encrypted.

2. **The encryption key isn't in that file.** It's derived from a secret Chrome
   stores in your Keychain under the name **"Chrome Safe Storage"**. auth.mjs
   reads that secret and PBKDF2-hashes it (with Chrome's well-known `saltysalt`
   / 1003-iteration constants) to reconstruct the AES key.

3. **macOS gates Keychain reads.** Because auth.mjs isn't Chrome itself, the OS
   won't hand over the secret silently — it shows the password dialog so *you*
   authorize this script to read it.

That secret is the only way to decrypt the cookies, and the cookies are what let
the script reuse your already-logged-in Wellfound session instead of asking you
to log in again. Click **"Always Allow"** to store the authorization and skip
the prompt on future runs; **"Allow"** grants it just once.

</details>

## Limitations

- Returns only **global-remote** jobs (`Remote · Everywhere`)
- `company` field is blank — employer name can't be reliably extracted from the
  listing page HTML
- If `.wellfound-jobs.json` doesn't exist yet, the ingest hook logs a reminder
  to run `auth.mjs` and returns no jobs (it won't error your scan)

## License

MIT
