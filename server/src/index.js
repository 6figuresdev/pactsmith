import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { makeProvider } from './provider.js';
import { handleChat, BAD_INPUT } from './chat.js';
import { makeLimiter } from './limits.js';
import { makeStore } from './store.js';
import { renderApp, manifest, notFoundPage } from './appPage.js';
import { handleDeploy } from './deploy.js';
import { buildPackage, packageWasmHash } from './pkg.js';

const MAX_BODY = 64 * 1024;

export function createServer({ complete, env = process.env, now = () => Date.now(), limiter = makeLimiter(env), store = makeStore(env), deps = {} }) {
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
    const m = /^\/app\/([A-Za-z0-9_-]{1,40})(\/manifest\.webmanifest|\/package\.zip)?$/.exec(url);
    if (req.method === 'GET' && m) {
      const b = store ? await store.get(m[1]).catch(() => null) : null;
      if (!b) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end(notFoundPage); }
      if (m[2] === '/package.zip') { try { const pk = buildPackage({ build: b, id: m[1], wasmSha256: packageWasmHash(b.template) }); res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${pk.filename}"`, 'cache-control': 'no-store' }); return res.end(pk.zip); } catch (e) { console.error('package failed:', e.message); res.writeHead(503, { 'content-type': 'text/plain' }); return res.end('The download is not available yet.'); } }
      if (m[2]) { res.writeHead(200, { 'content-type': 'application/manifest+json' }); return res.end(JSON.stringify(manifest(b, m[1]))); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(renderApp(b, m[1], { rpc: env.NEAR_RPC_URL }));
    }
    if (req.method === 'POST' && url === '/api/deploy') {
      const ip2 = (env.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
      let b2 = null; try { b2 = JSON.parse(await readBody(req)); } catch { /* handled */ }
      const out2 = await handleDeploy({ body: b2, store, limiter, ip: ip2, env, deps, now: now() });
      return send(res, out2.status, out2.json, origin);
    }
    if (req.method !== 'POST' || url !== '/api/chat') return send(res, 404, { error: 'Not found' }, origin);
    const ip = (env.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
    let body = null;
    try { body = JSON.parse(await readBody(req)); } catch { /* handled below */ }
    if (body === null) return send(res, 400, { error: BAD_INPUT }, origin);
    const out = await handleChat({ body, complete, limiter, ip, store, now: now() });
    send(res, out.status, out.json, origin);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const complete = makeProvider(process.env);
  const port = Number(process.env.PORT || 4000), host = process.env.HOST || '127.0.0.1';
  createServer({ complete }).listen(port, host, () => console.log(`Pactsmith server on http://${host}:${port}`));
}
