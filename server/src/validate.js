// Strict checks. The AI proposes; this file decides what is acceptable.
// Output `initArgs` match the `new` function of each contract exactly.
const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const YOCTO = 10n ** 24n;
const MAX_NEAR = 1_000_000n;
const DAY_MS = 86_400_000;
export const WALLET = '{{wallet}}'; // filled in at deploy time with the connected account
export const NOW_NS = '{{now_ns}}'; // filled in at deploy time

export const isAccount = (s) => typeof s === 'string' && s.length >= 2 && s.length <= 64 && ACCOUNT.test(s);

export function toYocto(v) {
  const s = String(v ?? '').trim();
  if (!/^\d+(\.\d{1,24})?$/.test(s)) throw new Error('bad amount');
  const [i, f = ''] = s.split('.');
  const y = BigInt(i) * YOCTO + BigInt(f.padEnd(24, '0'));
  if (y <= 0n || y > MAX_NEAR * YOCTO) throw new Error('amount out of range');
  return y;
}

export function fromYocto(y) {
  const whole = y / YOCTO;
  const frac = (y % YOCTO).toString().padStart(24, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

const AMOUNT_MSG = 'The amount must be a positive number of NEAR (at most 1,000,000).';

function escrow(p, now, errors) {
  if (!isAccount(p.payee)) errors.push('The person being paid needs a valid NEAR account name, like ada.near.');
  let amount;
  try { amount = toYocto(p.amount); } catch { errors.push(AMOUNT_MSG); }
  const ms = Date.parse(p.deadline);
  if (!(ms > now + 60_000)) errors.push('The refund date must be a real date in the future.');
  else if (ms > now + 5 * 365 * DAY_MS) errors.push('The refund date can be at most 5 years away.');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true, template: 'escrow',
    initArgs: { payer: WALLET, payee: p.payee, amount: amount.toString(), deadline_ns: (BigInt(ms) * 1_000_000n).toString() },
    facts: { payee: p.payee, amount, deadlineMs: ms },
  };
}

function payroll(p, now, errors) {
  const payees = Array.isArray(p.payees) ? p.payees : [];
  if (payees.length < 1 || payees.length > 20) errors.push('Payroll needs between 1 and 20 people.');
  else if (!payees.every(isAccount)) errors.push('Every person being paid needs a valid NEAR account name.');
  else if (new Set(payees).size !== payees.length) errors.push('Each person can only be listed once.');
  let amount;
  try { amount = toYocto(p.amountPerPeriod); } catch { errors.push(AMOUNT_MSG); }
  const days = Number(p.periodDays);
  if (!Number.isInteger(days) || days < 1 || days > 365) errors.push('A pay period must be a whole number of days, from 1 to 365.');
  const periods = Number(p.periods);
  if (!Number.isInteger(periods) || periods < 1 || periods > 520) errors.push('The number of pay periods must be a whole number from 1 to 520.');
  let startMs = null;
  if (p.start != null && p.start !== '') {
    startMs = Date.parse(p.start);
    if (Number.isNaN(startMs)) errors.push('The start date is not a valid date.');
  }
  let total;
  if (!errors.length) {
    total = amount * BigInt(payees.length) * BigInt(periods);
    if (total > MAX_NEAR * YOCTO) errors.push('The total payroll is too large. The limit is 1,000,000 NEAR.');
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true, template: 'payroll',
    initArgs: {
      funder: WALLET, payees, amount: amount.toString(),
      period_ns: (BigInt(days) * 86_400n * 1_000_000_000n).toString(), periods,
      start_ns: startMs == null ? NOW_NS : (BigInt(startMs) * 1_000_000n).toString(),
    },
    facts: { payees, amount, days, periods, total, startMs },
  };
}

function split(p, now, errors) {
  const r = Array.isArray(p.recipients) ? p.recipients : [];
  const accounts = r.map((x) => x && x.account);
  if (r.length < 1 || r.length > 20) errors.push('A split needs between 1 and 20 people.');
  else if (!accounts.every(isAccount)) errors.push('Every person getting a share needs a valid NEAR account name.');
  else if (new Set(accounts).size !== accounts.length) errors.push('Each person can only be listed once.');
  if (!errors.length) {
    const bps = r.map((x) => {
      const n = Number(x.percent), b = Math.round(n * 100);
      return Number.isFinite(n) && n > 0 && Math.abs(n * 100 - b) < 1e-6 ? b : NaN;
    });
    if (bps.some(Number.isNaN)) errors.push('Each share must be above 0% and use at most two decimals.');
    else if (bps.reduce((a, b) => a + b, 0) !== 10_000) errors.push('The shares must add up to exactly 100%.');
    else return { ok: true, template: 'split', initArgs: { accounts, bps }, facts: { accounts, bps } };
  }
  return { ok: false, errors };
}

export function validatePact(p, now = Date.now()) {
  if (!p || typeof p !== 'object') return { ok: false, errors: ['No pact details were given.'] };
  const errors = [];
  if (p.template === 'escrow') return escrow(p, now, errors);
  if (p.template === 'payroll') return payroll(p, now, errors);
  if (p.template === 'split') return split(p, now, errors);
  return { ok: false, errors: ['Pick one of the three tools: escrow, payroll or split.'] };
}
