import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleDeploy } from '../src/deploy.js';
import { deployPact, base58, sha256, contractIdFor, resolveInitArgs, isTestnetAccount, checkOnChain } from '../src/near.js';
import { memoryStore } from '../src/store.js';
import { handleChat } from '../src/chat.js';
import { renderApp } from '../src/appPage.js';
import { memoryLimiter } from '../src/limits.js';
import { createServer } from '../src/index.js';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 9, 9, 9]);
const HASH = base58(sha256(WASM));
const env = { NEAR_FACTORY_ACCOUNT: 'pactsmith-factory.testnet', NEAR_FACTORY_KEY: 'ed25519:test' };
const owner = 'secret-owner-key';
const build = () => ({ template: 'escrow', initArgs: { payer: '{{wallet}}', payee: 'ada.near', amount: '5000000000000000000000000', deadline_ns: '1800000000000000000' }, receipt: { title: 'Escrow', lines: ['x'], facts: [] }, dapp: { name: 'A', tagline: '', accent: '#4f46e5', theme: 'light', labels: { deposit: 'd', release: 'r', return: 'b', refund: 'f' } }, unsupported: [], ownerHash: createHash('sha256').update(owner).digest('hex') });
const act = (n) => ({ n });
const fakeActions = { createAccount: () => act('create'), transfer: (y) => ({ n: 'transfer', y }), deployContract: (c) => ({ n: 'deploy', c }), functionCall: (m, a, g, d) => ({ n: 'call', m, a, g, d }), addKey: () => act('addKey') };
const mkDeps = (over = {}) => { const sent = []; return { sent, wasm: WASM, actions: fakeActions, account: { async signAndSendTransaction(tx) { sent.push(tx); return { transaction: { hash: 'TXHASH' } }; } }, rpc: async (_m, p) => (p.request_type === 'view_code' ? { hash: HASH } : { keys: [] }), ...over }; };
async function setup(over = {}) { const store = memoryStore(); const id = await store.save(build()); return { store, id, deps: mkDeps(over.deps), limiter: over.limiter || memoryLimiter(50) }; }
const call = (s, body, extra = {}) => handleDeploy({ body, store: s.store, limiter: s.limiter, ip: '1.1.1.1', env, deps: s.deps, now: NOW, ...extra });

test('near helpers: base58, ids, markers, testnet accounts', () => {
  assert.equal(base58(new Uint8Array([0, 0, 1])), '112'); assert.equal(base58(new Uint8Array([255])), '5Q');
  assert.match(contractIdFor('abcDEF_-1234', 'f.testnet'), /^p-[0-9a-f]{12}\.f\.testnet$/);
  assert.deepEqual(resolveInitArgs({ payer: '{{wallet}}', start_ns: '{{now_ns}}', n: 1 }, { wallet: 'a.testnet', nowNs: 5n }), { payer: 'a.testnet', start_ns: '5', n: 1 });
  assert.ok(isTestnetAccount('alice.testnet')); assert.ok(!isTestnetAccount('alice.near')); assert.ok(!isTestnetAccount('x'));
});

test('launch: ONE transaction creates, funds, deploys and sets up, and never adds a key', async () => {
  const s = await setup(); const r = await call(s, { id: s.id, wallet: 'alice.testnet', owner });
  assert.equal(r.status, 200); assert.equal(s.deps.sent.length, 1);
  const tx = s.deps.sent[0];
  assert.deepEqual(tx.actions.map((a) => a.n), ['create', 'transfer', 'deploy', 'call']);
  assert.ok(!tx.actions.some((a) => a.n === 'addKey'));
  assert.equal(tx.receiverId, contractIdFor(s.id, env.NEAR_FACTORY_ACCOUNT));
  const c = tx.actions[3]; assert.equal(c.m, 'new'); assert.equal(c.a.payer, 'alice.testnet'); assert.equal(c.a.payee, 'ada.near'); assert.equal(c.d, 0n);
  assert.ok(tx.actions[1].y > BigInt(WASM.length) * 10n ** 19n);
  assert.equal(r.json.deployed.payer, 'alice.testnet'); assert.equal(r.json.deployed.codeHash, HASH);
  assert.equal((await s.store.get(s.id)).deployed.contractId, tx.receiverId);
});

