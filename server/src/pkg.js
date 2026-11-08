// "Download your build": contract source, tests, the exact settings, a deploy script and a testnet-first README.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { makeZip } from './zip.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const tpl = (...p) => new URL(`../templates/${p.join('/')}`, import.meta.url);
const read = (u) => (existsSync(u) ? readFileSync(u, 'utf8') : null);
const PROFILE = '\n[profile.release]\ncodegen-units = 1\nopt-level = "z"\nlto = true\ndebug = false\npanic = "abort"\noverflow-checks = true\n';
const BANNER = 'UNAUDITED SOFTWARE. TESTNET FIRST. Pactsmith contracts are tested but have not been professionally audited. Do not put real money in them.';

const DEPLOY = `// Deploys this pact as a keyless contract from YOUR account. Testnet by default.
// Read this file before you run it: it is short on purpose.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Account, JsonRpcProvider, actions } from 'near-api-js';

const pact = JSON.parse(readFileSync(new URL('./pact.json', import.meta.url), 'utf8'));
const network = process.env.NETWORK || 'testnet';
const account = process.env.NEAR_ACCOUNT, key = process.env.NEAR_PRIVATE_KEY;
const rpcUrl = process.env.RPC_URL || (network === 'testnet' ? 'https://test.rpc.fastnear.com' : '');
const die = (m) => { console.error(m); process.exit(1); };
if (!account || !key) die('Set NEAR_ACCOUNT and NEAR_PRIVATE_KEY (use a throwaway testnet account).');
if (!rpcUrl) die('For ' + network + ' set RPC_URL to an RPC endpoint you trust.');

function findWasm(name) {
  let best = null;
  const walk = (d) => { for (const f of readdirSync(d)) { const p = d + '/' + f, s = statSync(p);
    if (s.isDirectory()) { if (f !== 'deps' && f !== 'incremental' && f !== 'build') walk(p); }
    else if (f === name && (!best || s.mtimeMs > best.t)) best = { p, t: s.mtimeMs }; } };
  try { walk('contract/target'); } catch { /* not built yet */ }
  return best && best.p;
}
const wasmPath = findWasm('pactsmith_' + pact.template + '.wasm') || die('Build first: cd contract && cargo near build non-reproducible-wasm --no-abi');
const wasm = readFileSync(wasmPath);
const sha = createHash('sha256').update(wasm).digest('hex');
console.log('Your build :', sha);
console.log('Expected   :', pact.expectedWasmSha256 || '(none recorded)');
if (!(pact.expectedWasmSha256 && sha === pact.expectedWasmSha256)) {
  if (network !== 'testnet') die('The hashes differ, so mainnet is blocked. Use a reproducible build, and get the code audited first.');
  console.log('Note: the hashes differ. That is normal unless you used a reproducible build. Fine for testnet.');
}
if (network !== 'testnet' && !process.argv.includes('--i-understand-this-is-unaudited')) die('Mainnet needs --i-understand-this-is-unaudited. These contracts have NOT been audited.');

const args = Object.fromEntries(Object.entries(pact.initArgs).map(([k, v]) =>
  [k, v === '{{wallet}}' ? account : v === '{{now_ns}}' ? String(BigInt(Date.now()) * 1000000n) : v]));
const contractId = pact.suggestedName + '.' + account;
const storage = BigInt(wasm.length) * 10n ** 19n + 5n * 10n ** 23n;
const me = new Account(account, new JsonRpcProvider({ url: rpcUrl }), key);
// One transaction: create the account, fund it, deploy the code, run \`new\`. No key is ever added.
await me.signAndSendTransaction({ receiverId: contractId, waitUntil: 'FINAL', throwOnFailure: true,
  actions: [actions.createAccount(), actions.transfer(storage), actions.deployContract(new Uint8Array(wasm)), actions.functionCall('new', args, 100n * 10n ** 12n, 0n)] });
console.log('Deployed:', contractId, '(it has no keys, so nobody can change it)');
console.log('https://' + (network === 'testnet' ? 'testnet.' : '') + 'nearblocks.io/address/' + contractId);
`;

