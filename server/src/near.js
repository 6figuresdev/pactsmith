// Testnet launch: ONE transaction creates the contract account, funds it, deploys the code and runs `new`.
// No AddKey action is ever sent, so the contract has no keys and nobody can change it afterwards.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAccount } from './validate.js';

export const DEFAULT_RPC = 'https://test.rpc.fastnear.com';
const TGAS = 10n ** 12n;
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export const sha256 = (buf) => createHash('sha256').update(buf).digest();
export function base58(bytes) {
  let n = BigInt('0x' + Buffer.from(bytes).toString('hex') || '0'), s = '';
  while (n > 0n) { s = ALPHABET[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
  return s;
}
export const isTestnetAccount = (w) => isAccount(w) && (w.endsWith('.testnet') || /^[0-9a-f]{64}$/.test(w));
export const loadWasm = (template) => new Uint8Array(readFileSync(new URL(`../wasm/${template}.wasm`, import.meta.url)));
export const contractIdFor = (buildId, factory) => `p-${createHash('sha256').update(buildId).digest('hex').slice(0, 12)}.${factory}`;

export function resolveInitArgs(initArgs, { wallet, nowNs }) {
  const out = {};
  for (const [k, v] of Object.entries(initArgs)) out[k] = v === '{{wallet}}' ? wallet : v === '{{now_ns}}' ? String(nowNs) : v;
  return out;
}

export async function rpc(method, params, env = process.env, fetchImpl = fetch) {
  const urls = [...new Set([env.NEAR_RPC_URL || DEFAULT_RPC, 'https://rpc.testnet.fastnear.com', 'https://near-testnet.drpc.org'])];
  let last;
  for (const url of urls) {
    try {
      const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'pm', method, params }), signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
      return j.result;
    } catch (e) { last = e; }
  }
  throw last;
}

export async function checkOnChain(contractId, expectedHash, call) {
  const code = await call('query', { request_type: 'view_code', finality: 'final', account_id: contractId });
  const keys = await call('query', { request_type: 'view_access_key_list', finality: 'final', account_id: contractId });
  return { codeHash: code.hash, hashOk: code.hash === expectedHash, keyless: Array.isArray(keys.keys) && keys.keys.length === 0 };
}

// Spare balance on top of the code's own storage cost (1 NEAR per 100 KB). Default 0.5 NEAR, adjustable from 0.1 to 2.
export function extraStorage(env = process.env) {
  const n = Number(env.NEAR_PACT_EXTRA_NEAR);
  const x = Number.isFinite(n) && env.NEAR_PACT_EXTRA_NEAR !== '' && env.NEAR_PACT_EXTRA_NEAR != null ? Math.min(2, Math.max(0.1, n)) : 0.5;
  return BigInt(Math.round(x * 1e6)) * 10n ** 18n;
}

export async function deployPact({ build, id, wallet, now = Date.now(), env = process.env, deps = {} }) {
  const factory = env.NEAR_FACTORY_ACCOUNT;
  const wasm = deps.wasm || loadWasm(build.template);
  const expected = base58(sha256(wasm));
  const contractId = contractIdFor(id, factory);
  const args = resolveInitArgs(build.initArgs, { wallet, nowNs: BigInt(now) * 1_000_000n });
  const storage = BigInt(wasm.length) * 10n ** 19n + extraStorage(env); // the code's storage cost, plus a little spare
  let { account, actions } = deps;
  if (!account) {
    const m = await import('near-api-js');
    actions = m.actions;
    account = new m.Account(factory, new m.JsonRpcProvider({ url: env.NEAR_RPC_URL || DEFAULT_RPC }), env.NEAR_FACTORY_KEY);
  }
  const res = await account.signAndSendTransaction({
    receiverId: contractId,
    actions: [actions.createAccount(), actions.transfer(storage), actions.deployContract(wasm), actions.functionCall('new', args, 100n * TGAS, 0n)],
    waitUntil: 'FINAL', throwOnFailure: true,
  });
  const check = await checkOnChain(contractId, expected, deps.rpc || ((m, p) => rpc(m, p, env)));
  if (!check.hashOk || !check.keyless) throw new Error(`on-chain check failed (hashOk=${check.hashOk}, keyless=${check.keyless})`);
  return { contractId, txHash: res?.transaction?.hash || res?.transaction_outcome?.id || '', codeHash: check.codeHash, keyless: true, network: 'testnet' };
}

