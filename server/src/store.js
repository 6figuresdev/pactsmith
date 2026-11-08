import { randomBytes } from 'node:crypto';
const TTL = 60 * 60 * 24 * 90; // builds are kept for 90 days
const ID = /^[A-Za-z0-9_-]{12}$/;
const newId = () => randomBytes(9).toString('base64url');

export function memoryStore() {
  const m = new Map();
  return { memory: true, async save(b) { const id = newId(); m.set(id, b); return id; }, async get(id) { return ID.test(id) ? m.get(id) ?? null : null; }, async update(id, b) { if (!m.has(id)) throw new Error('unknown build'); m.set(id, b); } };
}

export function redisStore({ url, token }) {
  const call = async (cmds) => {
    const res = await fetch(`${url}/pipeline`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(cmds), signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`redis ${res.status}`);
    return res.json();
  };
  return {
    async save(b) { const id = newId(); await call([['SET', `pm:b:${id}`, JSON.stringify(b), 'EX', TTL]]); return id; },
    async get(id) { if (!ID.test(id)) return null; const r = await call([['GET', `pm:b:${id}`]]); const v = r?.[0]?.result; return v ? JSON.parse(v) : null; },
    async update(id, b) { if (!ID.test(id)) throw new Error('bad id'); await call([['SET', `pm:b:${id}`, JSON.stringify(b), 'EX', TTL]]); },
  };
}

// On Vercel a memory store would silently lose builds, so links are switched off until Redis is set up.
export function makeStore(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL, token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return redisStore({ url, token });
  return env.VERCEL ? null : memoryStore();
}
