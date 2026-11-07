import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { makeProvider } from './provider.js';
import { handleChat, BAD_INPUT } from './chat.js';
import { makeLimiter } from './limits.js';

const MAX_BODY = 64 * 1024;

export function createServer({ complete, env = process.env, now = () => Date.now(), limiter = makeLimiter(env) }) {
  const origins = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const send = (res, code, body, origin) => {
    const allow = origins.includes('*') ? '*' : origins.includes(origin) ? origin : '';
    res.writeHead(code, {
      'content-type': 'application/json', 'cache-control': 'no-store',
      ...(allow && { 'access-control-allow-origin': allow, vary: 'Origin' }),
      'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type',
    });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const url = (req.url || '').split('?')[0];
    if (req.method === 'OPTIONS') return send(res, 204, {}, origin);
    if (req.method === 'GET' && url === '/api/health') return send(res, 200, { ok: true }, origin);
    if (req.method !== 'POST' || url !== '/api/chat') return send(res, 404, { error: 'Not found' }, origin);
    const ip = (env.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
    let body = null;
    try { body = JSON.parse(await readBody(req)); } catch { /* handled below */ }
    if (body === null) return send(res, 400, { error: BAD_INPUT }, origin);
    const out = await handleChat({ body, complete, limiter, ip, now: now() });
    send(res, out.status, out.json, origin);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const complete = makeProvider(process.env);
  const port = Number(process.env.PORT || 4000), host = process.env.HOST || '127.0.0.1';
  createServer({ complete }).listen(port, host, () => console.log(`Pactsmith server on http://${host}:${port}`));
}