test('launch: only the builder can launch, and only once', async () => {
  const s = await setup();
  assert.equal((await call(s, { id: s.id, wallet: 'eve.testnet', owner: 'guess' })).status, 403);
  assert.equal((await call(s, { id: s.id, wallet: 'eve.testnet' })).status, 403);
  assert.equal(s.deps.sent.length, 0);
  assert.equal((await call(s, { id: s.id, wallet: 'alice.testnet', owner })).status, 200);
  const again = await call(s, { id: s.id, wallet: 'bob.testnet', owner });
  assert.equal(again.status, 409); assert.equal(s.deps.sent.length, 1);
  assert.equal(again.json.deployed.payer, 'alice.testnet');
});

test('launch: bad wallet, unknown build, switched off, rate limit', async () => {
  const s = await setup();
  assert.equal((await call(s, { id: s.id, wallet: 'alice.near', owner })).status, 400);
  assert.equal((await call(s, { id: s.id, wallet: '<script>', owner })).status, 400);
  assert.equal((await call(s, { id: 'AAAAAAAAAAAA', wallet: 'alice.testnet', owner })).status, 404);
  assert.equal((await handleDeploy({ body: { id: s.id, wallet: 'alice.testnet', owner }, store: s.store, limiter: s.limiter, ip: 'x', env: {}, deps: {}, now: NOW })).status, 503);
  const tight = await setup({ limiter: memoryLimiter(1) });
  await call(tight, { id: tight.id, wallet: 'bad', owner }); assert.equal((await call(tight, { id: tight.id, wallet: 'bad', owner })).status, 429);
});

test('launch: a failed launch leaks nothing and records nothing; a code mismatch is refused', async () => {
  const f = await setup({ deps: { account: { async signAndSendTransaction() { throw new Error('secret key ed25519:abc leaked in error'); } } } });
  const r = await call(f, { id: f.id, wallet: 'alice.testnet', owner });
  assert.equal(r.status, 502); assert.ok(!JSON.stringify(r.json).includes('secret')); assert.equal((await f.store.get(f.id)).deployed, undefined);
  const m = await setup({ deps: { rpc: async (_m, p) => (p.request_type === 'view_code' ? { hash: 'WRONG' } : { keys: [] }) } });
  assert.equal((await call(m, { id: m.id, wallet: 'alice.testnet', owner })).status, 502);
  const k = await setup({ deps: { rpc: async (_m, p) => (p.request_type === 'view_code' ? { hash: HASH } : { keys: [{ public_key: 'ed25519:x' }] }) } });
  assert.equal((await call(k, { id: k.id, wallet: 'alice.testnet', owner })).status, 502);
  assert.deepEqual(await checkOnChain('c', HASH, async (_m, p) => (p.request_type === 'view_code' ? { hash: HASH } : { keys: [] })), { codeHash: HASH, hashOk: true, keyless: true });
});

test('chat gives every build a secret owner key; only its hash is stored and nothing secret is public', async () => {
  const store = memoryStore();
  const good = JSON.stringify({ reply: 'ok', ready: true, pact: { template: 'escrow', payee: 'ada.near', amount: '5', deadline: '2026-12-15T12:00:00Z' } });
  const r = await handleChat({ body: { messages: [{ role: 'user', content: 'x' }] }, complete: async () => good, limiter: memoryLimiter(9), ip: '1', store, now: NOW });
  const id = r.json.pact.id, token = r.json.pact.ownerToken; assert.ok(token && token.length >= 20);
  const saved = await store.get(id); assert.equal(saved.ownerHash, createHash('sha256').update(token).digest('hex')); assert.ok(!JSON.stringify(saved).includes(token));
  const html = renderApp({ ...saved, deployed: { network: 'testnet', contractId: 'p-1.f.testnet', codeHash: 'H', payer: 'a.testnet', txHash: 't', at: 1, secret: 'nope' } }, id);
  assert.ok(!html.includes(saved.ownerHash)); assert.ok(!html.includes('ownerHash')); assert.ok(!html.includes('nope')); assert.ok(html.includes('p-1.f.testnet'));
});

test('deployPact end to end with the local server route', async () => {
  const store = memoryStore(); const id = await store.save(build()); const deps = mkDeps();
  const s = createServer({ complete: async () => '{}', env, store, deps, now: () => NOW });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  try {
    const r = await fetch(`${base}/api/deploy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, wallet: 'alice.testnet', owner }) });
    assert.equal(r.status, 200); const j = await r.json(); assert.match(j.deployed.contractId, /\.pactsmith-factory\.testnet$/);
    const page = await (await fetch(`${base}/app/${id}`)).text(); assert.ok(page.includes(j.deployed.contractId));
  } finally { await new Promise((ok) => s.close(ok)); }
});
