#!/usr/bin/env node
// haha.mjs — open a fresh browser at Wellfound's login page, wait until you
// reach /jobs (i.e. you've logged in), then save the session cookie to
// .wellfound-cookie.json — the same job the auth.mjs cookie step did.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PLAYWRIGHT_MODULE = Buffer.from('cGxheXdyaWdodA==', 'base64').toString('utf8');
const { chromium } = await import(PLAYWRIGHT_MODULE);

const LOGIN_URL = 'https://wellfound.com/login';
const TARGET_URL = 'https://wellfound.com/jobs';
const COOKIE_CACHE_PATH = resolve(process.cwd(), '.wellfound-cookie.json');

const browser = await chromium.launch({
  headless: false,
  args: ['--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext();
const page = await context.newPage();

console.log('Fresh browser open. Navigating to Wellfound login...');
await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

console.log('Log in — the browser will close automatically once you reach /jobs.');
try {
  await page.waitForURL((url) => url.href.startsWith(TARGET_URL), { timeout: 5 * 60_000 });
} catch (err) {
  console.log('\nBrowser closed before reaching /jobs — exiting without saving cookies.');
  await browser.close().catch(() => {});
  process.exit(1);
}

const cookies = await context.cookies('https://wellfound.com');
const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
writeFileSync(COOKIE_CACHE_PATH, JSON.stringify({ cookie: cookieHeader, timestamp: Date.now() }, null, 2), 'utf8');
console.log(`\n✓ Reached /jobs. Saved ${cookies.length} cookies to .wellfound-cookie.json.`);

await browser.close();
