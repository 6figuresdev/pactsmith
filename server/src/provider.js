// One small adapter for any OpenAI-compatible chat API (Groq, xAI Grok).
export function makeProvider(env = process.env) {
  const name = (env.PROVIDER || 'groq').toLowerCase();
  const table = {
    groq: { base: 'https://api.groq.com/openai/v1', key: env.GROQ_API_KEY, model: env.MODEL || 'openai/gpt-oss-120b', keyName: 'GROQ_API_KEY' },
    xai: { base: 'https://api.x.ai/v1', key: env.XAI_API_KEY, model: env.MODEL, keyName: 'XAI_API_KEY' },
  };
  const cfg = table[name];
  if (!cfg) throw new Error(`Unknown PROVIDER "${name}". Use groq or xai.`);
  if (!cfg.key) throw new Error(`Missing ${cfg.keyName}. Put it in server/.env (never in the website).`);
  if (!cfg.model) throw new Error('Set MODEL in server/.env. Use the model name from the provider’s docs.');
  return async function complete(messages) {
    const res = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2, response_format: { type: 'json_object' } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`AI provider error ${res.status}`);
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('AI provider sent an empty answer');
    return text;
  };
}
