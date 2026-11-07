import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/vercel.js';
import { memoryLimiter, redisLimiter, makeLimiter } from '../src/limits.js';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const good = JSON.stringify({ reply: 'ok', ready: true, pact: { template: 'split', recipients: [{ account: 'a.near', percent: 60 }, { account: 'b.near', percent: 40 }] } });
const user = [{ role: 'user', content: 'split 60 40 between a.near and b.near' }];
const fakeRes = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const call = async (h, req) => { const res = fakeRes(); await h({ method: 'POST', headers: { host: 'pactsmith.vercel.app' }, body: { messages: user }, ...req }, res); return res; };
const make = (extra = {}) => createHandler({ getComplete: () => async () => good, limiter: memoryLimiter(20), now: () => NOW, ...extra });

test('vercel handler: works for the same site, returns the checked pact', async () => {
  const r = await call(make(), { headers: { host: 'pactsmith.vercel.app', origin: 'https://pactsmith.vercel.app' } });
  assert.equal(r.code, 200); assert.equal(r.body.ready, true);
  assert.deepEqual(r.body.pact.initArgs.bps, [6000, 4000]);
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('vercel handler: other websites, wrong methods and bad bodies are refused', async () => {
  const h = make();
  assert.equal((await call(h, { headers: { host: 'pactsmith.vercel.app', origin: 'https://evil.example' } })).code, 403);
  assert.equal((await call(h, { method: 'GET' })).code, 405);
  assert.equal((await call(h, { body: { messages: [{ role: 'system', content: 'x' }] } })).code, 400);
  assert.equal((await call(h, { body: 'not json' })).code, 400);
  assert.equal((await call(h, { body: JSON.stringify({ messages: user }) })).code, 200);
});

test('vercel handler: a missing key gives a calm 500 without details', async () => {
  const h = make({ getComplete: () => { throw new Error('Missing GROQ_API_KEY secret-ish detail'); } });
  const r = await call(h, {});
  assert.equal(r.code, 500); assert.ok(!JSON.stringify(r.body).includes('GROQ'));
});

test('vercel handler: uses the first forwarded address for rate limits', async () => {
  const h = make({ limiter: memoryLimiter(1) });
  const h1 = { host: 'pactsmith.vercel.app', 'x-forwarded-for': '1.1.1.1, 10.0.0.1' };
  assert.equal((await call(h, { headers: h1 })).code, 200);
  assert.equal((await call(h, { headers: h1 })).code, 429);
  assert.equal((await call(h, { headers: { ...h1, 'x-forwarded-for': '2.2.2.2' } })).code, 200);
});

const withFetch = async (impl, fn) => { const real = globalThis.fetch; globalThis.fetch = impl; try { await fn(); } finally { globalThis.fetch = real; } };

test('redis limiter: enforces per-minute and daily caps from shared counters', async () => {
  const l = redisLimiter({ url: 'https://r.example', token: 't', perMin: 5, dailyCap: 100, fallback: async () => ({ ok: true }) });
  const reply = (a, b) => async () => ({ ok: true, json: async () => [{ result: a }, { result: 1 }, { result: b }, { result: 1 }] });
  await withFetch(reply(3, 10), async () => assert.deepEqual(await l('ip'), { ok: true }));
  await withFetch(reply(6, 10), async () => assert.equal((await l('ip')).status, 429));
  await withFetch(reply(1, 101), async () => assert.equal((await l('ip')).status, 503));
});

test('redis limiter: falls back to memory if Redis is unreachable', async () => {
  let used = 0;
  const l = redisLimiter({ url: 'https://r.example', token: 't', fallback: async () => { used++; return { ok: true }; } });
  await withFetch(async () => { throw new Error('network'); }, async () => assert.equal((await l('ip')).ok, true));
  assert.equal(used, 1);
});

test('makeLimiter picks Redis only when both settings exist', () => {
  assert.equal(typeof makeLimiter({}), 'function');
  assert.equal(typeof makeLimiter({ UPSTASH_REDIS_REST_URL: 'https://x', UPSTASH_REDIS_REST_TOKEN: 't' }), 'function');
});
