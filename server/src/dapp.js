// The AI may customise the look and wording of an app. It can never change the rules.
export const LABELS = {
  escrow: { deposit: 'Fund the escrow', release: 'Approve and release', return: 'Hand it back', refund: 'Claim refund' },
  payroll: { deposit: 'Fund payroll', claim: 'Collect my pay' },
  split: { pay: 'Pay in', withdraw: 'Withdraw my share' },
};
export const NAMES = { escrow: 'My escrow', payroll: 'My payroll', split: 'My revenue split' };
const DEFAULT_ACCENT = '#4f46e5';

export const clean = (s, max) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');

function tooLight(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6; // white text must stay readable
}

export function sanitizeDapp(raw, template) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const defaults = LABELS[template];
  const labels = { ...defaults };
  if (d.labels && typeof d.labels === 'object') {
    for (const k of Object.keys(defaults)) { const v = clean(d.labels[k], 40); if (v) labels[k] = v; }
  }
  const accent = typeof d.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.accent) && !tooLight(d.accent) ? d.accent.toLowerCase() : DEFAULT_ACCENT;
  return { name: clean(d.name, 40) || NAMES[template], tagline: clean(d.tagline, 120), accent, theme: d.theme === 'dark' ? 'dark' : 'light', labels };
}

export function cleanList(v, max = 5, len = 160) {
  return Array.isArray(v) ? v.map((x) => clean(x, len)).filter(Boolean).slice(0, max) : [];
}
