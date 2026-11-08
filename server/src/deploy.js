import { createHash, timingSafeEqual } from 'node:crypto';
import { deployPact, isTestnetAccount, classifyDeployError, REASON_TEXT } from './near.js';

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export const publicDeployed = (d) => (d ? { network: d.network, contractId: d.contractId, codeHash: d.codeHash, payer: d.payer, txHash: d.txHash, at: d.at } : null);

export async function handleDeploy({ body, store, limiter, ip, env = process.env, deps = {}, now = Date.now() }) {
  if (!deps.account && !(env.NEAR_FACTORY_ACCOUNT && env.NEAR_FACTORY_KEY)) return { status: 503, json: { error: 'The testnet launch is not switched on yet.' } };
  if (!deps.account && !env.NEAR_FACTORY_ACCOUNT) return { status: 503, json: { error: 'The testnet launch is not switched on yet.' } };
  const gate = await limiter(`deploy:${ip}`);
  if (!gate.ok) return { status: gate.status, json: { error: gate.message } };
  const id = String(body?.id || ''), wallet = String(body?.wallet || ''), owner = String(body?.owner || '');
  if (!isTestnetAccount(wallet)) return { status: 400, json: { error: 'Connect a NEAR testnet wallet first.' } };
  const build = store ? await store.get(id).catch(() => null) : null;
  if (!build) return { status: 404, json: { error: 'This app link has expired or does not exist.' } };
  if (!build.ownerHash || !owner || !same(sha(owner), build.ownerHash)) return { status: 403, json: { error: 'Only the person who built this app can launch it. Open the link you were given when you built it.' } };
  if (build.deployed) return { status: 409, json: { error: 'This app is already live on testnet.', deployed: publicDeployed(build.deployed) } };
  try {
    const out = await deployPact({ build, id, wallet, now, env, deps });
    const deployed = { ...out, payer: wallet, at: now };
    await store.update(id, { ...build, deployed });
    return { status: 200, json: { deployed: publicDeployed(deployed) } };
  } catch (e) {
    const reason = classifyDeployError(e.message);
    console.error('deploy failed:', reason, '|', e.message);
    return { status: 502, json: { error: REASON_TEXT[reason], reason } };
  }
}
