import { describe, expect, it } from 'vitest';
import { rankNext } from '../src/domain/recommend.js';

const book = (id: string, ageMin: number, ageMax: number, canRead: boolean, createdAt = '2026-01-01') => ({
  id,
  ageMin,
  ageMax,
  createdAt,
  access: { canRead },
});
const current = { id: 'cur', ageMin: 2, ageMax: 4 };

describe('rankNext', () => {
  it('never suggests the current book', () => {
    expect(rankNext(current, [book('cur', 2, 4, true), book('a', 2, 4, true)]).map((b) => b.id)).toEqual(['a']);
  });
  it('puts books for the same age before books for other ages', () => {
    const out = rankNext(current, [book('older', 7, 9, true), book('same', 3, 5, true)]);
    expect(out.map((b) => b.id)).toEqual(['same', 'older']);
  });
  it('prefers the closer age when nothing overlaps', () => {
    const out = rankNext(current, [book('far', 10, 12, true), book('near', 6, 8, true)]);
    expect(out.map((b) => b.id)).toEqual(['near', 'far']);
  });
  it('lists a readable book before a locked one of equal fit, then keeps catalogue order', () => {
    const out = rankNext(current, [
      book('locked', 2, 4, false, '2026-01-01'),
      book('open', 2, 4, true, '2026-01-02'),
      book('open2', 2, 4, true, '2026-01-01'),
    ]);
    expect(out.map((b) => b.id)).toEqual(['open2', 'open', 'locked']);
  });
});
