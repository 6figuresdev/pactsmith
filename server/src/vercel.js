import { handleChat } from './chat.js';
import { renderApp, manifest, notFoundPage } from './appPage.js';
import { handleDeploy } from './deploy.js';
import { buildPackage, packageWasmHash } from './pkg.js';

export function createHandler({ getComplete, limiter, store = null, env = process.env, now = () => Date.now() }) {
  const extra = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return async function handler(req, res) {
    res.setHeader('cache-control', 'no-store');
    if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
    const origin = req.headers.origin;
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch { /* ignore */ }
      if (host !== req.headers.host && !extra.includes(origin)) return res.status(403).json({ error: 'This site is not allowed to use Pactsmith.' });
    }
    let complete;
    try { complete = getComplete(); } catch (e) {
      console.error('not configured:', e.message);
      return res.status(500).json({ error: 'Pactsmith is not configured yet.' });
    }
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    const out = await handleChat({ body, complete, limiter, ip, store, now: now() });
    return res.status(out.status).json(out.json);
  };
}

// GET /app/:id and /app/:id/manifest.webmanifest (rewritten to these by vercel.json)
export function createAppHandler({ store, kind = 'page', env = process.env }) {
  return async function handler(req, res) {
    const id = String(req.query?.id || '');
    const b = store ? await store.get(id).catch(() => null) : null;
    if (!b) { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.status(404).send(notFoundPage); }
    if (kind === 'package') {
      try { const pk = buildPackage({ build: b, id, wasmSha256: packageWasmHash(b.template) }); res.setHeader('content-type', 'application/zip'); res.setHeader('content-disposition', `attachment; filename="${pk.filename}"`); res.setHeader('cache-control', 'no-store'); return res.status(200).send(pk.zip); }
      catch (e) { console.error('package failed:', e.message); res.setHeader('content-type', 'text/plain'); return res.status(503).send('The download is not available yet.'); }
    }
    if (kind === 'manifest') { res.setHeader('content-type', 'application/manifest+json'); return res.status(200).send(JSON.stringify(manifest(b, id))); }
    res.setHeader('content-type', 'text/html; charset=utf-8'); res.setHeader('cache-control', 'no-store');
    return res.status(200).send(renderApp(b, id, { rpc: env.NEAR_RPC_URL }));
  };
}

export function createDeployHandler({ store, limiter, env = process.env, deps = {}, now = () => Date.now() }) {
  return async function handler(req, res) {
    res.setHeader('cache-control', 'no-store');
    if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
    const origin = req.headers.origin;
    if (origin) { let host = ''; try { host = new URL(origin).host; } catch { /* ignore */ } if (host !== req.headers.host) return res.status(403).json({ error: 'This site is not allowed to use Pactsmith.' }); }
    let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    const out = await handleDeploy({ body, store, limiter, ip, env, deps, now: now() });
    return res.status(out.status).json(out.json);
  };
}
