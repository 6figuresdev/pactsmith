export default function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({ ok: true, ai: Boolean(process.env.GROQ_API_KEY || process.env.XAI_API_KEY) });
}
