import { handleChat } from './chat.js';

export function createHandler({ getComplete, limiter, env = process.env, now = () => Date.now() }) {
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
    const out = await handleChat({ body, complete, limiter, ip, now: now() });
    return res.status(out.status).json(out.json);
  };
}
