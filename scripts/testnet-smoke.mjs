// Real-network test: launches one escrow on NEAR testnet through the same code the website uses,
// then runs fund -> release with throwaway accounts and checks real balances.
// Usage: NEAR_FACTORY_ACCOUNT=pactsmith-factory.testnet NEAR_FACTORY_KEY=ed25519:... node scripts/testnet-smoke.mjs
import { Account, JsonRpcProvider, KeyPair, actions } from 'near-api-js';
import { validatePact } from '../server/src/validate.js';
import { deployPact, rpc, DEFAULT_RPC, loadWasm, extraStorage } from '../server/src/near.js';

const env = process.env, factoryId = env.NEAR_FACTORY_ACCOUNT, factoryKey = env.NEAR_FACTORY_KEY;
if (!factoryId || !factoryKey) { console.error('Set NEAR_FACTORY_ACCOUNT and NEAR_FACTORY_KEY first.'); process.exit(1); }
const NEAR = 10n ** 24n, TGAS = 10n ** 12n, stamp = Date.now().toString(36);
const provider = new JsonRpcProvider({ url: env.NEAR_RPC_URL || DEFAULT_RPC });
const factory = new Account(factoryId, provider, factoryKey);
let failed = 0; const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  -> ' + extra}`); if (!ok) failed++; };
const view = async (cid, method, args = {}) => { const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: cid, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') }, env); return JSON.parse(Buffer.from(r.result).toString()); };
const balance = async (id) => BigInt((await rpc('query', { request_type: 'view_account', finality: 'final', account_id: id }, env)).amount);

const mkAccount = async (name, yocto) => { const kp = KeyPair.fromRandom('ed25519'); const id = `${name}-${stamp}.${factoryId}`;
  await factory.createAccount({ newAccountId: id, publicKey: kp.getPublicKey().toString(), nearToTransfer: yocto }); return { id, account: new Account(id, provider, kp.toString()) }; };

console.log('Creating throwaway payer and payee…');
const payer = await mkAccount('payer', 2n * NEAR), payee = await mkAccount('payee', NEAR / 2n);
const lockedNear = Number((BigInt(loadWasm('escrow').length) * 10n ** 19n + extraStorage(env)) / 10n ** 20n) / 10000;
console.log('Contract storage that will be locked: about', lockedNear.toFixed(2), 'NEAR');
const v = validatePact({ template: 'escrow', payee: payee.id, amount: '1', deadline: new Date(Date.now() + 864e5).toISOString() });
if (!v.ok) throw new Error(v.errors.join());
console.log('Launching the escrow…');
const out = await deployPact({ build: { template: 'escrow', initArgs: v.initArgs }, id: `smoke${stamp}`, wallet: payer.id, env });
console.log('Contract:', out.contractId, ' tx:', out.txHash);
check('launched with no keys and the expected code', out.keyless && !!out.codeHash);
check('starts in Created', (await view(out.contractId, 'get_status')) === 'Created');
await payer.account.signAndSendTransaction({ receiverId: out.contractId, actions: [actions.functionCall('deposit', {}, 100n * TGAS, NEAR)], waitUntil: 'FINAL' });
check('payer deposit makes it Funded', (await view(out.contractId, 'get_status')) === 'Funded');
const before = await balance(payee.id);
await payer.account.signAndSendTransaction({ receiverId: out.contractId, actions: [actions.functionCall('release', {}, 100n * TGAS, 0n)], waitUntil: 'FINAL' });
await new Promise((r) => setTimeout(r, 4000));
check('release pays the payee exactly 1 NEAR', (await balance(payee.id)) - before === NEAR, String((await balance(payee.id)) - before));
check('status is Released', (await view(out.contractId, 'get_status')) === 'Released');
console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED'); process.exit(failed ? 1 : 0);