export function buildPackage({ build, id, wasmSha256 = null }) {
  const t = build.template;
  const lib = read(tpl(t, 'src', 'lib.rs')), cargo = read(tpl(t, 'Cargo.toml')), tests = read(tpl(t, 'tests', 'sandbox.rs')), common = read(tpl('sandbox_common.rs'));
  if (!lib || !cargo || !tests || !common) throw new Error('template sources missing; run scripts/collect-wasm.sh');
  const crate = `pactsmith_${t}`;
  const cargoFull = cargo.trimEnd() + '\n' + PROFILE;
  const suggestedName = 'pact-' + sha(id).slice(0, 8);
  const pact = {
    made_with: 'Pactsmith', status: 'unaudited, testnet first', template: t, appName: build.dapp?.name || '', createdAt: build.createdAt ? new Date(build.createdAt).toISOString() : null,
    suggestedName, initArgs: build.initArgs, expectedWasmSha256: wasmSha256,
    sourceSha256: { 'contract/src/lib.rs': sha(lib), 'contract/Cargo.toml': sha(cargoFull) },
    plainEnglish: { title: build.receipt.title, lines: build.receipt.lines, facts: build.receipt.facts },
    notes: ['{{wallet}} becomes the account that runs deploy.mjs.', '{{now_ns}} becomes the time of deployment.'],
  };
  const readme = `# ${build.dapp?.name || 'Your pact'}, built with Pactsmith

**${BANNER}**

## What this is
A ${build.receipt.title.toLowerCase()} contract for the NEAR blockchain, with the exact settings you chose. The contract has no owner, no admin and no keys once deployed.

## In plain English
${build.receipt.lines.map((l) => '- ' + l).join('\n')}

## What is inside
- \`contract/\`: the Rust source (\`src/lib.rs\`), its tests and its manifest
- \`pact.json\`: your exact settings, the expected code fingerprint and the hashes of the source files
- \`deploy.mjs\`: a short script that deploys the pact from YOUR account (read it first)
- \`package.json\`: the one dependency the script needs (\`near-api-js\`, pinned)

## 1. Verify the source
\`\`\`
sha256sum contract/src/lib.rs contract/Cargo.toml
\`\`\`
Compare with \`sourceSha256\` in \`pact.json\`.

## 2. Test it
\`\`\`
cd contract
cargo test --lib                       # fast unit tests
rustup target add wasm32-unknown-unknown
cargo install cargo-near
cargo near build non-reproducible-wasm --no-abi
cargo test --tests                     # real-runtime tests on a local NEAR network
cd ..
\`\`\`

## 3. Deploy on testnet
Use a throwaway testnet account. Never use an account that holds real money.
\`\`\`
npm install
NEAR_ACCOUNT=you.testnet NEAR_PRIVATE_KEY=ed25519:... node deploy.mjs
\`\`\`
It creates \`${suggestedName}.you.testnet\` in one transaction and adds no keys.

## About the code fingerprint
\`pact.json\` lists the expected SHA-256 of the compiled contract${wasmSha256 ? '' : ' (not recorded for this build)'}. A normal build on your machine may differ byte for byte. A reproducible build (\`cargo near build reproducible-wasm\`, needs Docker) should match.

## Mainnet
Not recommended. These contracts are unaudited. The script refuses mainnet unless you pass \`--i-understand-this-is-unaudited\`, set \`NETWORK=mainnet\` and \`RPC_URL\`, and your build matches the expected fingerprint. Get an independent audit first.
`;
  const files = [
    { name: 'README.md', data: readme }, { name: 'pact.json', data: JSON.stringify(pact, null, 2) + '\n' },
    { name: 'deploy.mjs', data: DEPLOY, mode: 0o755 },
    { name: 'package.json', data: JSON.stringify({ name: 'pactsmith-build', private: true, type: 'module', dependencies: { 'near-api-js': '7.4.0' } }, null, 2) + '\n' },
    { name: 'contract/Cargo.toml', data: cargoFull }, { name: 'contract/src/lib.rs', data: lib },
    { name: 'contract/tests/sandbox.rs', data: tests.replace('#[path = "../../common/sandbox_common.rs"]', '#[path = "common/mod.rs"]') },
    { name: 'contract/tests/common/mod.rs', data: common.replace('"../../target"', '"target"') },
  ];
  return { zip: makeZip(files), files: files.map((f) => f.name), filename: `pactsmith-${(build.dapp?.name || t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || t}-testnet.zip`, crate };
}

export function packageWasmHash(template) {
  try { return createHash('sha256').update(readFileSync(new URL(`../wasm/${template}.wasm`, import.meta.url))).digest('hex'); } catch { return null; }
}
