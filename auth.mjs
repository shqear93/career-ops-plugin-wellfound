#!/usr/bin/env node
// auth.mjs — extract Wellfound session cookie and save it to .env
//
// Run once (or whenever the cookie expires):
//   node plugins.local/wellfound/auth.mjs
//
// Opens your real Chrome (zero automation), you log in normally,
// press Enter — script decrypts cookies from Chrome's SQLite store via Keychain.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { homedir, platform } from 'node:os';
import { pbkdf2Sync, createDecipheriv } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ENV_PATH = resolve(ROOT, '.env');
const LOGIN_URL = 'https://wellfound.com/login';

function chromeCookiePath() {
  const home = homedir();
  if (platform() === 'darwin') return join(home, 'Library/Application Support/Google/Chrome/Default/Cookies');
  if (platform() === 'linux') return join(home, '.config/google-chrome/Default/Cookies');
  throw new Error('Unsupported OS — only macOS and Linux supported');
}

function openBrowser(url) {
  if (platform() === 'darwin') execSync(`open -a "Google Chrome" "${url}"`);
  else execSync(`xdg-open "${url}"`);
}

function prompt(question) {
  return new Promise(res => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, a => { rl.close(); res(a); });
  });
}

// Get Chrome's encryption key from macOS Keychain
function getChromeKey() {
  const password = execSync(
    'security find-generic-password -a "Chrome" -s "Chrome Safe Storage" -w',
    { encoding: 'utf8' }
  ).trim();
  // Chrome derives a 128-bit AES key via PBKDF2-SHA1, 1003 iterations, salt "saltysalt"
  return pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}

// Decrypt a Chrome-encrypted cookie value (v10 prefix + AES-128-CBC)
function decryptCookieValue(encryptedValue, key) {
  if (!encryptedValue || encryptedValue.length === 0) return null;
  const buf = Buffer.from(encryptedValue); // Uint8Array from node:sqlite → Buffer
  if (buf.subarray(0, 3).toString() !== 'v10') return null;
  const iv = Buffer.alloc(16, ' ');
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  decipher.setAutoPadding(true);
  try {
    const decrypted = Buffer.concat([decipher.update(buf.subarray(3)), decipher.final()]);
    return decrypted.subarray(32).toString('utf8'); // skip 32-byte Chrome-internal prefix
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
    // Node 22+ built-in sqlite
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(tmpPath, { readonly: true });
    rows = db.prepare(
      `SELECT name, value, encrypted_value, host_key FROM cookies WHERE host_key LIKE ?`
    ).all(`%${domain}%`);
    db.close();
  } catch {
    // Fallback: sqlite3 CLI — outputs blob as hex with X'' prefix
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

function writeEnv(path, vars) {
  let content = existsSync(path) ? readFileSync(path, 'utf8') : '';
  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${value}`;
    if (re.test(content)) content = content.replace(re, line);
    else content = content.trimEnd() + (content ? '\n' : '') + line + '\n';
  }
  writeFileSync(path, content, 'utf8');
}

async function main() {
  console.log('Opening Wellfound in your real Chrome browser...');
  console.log('Log in normally, then come back here and press Enter.\n');

  openBrowser(LOGIN_URL);

  await prompt('Press Enter once you have logged in to Wellfound...');

  console.log('Reading and decrypting cookies from Chrome...');
  const cookies = await readChromeCookies('wellfound.com');

  if (!cookies.length) {
    console.error('No Wellfound cookies found — make sure you are logged in and try again.');
    process.exit(1);
  }

  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  writeEnv(ENV_PATH, { WELLFOUND_COOKIE: cookieHeader });

  console.log(`\n✓ ${cookies.length} cookies saved to ${ENV_PATH}`);
  console.log('  Run node scan.mjs to scan Wellfound jobs.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
