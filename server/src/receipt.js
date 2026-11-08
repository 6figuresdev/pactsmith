// Plain-English summary written by the SERVER from validated values, never by the AI.
import { fromYocto } from './validate.js';

const date = (ms) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(ms)) + ' UTC';
const plural = (n, one, many) => (n === 1 ? one : many);

export function buildReceipt(v) {
  const f = v.facts;
  if (v.template === 'escrow') {
    const amt = fromYocto(f.amount);
    return {
      title: 'Escrow',
      lines: [
        `You put in ${amt} NEAR. It stays locked in the pact.`,
        `Only you can release it to ${f.payee}.`,
        `${f.payee} can hand it back to you at any time.`,
        `If nothing happens, anyone can return it to you after ${date(f.deadlineMs)}.`,
        ...(f.assumedTime ? ['No time of day was given, so midnight UTC was assumed. Tell Pactsmith if you want a different time.'] : []),
        'Nobody else can touch the money, and the rules cannot be changed once the pact is set up.',
      ],
      facts: [{ label: 'Amount', value: `${amt} NEAR` }, { label: 'Pays to', value: f.payee }, { label: 'Refund after', value: date(f.deadlineMs) }],
    };
  }
  if (v.template === 'payroll') {
    const n = f.payees.length, amt = fromYocto(f.amount), total = fromYocto(f.total);
    return {
      title: 'Payroll',
      lines: [
        `${n} ${plural(n, 'person is', 'people are')} paid ${amt} NEAR every ${f.days} ${plural(f.days, 'day', 'days')}, for ${f.periods} ${plural(f.periods, 'period', 'periods')}.`,
        `You put in the full ${total} NEAR up front. After that, nothing more is needed.`,
        'Each person collects their own pay as it comes due, and nobody can take it from them.',
        'You cannot withdraw the money once it is in, so every payment is guaranteed.',
        f.startMs == null ? 'Pay starts as soon as the pact is created.' : `Pay starts on ${date(f.startMs)}.`,
      ],
      facts: [{ label: 'Pay per period', value: `${amt} NEAR each` }, { label: 'People', value: f.payees.join(', ') }, { label: 'Total to put in', value: `${total} NEAR` }],
    };
  }
  const pct = (b) => `${b / 100}%`;
  return {
    title: 'Revenue split',
    lines: [
      ...f.accounts.map((a, i) => `${a} gets ${pct(f.bps[i])} of every payment.`),
      'Anyone can pay in, and each person withdraws their own share whenever they like.',
      'The shares cannot be changed later.',
      'Payments must be made with the pact’s pay-in button. A plain transfer to its address is not counted.',
    ],
    facts: f.accounts.map((a, i) => ({ label: a, value: pct(f.bps[i]) })),
  };
}
