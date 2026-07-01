// @ts-check
// Wellfound plugin — scrapes the public job search page to surface global-remote roles.
//
// Wellfound gates full results behind a login session. To get results:
//   1. Log in to wellfound.com in your browser
//   2. Copy your session cookie (e.g. from DevTools → Application → Cookies)
//   3. Add WELLFOUND_COOKIE=<value> to your .env
//
// Without a cookie the provider still runs but returns fewer (or no) results.
//
// portals.yml entry:
//   - name: Wellfound Remote Engineering
//     provider: wellfound
//     searchUrl: "https://wellfound.com/jobs?remote=true&keywords=platform+engineer&locationSlugs[]=everywhere"
//     enabled: true

const DEFAULT_TIMEOUT_MS = 20_000;
const ALLOWED_HOSTS = /^(www\.)?wellfound\.com$/;

/**
 * @param {string} rawUrl
 * @returns {boolean}
 */
function isWellfoundUrl(rawUrl) {
  try {
    const { hostname } = new URL(rawUrl);
    return ALLOWED_HOSTS.test(hostname);
  } catch {
    return false;
  }
}

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
    const salary = parseSalary(context);

    // Only keep jobs explicitly marked as global-remote
    const isGlobalRemote = /everywhere|remote only everywhere/i.test(context);
    if (!isGlobalRemote) continue;

    jobs.push({ title, url, company: '', location: 'Remote · Everywhere', salary });
  }

  return jobs;
}

export default {
  provider: {
    id: 'wellfound',

    /** @param {any} entry */
    detect(entry) {
      const raw = entry.careers_url || entry.searchUrl || '';
      return isWellfoundUrl(raw) ? { url: raw } : null;
    },

    /** @param {any} entry @param {any} ctx */
    fetch: async function fetchJobs(entry, ctx) {
      const searchUrl = entry.searchUrl || entry.careers_url;
      if (!searchUrl) throw new Error('wellfound: missing searchUrl in portals.yml entry');
      if (!isWellfoundUrl(searchUrl)) throw new Error(`wellfound: searchUrl "${searchUrl}" is not a wellfound.com URL`);

      const cookie = ctx?.env?.WELLFOUND_COOKIE || '';
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      };
      if (cookie) headers['Cookie'] = cookie;

      const html = await ctx.fetchText(searchUrl, {
        headers,
        redirect: 'error',
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });

      if (!html || html.length < 500) {
        const hint = cookie ? '' : ' (tip: set WELLFOUND_COOKIE in .env to get full results)';
        throw new Error(`wellfound: response too short — Wellfound may require authentication${hint}`);
      }

      return parseJobsFromHtml(html);
    },
  },
};
