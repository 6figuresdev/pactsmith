import { runAgent } from './agent.js';

export const BAD_INPUT = 'Please send up to 30 chat messages (user or assistant), each under 2000 characters.';

export function parseHistory(body) {
  const list = Array.isArray(body?.messages) ? body.messages : null;
  if (!list || list.length < 1 || list.length > 30) throw new Error('bad messages');
  const history = list.map((m) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 2000) throw new Error('bad message');
    return { role: m.role, content: m.content };
  });
  if (history[history.length - 1].role !== 'user') throw new Error('last must be user');
  return history;
}

// Used by both the local server and the Vercel function.
export async function handleChat({ body, complete, limiter, ip, now = Date.now() }) {
  const gate = await limiter(ip);
  if (!gate.ok) return { status: gate.status, json: { error: gate.message } };
  let history;
  try { history = parseHistory(body); } catch { return { status: 400, json: { error: BAD_INPUT } }; }
  try {
    return { status: 200, json: await runAgent(history, complete, now) };
  } catch (e) {
    console.error('chat failed:', e.message);
    return { status: 502, json: { error: 'The assistant is unavailable right now. Please try again shortly.' } };
  }
}
