import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makeZip, crc32 } from '../src/zip.js';
import { buildPackage } from '../src/pkg.js';
import { memoryStore } from '../src/store.js';
import { createServer } from '../src/index.js';
import { sanitizeDapp } from '../src/dapp.js';
import { validatePact } from '../src/validate.js';
import { buildReceipt } from '../src/receipt.js';

// independent reader: parses the central directory, inflates, checks every CRC
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); assert.ok(eocd >= 0, 'no end record');
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16); const out = {};
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl;
    const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28), start = off + 30 + lnl + lel;
    const data = inflateRawSync(buf.subarray(start, start + csize)); assert.equal(data.length, usize); assert.equal(crc32(data), crc, `crc ${name}`); out[name] = data.toString('utf8');
  }
  return out;
}

const NOW = Date.parse('2026-11-07T12:00:00Z');
const mk = (pact) => { const v = validatePact(pact, NOW); return { template: v.template, initArgs: v.initArgs, receipt: buildReceipt(v), dapp: sanitizeDapp({ name: 'Website job escrow' }, v.template), unsupported: [], ownerHash: 'SECRETHASH', createdAt: NOW }; };
const escrow = () => mk({ template: 'escrow', payee: 'ada.near', amount: '5', deadline: '2026-12-15T12:00:00Z' });

test('zip: round-trips text and is reproducible', () => {
  const files = [{ name: 'a.txt', data: 'héllo wörld' }, { name: 'dir/b.txt', data: 'x'.repeat(5000) }];
  const z = makeZip(files); assert.deepEqual(readZip(z), { 'a.txt': 'héllo wörld', 'dir/b.txt': 'x'.repeat(5000) });
  assert.ok(makeZip(files).equals(z));
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('package: right files, settings, hashes, no secrets, unaudited warning', () => {
  const { zip, filename, files } = buildPackage({ build: escrow(), id: 'abcdefghijkl', wasmSha256: 'ab'.repeat(32) });
  assert.equal(filename, 'pactsmith-website-job-escrow-testnet.zip');
  const z = readZip(zip);
  assert.deepEqual(files.sort(), ['README.md', 'contract/Cargo.toml', 'contract/src/lib.rs', 'contract/tests/common/mod.rs', 'contract/tests/sandbox.rs', 'deploy.mjs', 'pact.json', 'package.json'].sort());
  const pact = JSON.parse(z['pact.json']);
  assert.equal(pact.template, 'escrow'); assert.equal(pact.initArgs.payee, 'ada.near'); assert.equal(pact.initArgs.payer, '{{wallet}}');
  assert.equal(pact.expectedWasmSha256, 'ab'.repeat(32));
  assert.equal(pact.sourceSha256['contract/src/lib.rs'], createHash('sha256').update(z['contract/src/lib.rs']).digest('hex'));
  assert.equal(pact.sourceSha256['contract/Cargo.toml'], createHash('sha256').update(z['contract/Cargo.toml']).digest('hex'));
  assert.match(z['README.md'], /UNAUDITED SOFTWARE\. TESTNET FIRST/); assert.match(z['README.md'], /5 NEAR/);
  for (const [name, body] of Object.entries(z)) { assert.ok(!body.includes('SECRETHASH'), name); assert.ok(!/ownerHash|ownerToken/.test(body), name); }
  assert.match(z['contract/Cargo.toml'], /\[profile\.release\]/); assert.match(z['contract/Cargo.toml'], /name = "pactsmith-escrow"/);
  assert.ok(z['contract/tests/sandbox.rs'].includes('#[path = "common/mod.rs"]') && !z['contract/tests/sandbox.rs'].includes('../../common'));
  assert.ok(z['contract/tests/common/mod.rs'].includes('join("target")') && !z['contract/tests/common/mod.rs'].includes('../../target'));
  assert.ok(JSON.parse(z['package.json']).dependencies['near-api-js'] === '7.4.0');
});

test('package: works for all three templates and says when no fingerprint is recorded', () => {
  for (const pact of [{ template: 'payroll', payees: ['a.near', 'b.near'], amountPerPeriod: '2', periodDays: 30, periods: 3 }, { template: 'split', recipients: [{ account: 'a.near', percent: 60 }, { account: 'b.near', percent: 40 }] }]) {
    const b = mk(pact); const z = readZip(buildPackage({ build: b, id: 'abcdefghijkl' }).zip);
    assert.ok(z['contract/src/lib.rs'].includes(`Pactsmith ${b.template === 'split' ? 'Revenue Split' : 'Payroll Vault'}`));
    assert.equal(JSON.parse(z['pact.json']).expectedWasmSha256, null); assert.match(z['README.md'], /not recorded for this build/);
  }
});

test('package: bundled sources match the real contracts (guards against drift)', () => {
  for (const t of ['escrow', 'payroll', 'split']) {
    const real = new URL(`../../contracts/${t}/src/lib.rs`, import.meta.url), copy = new URL(`../templates/${t}/src/lib.rs`, import.meta.url);
    if (!existsSync(real)) continue; // running outside the full repo
    assert.equal(readFileSync(copy, 'utf8'), readFileSync(real, 'utf8'), `${t}: run scripts/collect-wasm.sh to refresh server/templates`);
    for (const f of ['Cargo.toml', 'tests/sandbox.rs']) assert.equal(readFileSync(new URL(`../templates/${t}/${f}`, import.meta.url), 'utf8'), readFileSync(new URL(`../../contracts/${t}/${f}`, import.meta.url), 'utf8'), `${t}/${f}`);
  }
});

test('local server: the app link serves the package as a zip download', async () => {
  const store = memoryStore(); const id = await store.save(escrow());
  const s = createServer({ complete: async () => '{}', env: {}, store });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  try {
    const r = await fetch(`${base}/app/${id}/package.zip`);
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/zip'); assert.match(r.headers.get('content-disposition'), /attachment; filename="pactsmith-website-job-escrow-testnet\.zip"/);
    assert.ok('README.md' in readZip(Buffer.from(await r.arrayBuffer())));
    assert.equal((await fetch(`${base}/app/AAAAAAAAAAAA/package.zip`)).status, 404);
  } finally { await new Promise((ok) => s.close(ok)); }
});
