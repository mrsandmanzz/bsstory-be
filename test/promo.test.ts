import { describe, expect, it } from 'vitest';
import { activePromo, discountedPrice, parsePromo, type Promo } from '../src/domain/promo.js';

const promo: Promo = { percent: 30, endsAt: '2026-11-30T16:59:59.000Z', label: 'Launch offer' };

describe('discountedPrice', () => {
  it('takes the percentage off and rounds to the nearest 1,000', () => {
    expect(discountedPrice(399_000, 30)).toBe(279_000); // 279,300
    expect(discountedPrice(49_000, 30)).toBe(34_000); // 34,300
    expect(discountedPrice(49_000, 50)).toBe(25_000); // 24,500 rounds up
  });
  it('leaves the price alone for 0%', () => {
    expect(discountedPrice(49_000, 0)).toBe(49_000);
  });
  it('never goes below zero', () => {
    expect(discountedPrice(400, 90)).toBe(0);
  });
});

describe('activePromo', () => {
  it('is active before the end and gone from the end instant on', () => {
    expect(activePromo(promo, new Date('2026-11-30T16:59:58.999Z'))).toBe(promo);
    expect(activePromo(promo, new Date('2026-11-30T16:59:59.000Z'))).toBeNull();
    expect(activePromo(promo, new Date('2027-01-01T00:00:00Z'))).toBeNull();
  });
  it('is off when there is no promo or its date is unusable', () => {
    expect(activePromo(null, new Date())).toBeNull();
    expect(activePromo({ ...promo, endsAt: 'not a date' }, new Date())).toBeNull();
  });
});

describe('parsePromo', () => {
  it('reads valid settings and normalises the end to an ISO instant', () => {
    expect(parsePromo('25', '2026-12-31T16:59:59Z', ' Year-end ')).toEqual({
      percent: 25,
      endsAt: '2026-12-31T16:59:59.000Z',
      label: 'Year-end',
    });
  });
  it('falls back to a default label', () => {
    expect(parsePromo('10', '2026-12-31T00:00:00Z', undefined)?.label).toBe('Launch offer');
  });
  it('means "no promo" for anything missing or out of range, never a half-working one', () => {
    expect(parsePromo(undefined, '2026-12-31T00:00:00Z', undefined)).toBeNull();
    expect(parsePromo('30', undefined, undefined)).toBeNull();
    expect(parsePromo('0', '2026-12-31T00:00:00Z', undefined)).toBeNull();
    expect(parsePromo('95', '2026-12-31T00:00:00Z', undefined)).toBeNull();
    expect(parsePromo('12.5', '2026-12-31T00:00:00Z', undefined)).toBeNull();
    expect(parsePromo('30', 'soon', undefined)).toBeNull();
  });
});
