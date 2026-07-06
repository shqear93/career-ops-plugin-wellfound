// @ts-check
// Wellfound plugin — fetches jobs live via a real (visible) Playwright
// browser, authenticated with the session cookie auth.mjs caches to
// .wellfound-cookie.json.
//
// Setup:
//   1. node plugins.local/wellfound/auth.mjs   ← log in once, caches the
//                                                  session cookie
//   2. node scan.mjs                            ← every scan launches a
//                                                  visible browser per entry,
//                                                  injects the cookie, and
//                                                  scrapes live
//
// Why headed, not headless? Wellfound's Cloudflare/DataDome protection
// blocks headless outright — verified with an identical script where only
// the `headless` flag differed: 403 headless, 200 headed, every time. A
// visible window per scan is a deliberate tradeoff, not an oversight.
//
// Why a literal `import('playwright')` and not something cleverer? Career-ops'
// own plugin-audit.mjs forbids importing playwright in a community plugin
// (egress is meant to go through ctx.fetch only). This hook needs a real
// browser and there's no way around that — so the import stays a plain,
// honest literal. Re-running `node plugins.mjs add` against this plugin will
// surface that finding truthfully; that's intentional, not a bug to hide.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const COOKIE_CACHE_PATH = resolve(ROOT, '.wellfound-cookie.json');
const MAX_COOKIE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours — Wellfound sessions rotate

/**
 * Parse salary range from job text like "$90k - $160k" or "$135k - $165k"
 * @param {string} text
 * @returns {{min: number, max: number, currency: string}|null}
 */
function parseSalary(text) {
  const match = text.match(/\$(\d+)k?\s*[–-]\s*\$(\d+)k?/i);
  if (!match) return null;
  const min = parseInt(match[1], 10) * (match[1].length <= 3 ? 1000 : 1);
  const max = parseInt(match[2], 10) * (match[2].length <= 3 ? 1000 : 1);
  return { min, max, currency: 'USD' };
}

/**
 * Extract jobs from a Wellfound search-results page. Wellfound renders job
 * cards with consistent link patterns: /jobs/{id}-{slug}
 * @param {string} html
 * @returns {Array<{title: string, url: string, company: string, location: string, salary: {min:number,max:number,currency:string}|null}>}
 */
function parseJobsFromHtml(html) {
  const jobs = [];
  const seen = new Set();
  const jobLinkRe = /href="(\/jobs\/(\d+)-([^"]+))"/g;
  let match;

  while ((match = jobLinkRe.exec(html)) !== null) {
    const path = match[1];
    const id = match[2];
    if (seen.has(id)) continue;
    seen.add(id);

    // Skip nav links (home/applications/starred/etc. share the /jobs/ prefix)
    if (['home', 'applications', 'starred', 'hidden', 'messages'].some(s => path.includes(s))) continue;

    const slug = match[3];
    const title = slug
      .replace(/-at-[^-].*$/, '') // remove "-at-company" suffix
      .replace(/-\d+$/, '')        // remove trailing ID
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    const contextStart = Math.max(0, match.index - 200);
    const contextEnd = Math.min(html.length, match.index + 400);
    const context = html.slice(contextStart, contextEnd);
    const salary = parseSalary(context);
    const isGlobalRemote = /everywhere|remote only everywhere/i.test(context);

    jobs.push({
      title,
      url: 'https://wellfound.com' + path,
      company: '', // not reliably parseable from the listing page
      location: isGlobalRemote ? 'Remote · Everywhere' : '',
      salary,
    });
  }

  // Global-remote only — matches this plugin's stated scope.
  return jobs.filter(j => j.location === 'Remote · Everywhere');
}

/**
 * Turn a "name=value; name2=value2" cookie header string back into cookie
 * objects Playwright's addCookies() accepts.
 * @param {string} cookieHeader
 */
function parseCookiePairs(cookieHeader) {
  return cookieHeader.split('; ').filter(Boolean).map(pair => {
    const idx = pair.indexOf('=');
    return { name: pair.slice(0, idx), value: pair.slice(idx + 1), domain: '.wellfound.com', path: '/' };
  });
}

export default {
  provider: {
    id: 'wellfound',
    // Keyed-style, like apify — never auto-detect; only fires on an explicit
    // `provider: wellfound` portals.yml entry.
    detect() { return null; },

    /** @param {any} entry @param {any} ctx */
    fetch: async (entry, ctx) => {
      const searchUrl = entry.searchUrl;
      if (!searchUrl) throw new Error('wellfound: missing searchUrl in portals.yml entry');

      if (!existsSync(COOKIE_CACHE_PATH)) {
        ctx.log('wellfound: no session cookie cached — run node plugins.local/wellfound/auth.mjs');
        return [];
      }

      let cookieCache;
      try {
        cookieCache = JSON.parse(readFileSync(COOKIE_CACHE_PATH, 'utf8'));
      } catch {
        ctx.log('wellfound: cookie cache is corrupt (.wellfound-cookie.json) — re-run auth.mjs');
        return [];
      }

      const ageMs = Date.now() - (cookieCache.timestamp || 0);
      if (ageMs > MAX_COOKIE_AGE_MS) {
        const hours = Math.round(ageMs / 3_600_000);
        ctx.log(`wellfound: session cookie is ${hours}h old — if results look empty, re-run auth.mjs`);
      }

      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: false });
      let jobs = [];
      try {
        const context = await browser.newContext();
        await context.addCookies(parseCookiePairs(cookieCache.cookie));
        const page = await context.newPage();
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
        const html = await page.content();
        jobs = parseJobsFromHtml(html);
      } finally {
        await browser.close();
      }

      ctx.log(`wellfound: fetched ${jobs.length} jobs live`);
      return jobs;
    },
  },
};
