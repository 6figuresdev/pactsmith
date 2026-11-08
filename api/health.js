import { existsSync } from 'node:fs';

export default function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  const wasm = ['escrow', 'payroll', 'split'].every((t) => existsSync(new URL(`../server/wasm/${t}.wasm`, import.meta.url)));
  res.status(200).json({ ok: true, ai: Boolean(process.env.GROQ_API_KEY || process.env.XAI_API_KEY), launch: Boolean(process.env.NEAR_FACTORY_ACCOUNT && process.env.NEAR_FACTORY_KEY), wasm });
}
