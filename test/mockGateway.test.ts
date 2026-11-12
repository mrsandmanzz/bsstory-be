import { describe, expect, it } from 'vitest';
import { charge, luhnValid, TEST_CARDS } from '../src/payments/mockGateway.js';

const now = new Date('2026-06-15T00:00:00Z');
const valid = { number: TEST_CARDS.success, exp: '12/39', cvc: '123' };

describe('mock payment gateway', () => {
  it('accepts the success test card and reports only the last four digits', () => {
    const r = charge(valid, now);
    expect(r).toMatchObject({ ok: true, last4: '4242' });
  });

  it('declines the published failure cards with a reason', () => {
    expect(charge({ ...valid, number: TEST_CARDS.declined }, now)).toMatchObject({ ok: false, reason: 'Your card was declined.' });
    expect(charge({ ...valid, number: TEST_CARDS.insufficientFunds }, now)).toMatchObject({ ok: false });
  });

  it('rejects numbers that fail the Luhn check', () => {
    expect(luhnValid('4242424242424242')).toBe(true);
    expect(luhnValid('4242424242424241')).toBe(false);
    expect(charge({ ...valid, number: '4242424242424241' }, now)).toMatchObject({
      ok: false,
      reason: 'Your card number is invalid.',
    });
  });

  it('rejects expired cards, treating the whole expiry month as valid', () => {
    expect(charge({ ...valid, exp: '05/26' }, now)).toMatchObject({ ok: false, reason: 'Your card has expired.' });
    expect(charge({ ...valid, exp: '06/26' }, now)).toMatchObject({ ok: true });
  });

  it('rejects a malformed expiry instead of crashing', () => {
    expect(charge({ ...valid, exp: '13/26' }, now)).toMatchObject({ ok: false });
    expect(charge({ ...valid, exp: 'soon' }, now)).toMatchObject({ ok: false });
  });
});
