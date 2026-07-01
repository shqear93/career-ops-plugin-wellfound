// @ts-check
// Wellfound plugin — scrapes the public job search page to surface global-remote roles.
//
// Setup:
//   1. Run: node plugins.local/wellfound/auth.mjs
//      (opens Chrome, log in, cookies saved to .env automatically)
//   2. Run: node plugins.mjs run wellfound
//      (fetches jobs and adds them to data/pipeline.md)

const DEFAULT_TIMEOUT_MS = 20_000;
const SEARCH_URL = 'https://wellfound.com/jobs?remote=true&locationSlugs[]=everywhere';

/**
 * @param {string} text
 * @returns {{min: number, max: number, currency: string}|null}
 */
function parseSalary(text) {
  const match = text.match(/\$(\d+)k?\s*[–-]\s*\$(\d+)k?/i);
  if (!match) return null;
  const min = parseInt(match[1]) * (match[1].length <= 3 ? 1000 : 1);
  const max = parseInt(match[2]) * (match[2].length <= 3 ? 1000 : 1);
  return { min, max, currency: 'USD' };
}

/**
 * @param {string} html
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
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

    if (['home', 'applications', 'starred', 'hidden', 'messages'].some(s => path.includes(s))) continue;

    const url = 'https://wellfound.com' + path;
    const slug = match[3];
    const title = slug
      .replace(/-at-[^-].*$/, '')
      .replace(/-\d+$/, '')
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    const contextStart = Math.max(0, match.index - 200);
    const contextEnd = Math.min(html.length, match.index + 400);
    const context = html.slice(contextStart, contextEnd);

    const isGlobalRemote = /everywhere|remote only everywhere/i.test(context);
    if (!isGlobalRemote) continue;

    jobs.push({ title, url, company: '', location: 'Remote · Everywhere' });
  }

  return jobs;
}

export default {
  /** @param {any} ctx */
  async ingest(ctx) {
    const cookie = ctx?.env?.WELLFOUND_COOKIE || '';
    if (!cookie) {
      ctx.log('wellfound: no WELLFOUND_COOKIE set — run auth.mjs first');
      return [];
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': cookie,
    };

    const html = await ctx.fetchText(SEARCH_URL, {
      headers,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });

    if (!html || html.length < 500) {
      throw new Error('wellfound: response too short — cookie may have expired, run auth.mjs again');
    }

    return parseJobsFromHtml(html);
  },
};
