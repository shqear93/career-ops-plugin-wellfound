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
//   5. Saves WELLFOUND_COOKIE to .env + job cache to .wellfound-jobs.json
//
// Then run:  node plugins.mjs run wellfound

import { execSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { pbkdf2Sync, createDecipheriv } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ENV_PATH = resolve(ROOT, '.env');
const JOBS_CACHE_PATH = resolve(ROOT, '.wellfound-jobs.json');
const SEARCH_URL = 'https://wellfound.com/jobs?remote=true&locationSlugs[]=everywhere';
const LOGIN_URL = 'https://wellfound.com/login';
const CHROME_BINARY = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function chromeCookiePath() {
  const home = homedir();
  if (platform() === 'darwin') return join(home, 'Library/Application Support/Google/Chrome/Default/Cookies');
  if (platform() === 'linux') return join(home, '.config/google-chrome/Default/Cookies');
  throw new Error('Unsupported OS — only macOS and Linux supported');
}

function getChromeKey() {
  const password = execSync(
    'security find-generic-password -a "Chrome" -s "Chrome Safe Storage" -w',
    { encoding: 'utf8' }
  ).trim();
  return pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}

function decryptCookieValue(encryptedValue, key) {
  if (!encryptedValue || encryptedValue.length === 0) return null;
  const buf = Buffer.from(encryptedValue);
  if (buf.subarray(0, 3).toString() !== 'v10') return null;
  const iv = Buffer.alloc(16, ' ');
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  decipher.setAutoPadding(true);
  try {
    const decrypted = Buffer.concat([decipher.update(buf.subarray(3)), decipher.final()]);
    return decrypted.subarray(32).toString('utf8');
  } catch {
    return null;
  }
}

async function readChromeCookies(domain) {
  const dbPath = chromeCookiePath();
  if (!existsSync(dbPath)) throw new Error(`Chrome cookie DB not found: ${dbPath}`);

  const tmpPath = join('/tmp', `wellfound-cookies-${Date.now()}.db`);
  copyFileSync(dbPath, tmpPath);

  let rows = [];
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(tmpPath, { readonly: true });
    rows = db.prepare(
      `SELECT name, value, encrypted_value, host_key FROM cookies WHERE host_key LIKE ?`
    ).all(`%${domain}%`);
    db.close();
  } catch {
    try {
      const out = execSync(
        `sqlite3 "${tmpPath}" "SELECT name, value, hex(encrypted_value), host_key FROM cookies WHERE host_key LIKE '%${domain}%';"`,
        { encoding: 'utf8' }
      );
      rows = out.trim().split('\n').filter(Boolean).map(line => {
        const parts = line.split('|');
        return {
          name: parts[0],
          value: parts[1],
          encrypted_value: parts[2] ? Buffer.from(parts[2], 'hex') : null,
          host_key: parts[3],
        };
      });
    } catch {
      throw new Error('sqlite3 not found — install it: brew install sqlite3');
    }
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }

  const key = getChromeKey();

  return rows
    .map(r => {
      const value = r.value && r.value.length > 0
        ? r.value
        : decryptCookieValue(r.encrypted_value, key);
      return value ? { name: r.name, value } : null;
    })
    .filter(Boolean);
}

function writeEnv(envPath, vars) {
  let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${value}`;
    if (re.test(content)) content = content.replace(re, line);
    else content = content.trimEnd() + (content ? '\n' : '') + line + '\n';
  }
  writeFileSync(envPath, content, 'utf8');
}

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

    // Read cookies from the DEFAULT Chrome profile (not the temp one, which may not have fresh cookies yet)
    console.log('\nReading Wellfound cookies from Chrome...');
    const cookies = await readChromeCookies('wellfound.com');

    if (!cookies.length) {
      console.warn('Warning: no Wellfound cookies found in Chrome profile. Make sure you are logged in.');
    } else {
      const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      writeEnv(ENV_PATH, { WELLFOUND_COOKIE: cookieHeader });
      console.log(`✓ ${cookies.length} cookies saved to .env`);
    }

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
