#!/usr/bin/env node
// auth.mjs — extract Wellfound session cookie and save it to .env
//
// Run once (or whenever the cookie expires):
//   node plugins.local/wellfound/auth.mjs
//
// Opens a visible Chromium window. Log in to wellfound.com normally,
// then come back here — the script detects login and saves the cookie automatically.

const { chromium } = await import('play' + 'wright');
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// Walk up to find career-ops root (.env lives there, not in plugins.local/wellfound/)
const ROOT = resolve(HERE, '..', '..');
const ENV_PATH = resolve(ROOT, '.env');

const LOGIN_URL = 'https://wellfound.com/login';
const JOBS_URL = 'https://wellfound.com/jobs';
const COOKIE_NAME_RE = /^(_wellfound_session|_session|remember_user_token|user_session)/;
const POLL_MS = 1500;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function readEnv(path) {
  if (!existsSync(path)) return {};
  const lines = readFileSync(path, 'utf8').split('\n');
  const out = {};
  for (const line of lines) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function writeEnv(path, vars) {
  let content = existsSync(path) ? readFileSync(path, 'utf8') : '';
  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${value}`;
    if (re.test(content)) {
      content = content.replace(re, line);
    } else {
      content = content.trimEnd() + (content ? '\n' : '') + line + '\n';
    }
  }
  writeFileSync(path, content, 'utf8');
}

async function isLoggedIn(page) {
  try {
    const cookies = await page.context().cookies('https://wellfound.com');
    return cookies.some(c => COOKIE_NAME_RE.test(c.name) && c.value.length > 10);
  } catch {
    return false;
  }
}

function buildCookieHeader(cookies) {
  return cookies
    .filter(c => c.domain.includes('wellfound.com'))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

async function main() {
  console.log('Opening browser — log in to Wellfound, then come back here.');
  console.log('The window will close automatically once login is detected.\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  // Hide navigator.webdriver — the clearest automation signal
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  const deadline = Date.now() + TIMEOUT_MS;
  let loggedIn = false;

  while (Date.now() < deadline) {
    await page.waitForTimeout(POLL_MS);
    if (await isLoggedIn(page)) {
      loggedIn = true;
      break;
    }
  }

  if (!loggedIn) {
    await browser.close();
    console.error('Timed out waiting for login (5 minutes). Run the script again.');
    process.exit(1);
  }

  // Navigate to jobs page to ensure all cookies are set
  await page.goto(JOBS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const cookies = await context.cookies('https://wellfound.com');
  const cookieHeader = buildCookieHeader(cookies);

  await browser.close();

  if (!cookieHeader) {
    console.error('Logged in but could not extract cookies. Try again.');
    process.exit(1);
  }

  writeEnv(ENV_PATH, { WELLFOUND_COOKIE: cookieHeader });
  console.log(`\n✓ Cookie saved to ${ENV_PATH}`);
  console.log('  Run node scan.mjs to scan Wellfound jobs.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
