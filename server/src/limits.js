const TOO_MANY = { ok: false, status: 429, message: 'Too many messages. Please wait a minute and try again.' };
const BUSY = { ok: false, status: 503, message: 'Pactsmith is very busy today. Please try again tomorrow.' };

export function memoryLimiter(perMin = 20) {
  const hits = new Map();
  return async (ip) => {
    const t = Date.now(), recent = (hits.get(ip) || []).filter((x) => t - x < 60_000);
    recent.push(t); hits.set(ip, recent);
    return recent.length > perMin ? TOO_MANY : { ok: true };
  };
}

// Shared limits across all serverless instances (Upstash Redis over REST, no packages).
export function redisLimiter({ url, token, perMin = 20, dailyCap = 500, fallback }) {
  return async (ip) => {
    try {
      const minute = Math.floor(Date.now() / 60_000), day = new Date().toISOString().slice(0, 10);
      const a = `pm:rl:${ip}:${minute}`, b = `pm:cap:${day}`;
      const res = await fetch(`${url}/pipeline`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify([['INCR', a], ['EXPIRE', a, 120], ['INCR', b], ['EXPIRE', b, 172800]]),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`redis ${res.status}`);
      const r = await res.json();
      const perIp = r?.[0]?.result, daily = r?.[2]?.result;
      if (typeof perIp !== 'number' || typeof daily !== 'number') throw new Error('bad redis reply');
      if (daily > dailyCap) return BUSY;
      return perIp > perMin ? TOO_MANY : { ok: true };
    } catch (e) {
      console.error('limiter fallback:', e.message);
      return fallback(ip);
    }
  };
}

export function makeLimiter(env = process.env) {
  const perMin = Number(env.RATE_LIMIT_PER_MIN || 20);
  const memory = memoryLimiter(perMin);
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? redisLimiter({ url, token, perMin, dailyCap: Number(env.DAILY_CAP || 500), fallback: memory }) : memory;
}