// Turns a raw launch error into a short code. The raw text is only logged, never shown to visitors.
export function classifyDeployError(msg = '') {
  const m = String(msg);
  if (/AccessKeyDoesNotExist|does not exist at block|InvalidSignature|invalid (key|signature)|Unknown key|public key/i.test(m)) return 'factory-key';
  if (/NotEnoughBalance|LackBalanceForState|insufficient|not enough|lack.*balance/i.test(m)) return 'factory-funds';
  if (/AccountAlreadyExists|already exists/i.test(m)) return 'exists';
  if (/Cannot find (module|package)|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM/i.test(m)) return 'library';
  if (/on-chain check failed/i.test(m)) return 'check';
  if (/ENOENT|\.wasm/i.test(m)) return 'wasm';
  if (/fetch failed|timeout|timed out|ECONN|ENOTFOUND|rate limit|\b(429|502|503|504)\b/i.test(m)) return 'network';
  return 'other';
}

export const REASON_TEXT = {
  'factory-key': "Pactsmith's testnet account key does not match its account. This is a setup problem on Pactsmith's side, not yours.",
  'factory-funds': "Pactsmith's testnet account has run low on testnet NEAR. This is a setup problem on Pactsmith's side, not yours.",
  exists: 'A launch for this app already reached the network. Refresh the page. If it does not switch to live mode, tell the Pactsmith owner.',
  library: 'The launch tools are missing on the server. This is a setup problem on Pactsmith\'s side, not yours.',
  wasm: 'The contract files are missing on the server. This is a setup problem on Pactsmith\'s side, not yours.',
  check: 'The contract reached the network but failed its safety check, so it was not marked live. Please tell the Pactsmith owner.',
  network: 'The NEAR testnet did not answer in time. Please try again in a minute.',
  other: 'The testnet launch failed and nothing was created. Please try again in a moment.',
};

// What a launch needs: the code storage plus the spare, for the biggest contract.
export function neededFor(env = process.env, sizes = null) {
  const lens = sizes || ['escrow', 'payroll', 'split'].map((t) => { try { return loadWasm(t).length; } catch { return null; } });
  if (lens.some((l) => l == null)) return null;
  return Number((BigInt(Math.max(...lens)) * 10n ** 19n + extraStorage(env)) / 10n ** 20n) / 10000;
}

// Checks the factory setup without sending anything. Safe to show: it only reports public chain facts and yes/no answers.
export async function factoryStatus(env = process.env, deps = {}) {
  const account = env.NEAR_FACTORY_ACCOUNT, keyStr = env.NEAR_FACTORY_KEY;
  const out = { configured: Boolean(account && keyStr) };
  if (!out.configured) return out;
  const call = deps.rpc || ((m, p) => rpc(m, p, env));
  let pub;
  try { const m = deps.nearApi || (await import('near-api-js')); pub = m.KeyPair.fromString(keyStr).getPublicKey().toString(); out.keyFormatOk = true; }
  catch { out.keyFormatOk = false; return out; }
  try {
    const a = await call('query', { request_type: 'view_account', finality: 'final', account_id: account });
    out.accountExists = true; out.balanceNear = Number(BigInt(a.amount) / 10n ** 20n) / 10000;
  } catch { out.accountExists = false; return out; }
  try { const k = await call('query', { request_type: 'view_access_key_list', finality: 'final', account_id: account }); out.keyRegistered = Array.isArray(k.keys) && k.keys.some((x) => x.public_key === pub); }
  catch { out.keyRegistered = null; }
  const need = neededFor(env, deps.sizes);
  out.neededNear = need == null ? null : Math.round((need + 0.05) * 100) / 100;
  out.enoughBalance = need == null ? null : out.balanceNear >= need + 0.05;
  return out;
}
