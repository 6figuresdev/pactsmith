import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDapp, cleanList } from '../src/dapp.js';
import { memoryStore, redisStore, makeStore } from '../src/store.js';
import { renderApp, manifest } from '../src/appPage.js';
import { runAgent } from '../src/agent.js';
import { createServer } from '../src/index.js';
import { createAppHandler } from '../src/vercel.js';
import { buildReceipt } from '../src/receipt.js';
import { validatePact } from '../src/validate.js';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const pactJson = (extra = {}) => ({ reply: 'Done.', ready: true, pact: { template: 'escrow', payee: 'ada.near', amount: '5', deadline: '2026-12-15T12:00:00Z', ...extra } });
const script = (...a) => async () => JSON.stringify(a.shift());
const user = [{ role: 'user', content: 'escrow please' }];

test('dapp: defaults, safe colours, safe text, only allowed labels', () => {
  const d = sanitizeDapp({ name: '  <b>Web</b> deal  ', accent: '#ffffff', theme: 'dark', labels: { release: 'Approve the work', hack: 'x', refund: '<img src=x>' } }, 'escrow');
  assert.equal(d.name, 'bWeb/b deal'.replace('/', '/')); // tags are stripped of angle brackets
  assert.equal(d.accent, '#4f46e5');           // too light for white text, so default
  assert.equal(d.theme, 'dark');
  assert.equal(d.labels.release, 'Approve the work');
  assert.equal(d.labels.hack, undefined);
  assert.ok(!d.labels.refund.includes('<'));
  assert.equal(sanitizeDapp({ accent: '#0e7490' }, 'split').accent, '#0e7490');
  assert.equal(sanitizeDapp({ accent: 'red; background:url(x)' }, 'split').accent, '#4f46e5');
  assert.equal(sanitizeDapp(null, 'payroll').name, 'My payroll');
  assert.deepEqual(cleanList(['a', '', 5, 'b'.repeat(500)]).map((x) => x.length), [1, 160]);
});

test('agent: customisation and unsupported requests flow through, rules stay fixed', async () => {
  const r = await runAgent(user, script({ ...pactJson({ dapp: { name: 'Website job escrow', tagline: 'Pay when the site is approved', accent: '#0e7490', labels: { release: 'Approve the website' } } }), unsupported: ['A referee who can settle disputes'] }), NOW);
  assert.equal(r.ready, true);
  assert.equal(r.pact.dapp.name, 'Website job escrow');
  assert.equal(r.pact.dapp.labels.release, 'Approve the website');
  assert.deepEqual(r.pact.unsupported, ['A referee who can settle disputes']);
  assert.equal(r.pact.initArgs.payee, 'ada.near'); // the AI cannot touch the rules through the dapp object
});

test('receipt: says so when no time of day was given', () => {
  const a = buildReceipt(validatePact({ template: 'escrow', payee: 'ada.near', amount: '5', deadline: '2026-12-15T00:00:00Z' }, NOW)).lines.join(' ');
  const b = buildReceipt(validatePact({ template: 'escrow', payee: 'ada.near', amount: '5', deadline: '2026-12-15T12:00:00Z' }, NOW)).lines.join(' ');
  assert.match(a, /midnight UTC was assumed/); assert.doesNotMatch(b, /assumed/);
});

test('store: memory store saves, reads, and rejects bad ids', async () => {
  const s = memoryStore(); const id = await s.save({ x: 1 });
  assert.match(id, /^[A-Za-z0-9_-]{12}$/); assert.deepEqual(await s.get(id), { x: 1 });
  assert.equal(await s.get('nope'), null); assert.equal(await s.get('../../etc/passwd'), null);
});

test('store: redis store speaks the REST pipeline; Vercel without Redis disables links', async () => {
  const calls = []; const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { const c = JSON.parse(init.body); calls.push(c[0]); return { ok: true, json: async () => [{ result: c[0][0] === 'GET' ? JSON.stringify({ y: 2 }) : 'OK' }] }; };
  try {
    const s = redisStore({ url: 'https://r.example', token: 't' }); const id = await s.save({ y: 2 });
    assert.equal(calls[0][0], 'SET'); assert.equal(calls[0][3], 'EX'); assert.ok(calls[0][1].startsWith('pm:b:'));
    assert.deepEqual(await s.get(id), { y: 2 }); assert.equal(await s.get('bad id!'), null);
  } finally { globalThis.fetch = real; }
  assert.equal(makeStore({ VERCEL: '1' }), null);
  assert.equal(makeStore({}).memory, true);
});

const build = (over = {}) => ({ template: 'escrow', initArgs: { payer: '{{wallet}}', payee: 'ada.near', amount: '5000000000000000000000000', deadline_ns: '1' }, receipt: { title: 'Escrow', lines: ['a line'], facts: [{ label: 'Amount', value: '5 NEAR' }] }, dapp: sanitizeDapp({ name: 'My app' }, 'escrow'), unsupported: [], ...over });

test('app page: hostile text cannot break out of the page or the JSON', () => {
  const evil = '</script><script>alert(1)</script>';
  const b = build({ receipt: { title: evil, lines: [evil], facts: [{ label: evil, value: evil }] }, unsupported: [evil], dapp: { ...sanitizeDapp({ name: evil, tagline: evil }, 'escrow') } });
  const html = renderApp(b, 'abc123def456');
  assert.ok(!html.includes(evil));
  assert.equal((html.match(/<script/g) || []).length, 2); // only our two script tags
  assert.ok(html.includes('manifest.webmanifest'));
  assert.deepEqual(Object.keys(manifest(b, 'abc123def456')).includes('start_url'), true);
  assert.equal(manifest(b, 'abc123def456').start_url, '/app/abc123def456');
});

test('local server: builds get a link that opens an app, with a manifest', async () => {
  const s = createServer({ complete: script(pactJson({ dapp: { name: 'Website job escrow' } })), env: {}, now: () => NOW });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  try {
    const r = await (await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: user }) })).json();
    assert.equal(r.ready, true); assert.match(r.pact.url, /^\/app\/[A-Za-z0-9_-]{12}$/);
    const page = await fetch(base + r.pact.url); assert.equal(page.status, 200);
    assert.match(await page.text(), /Website job escrow/);
    const man = await (await fetch(base + r.pact.url + '/manifest.webmanifest')).json(); assert.equal(man.name, 'Website job escrow');
    assert.equal((await fetch(`${base}/app/AAAAAAAAAAAA`)).status, 404);
  } finally { await new Promise((ok) => s.close(ok)); }
});

test('vercel app handler: page, manifest and not-found', async () => {
  const store = memoryStore(); const id = await store.save(build());
  const res = () => { const r = { h: {}, setHeader(k, v) { r.h[k] = v; }, status(c) { r.code = c; return r; }, send(b) { r.body = b; return r; } }; return r; };
  const a = res(); await createAppHandler({ store })({ query: { id } }, a); assert.equal(a.code, 200); assert.match(a.body, /My app/);
  const m = res(); await createAppHandler({ store, kind: 'manifest' })({ query: { id } }, m); assert.equal(JSON.parse(m.body).start_url, `/app/${id}`);
  const n = res(); await createAppHandler({ store })({ query: { id: 'zzzzzzzzzzzz' } }, n); assert.equal(n.code, 404);
  const x = res(); await createAppHandler({ store: null })({ query: { id } }, x); assert.equal(x.code, 404);
});
