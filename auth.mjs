#!/usr/bin/env node
// auth.mjs — authenticate with Wellfound and cache job listings
//
// Run once (or whenever the cookie expires / cache goes stale):
//   node plugins.local/wellfound/auth.mjs
//
// What it does:
//   1. Copies your real Chrome profile to a temp dir
//   2. Launches Chrome with --remote-debugging-port=9222 (no lock conflicts)
//   3. You log in to Wellfound if needed (already logged in from your profile)
//   4. Connects via CDP → navigates to jobs page → extracts listings
//   5. Saves the job cache to .wellfound-jobs.json
//
// Then run:  node plugins.mjs run wellfound

import { execSync, spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const JOBS_CACHE_PATH = resolve(ROOT, '.wellfound-jobs.json');
const SEARCH_URL = 'https://wellfound.com/jobs?remote=true&locationSlugs[]=everywhere';
const LOGIN_URL = 'https://wellfound.com/login';
const CHROME_BINARY = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function waitForPort(port, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`Chrome debug port ${port} not available after ${timeoutMs}ms`);
}

async function launchChromeWithCDP() {
  const home = homedir();
  const srcProfile = join(home, 'Library/Application Support/Google/Chrome/Default');
  const tmpDir = join('/tmp', `chrome-wellfound-${Date.now()}`);
  const tmpDefault = join(tmpDir, 'Default');

  console.log('Copying Chrome profile to temp dir (this takes a few seconds)...');
  mkdirSync(tmpDir, { recursive: true });
  execSync(`cp -r "${srcProfile}" "${tmpDefault}"`, { stdio: 'ignore' });

  console.log('Launching Chrome with remote debugging port...');
  const child = spawn(CHROME_BINARY, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${tmpDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-popup-blocking',
    LOGIN_URL,
  ], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  console.log('Waiting for Chrome to start...');
  await waitForPort(9222, 15_000);
  console.log('Chrome CDP port ready.');

  return { tmpDir, pid: child.pid };
}

function parseJobLinks(html) {
  const jobs = [];
  const seen = new Set();
  const re = /href="(\/jobs\/(\d+)-([^"]+))"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const path = m[1];
    const id = m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    if (['home', 'applications', 'starred', 'hidden', 'messages'].some(s => path.includes(s))) continue;
    const slug = m[3];
    const title = slug
      .replace(/-at-[^-].*$/, '')
      .replace(/-\d+$/, '')
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    const contextStart = Math.max(0, m.index - 200);
    const contextEnd = Math.min(html.length, m.index + 400);
    const ctx = html.slice(contextStart, contextEnd);
    if (!/everywhere|remote only/i.test(ctx)) continue;
    jobs.push({ title, url: 'https://wellfound.com' + path, company: '', location: 'Remote · Everywhere' });
  }
  return jobs;
}

async function scrapeViaCDP() {
  const { chromium } = await import('playwright');

  console.log('Connecting to Chrome via CDP...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');

  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();

  console.log(`Navigating to ${SEARCH_URL}...`);
  const page = await context.newPage();
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Wait for React to render job cards (they load via GraphQL after hydration)
  console.log('Waiting for jobs to render...');
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

  const html = await page.content();
  const jobs = parseJobLinks(html);

  console.log(`Found ${jobs.length} global-remote jobs.`);

  await browser.close();

  return jobs;
}

async function main() {
  let tmpDir = null;

  try {
    const { tmpDir: dir } = await launchChromeWithCDP();
    tmpDir = dir;

    const jobs = await scrapeViaCDP();

    if (jobs.length > 0) {
      const cache = { jobs, timestamp: Date.now() };
      writeFileSync(JOBS_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
      console.log(`✓ ${jobs.length} jobs cached to .wellfound-jobs.json`);
      console.log('\nRun:  node plugins.mjs run wellfound');
    } else {
      console.error('\nNo jobs found. Try logging in to Wellfound and running again.');
      process.exit(1);
    }
  } finally {
    if (tmpDir) {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
    // Kill the CDP Chrome we launched
    try {
      execSync(`pkill -f "remote-debugging-port=9222"`, { stdio: 'ignore' });
    } catch {}
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
