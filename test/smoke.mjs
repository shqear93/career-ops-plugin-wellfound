// Zero-network smoke test: imports cleanly and hooks match manifest.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const KINDS = ['provider', 'ingest', 'search', 'notify', 'export'];

const manifest = JSON.parse(readFileSync(path.join(here, '..', 'manifest.json'), 'utf8'));
const mod = await import(path.join(here, '..', manifest.entry || 'index.mjs'));
const hooks = mod.default;

assert(hooks && typeof hooks === 'object', 'default export must be an object of hooks');
const keys = Object.keys(hooks);
assert(keys.length > 0, 'declare at least one hook');
for (const k of keys) assert(KINDS.includes(k), `unknown hook "${k}"`);
for (const h of manifest.hooks) assert(keys.includes(h), `manifest declares hook "${h}" but index.mjs does not export it`);

// Verify provider shape
const p = hooks.provider;
assert(p && typeof p === 'object', 'provider must be an object with id/detect/fetch');
assert(typeof p.id === 'string', 'provider.id must be a string');
assert(typeof p.detect === 'function', 'provider.detect must be a function');
assert(typeof p.fetch === 'function', 'provider.fetch must be a function');

// detect() must reject non-wellfound URLs
assert(p.detect({ searchUrl: 'https://evil.com/?ref=wellfound.com' }) === null, 'detect must reject non-wellfound hostnames');
assert(p.detect({ searchUrl: 'https://wellfound.com/jobs?remote=true' }) !== null, 'detect must accept wellfound.com');
assert(p.detect({ searchUrl: 'https://www.wellfound.com/jobs' }) !== null, 'detect must accept www.wellfound.com');

console.log('✓ smoke ok:', keys.join(', '));
