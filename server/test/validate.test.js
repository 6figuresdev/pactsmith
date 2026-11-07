import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePact, toYocto, fromYocto, isAccount, WALLET, NOW_NS } from '../src/validate.js';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const FUTURE = '2026-12-15T12:00:00Z';

test('amounts convert exactly and reject junk', () => {
  assert.equal(toYocto('5'), 5n * 10n ** 24n);
  assert.equal(toYocto('0.000001'), 10n ** 18n);
  assert.equal(fromYocto(toYocto('2.5')), '2.5');
  for (const bad of ['0', '-1', '1e3', 'abc', '', '1.2.3', '2000000', null]) assert.throws(() => toYocto(bad), bad);
});

test('account names follow NEAR rules', () => {
  for (const ok of ['ada.near', 'a-b_c.testnet', 'ab']) assert.ok(isAccount(ok), ok);
  for (const bad of ['A.near', 'a', '.near', 'a..near', 'a b.near', '', 'x'.repeat(65), 5]) assert.ok(!isAccount(bad), String(bad));
});

test('escrow: valid pact produces exact init arguments', () => {
  const v = validatePact({ template: 'escrow', payee: 'ada.near', amount: '5', deadline: FUTURE }, NOW);
  assert.ok(v.ok);
  assert.deepEqual(v.initArgs, { payer: WALLET, payee: 'ada.near', amount: (5n * 10n ** 24n).toString(), deadline_ns: (BigInt(Date.parse(FUTURE)) * 1_000_000n).toString() });
});

test('escrow: rejects past dates, bad payee, bad amount', () => {
  assert.ok(!validatePact({ template: 'escrow', payee: 'ada.near', amount: '5', deadline: '2026-01-01T00:00:00Z' }, NOW).ok);
  assert.ok(!validatePact({ template: 'escrow', payee: 'Ada Lovelace', amount: '5', deadline: FUTURE }, NOW).ok);
  assert.ok(!validatePact({ template: 'escrow', payee: 'ada.near', amount: 'five', deadline: FUTURE }, NOW).ok);
  assert.ok(!validatePact({ template: 'escrow', payee: 'ada.near', amount: '5', deadline: 'soon' }, NOW).ok);
  assert.ok(!validatePact({ template: 'escrow', payee: 'ada.near', amount: '5', deadline: '2040-01-01T00:00:00Z' }, NOW).ok);
});

test('payroll: valid pact, totals and markers', () => {
  const v = validatePact({ template: 'payroll', payees: ['a.near', 'b.near'], amountPerPeriod: '2', periodDays: 30, periods: 6 }, NOW);
  assert.ok(v.ok);
  assert.equal(v.facts.total, 24n * 10n ** 24n);
  assert.equal(v.initArgs.period_ns, (30n * 86_400n * 10n ** 9n).toString());
  assert.equal(v.initArgs.start_ns, NOW_NS);
  assert.equal(v.initArgs.funder, WALLET);
});

test('payroll: rejects duplicates, empty lists, bad periods', () => {
  const base = { template: 'payroll', payees: ['a.near', 'b.near'], amountPerPeriod: '2', periodDays: 30, periods: 6 };
  assert.ok(!validatePact({ ...base, payees: ['a.near', 'a.near'] }, NOW).ok);
  assert.ok(!validatePact({ ...base, payees: [] }, NOW).ok);
  assert.ok(!validatePact({ ...base, periodDays: 0 }, NOW).ok);
  assert.ok(!validatePact({ ...base, periods: 1.5 }, NOW).ok);
  assert.ok(!validatePact({ ...base, periods: 600 }, NOW).ok);
  assert.ok(!validatePact({ ...base, amountPerPeriod: '900000', periods: 100 }, NOW).ok);
});

test('split: percentages become basis points that total 10000', () => {
  const v = validatePact({ template: 'split', recipients: [{ account: 'me.near', percent: 70 }, { account: 'sam.near', percent: 20 }, { account: 'studio.near', percent: 10 }] }, NOW);
  assert.ok(v.ok);
  assert.deepEqual(v.initArgs, { accounts: ['me.near', 'sam.near', 'studio.near'], bps: [7000, 2000, 1000] });
  const t = validatePact({ template: 'split', recipients: [{ account: 'a.near', percent: 33.33 }, { account: 'b.near', percent: 33.33 }, { account: 'c.near', percent: 33.34 }] }, NOW);
  assert.ok(t.ok);
});

test('split: rejects totals other than 100%, zero shares, duplicates', () => {
  const r = (...p) => ({ template: 'split', recipients: p.map(([account, percent]) => ({ account, percent })) });
  assert.ok(!validatePact(r(['a.near', 60], ['b.near', 30]), NOW).ok);
  assert.ok(!validatePact(r(['a.near', 100], ['b.near', 0]), NOW).ok);
  assert.ok(!validatePact(r(['a.near', 50], ['a.near', 50]), NOW).ok);
  assert.ok(!validatePact(r(['a.near', 33.333], ['b.near', 66.667]), NOW).ok);
});

test('unknown templates and junk are rejected', () => {
  assert.ok(!validatePact({ template: 'loan' }, NOW).ok);
  assert.ok(!validatePact(null, NOW).ok);
  assert.ok(!validatePact('escrow', NOW).ok);
});
