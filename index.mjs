// @ts-check
// Wellfound plugin — reads job cache produced by auth.mjs.
//
// Setup:
//   1. node plugins.local/wellfound/auth.mjs   ← launches Chrome, scrapes jobs, saves cache
//   2. node plugins.mjs run wellfound           ← reads cache and adds jobs to pipeline

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const JOBS_CACHE_PATH = resolve(ROOT, '.wellfound-jobs.json');
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export default {
  /** @param {any} ctx */
  async ingest(ctx) {
    if (!existsSync(JOBS_CACHE_PATH)) {
      ctx.log('wellfound: no job cache — run: node plugins.local/wellfound/auth.mjs');
      return [];
    }

    let cache;
    try {
      cache = JSON.parse(readFileSync(JOBS_CACHE_PATH, 'utf8'));
    } catch {
      ctx.log('wellfound: corrupt cache — run: node plugins.local/wellfound/auth.mjs');
      return [];
    }

    const ageMs = Date.now() - (cache.timestamp || 0);
    if (ageMs > MAX_CACHE_AGE_MS) {
      const hours = Math.round(ageMs / 3_600_000);
      ctx.log(`wellfound: cache is ${hours}h old — run auth.mjs to refresh`);
    }

    const jobs = cache.jobs || [];
    ctx.log(`wellfound: loaded ${jobs.length} jobs from cache`);
    return jobs;
  },
};
