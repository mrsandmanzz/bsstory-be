import type { Book } from './types.js';

/** The slice of a book view that ranking needs. */
export interface Candidate extends Pick<Book, 'id' | 'ageMin' | 'ageMax' | 'createdAt'> {
  access: { canRead: boolean };
}

const overlaps = (a: Pick<Book, 'ageMin' | 'ageMax'>, b: Pick<Book, 'ageMin' | 'ageMax'>) => a.ageMin <= b.ageMax && b.ageMin <= a.ageMax;

/**
 * Orders "what to read next" after `current`: books for the same age first, then the closest age, then ones the
 * reader can open right now (so the first suggestion is a story they can start), then catalogue order, which keeps the
 * suggestions stable instead of shuffling on every visit. The server cannot see what a child has already read (that
 * lives on the device), so the client may ask us to skip finished slugs.
 */
export function rankNext<T extends Candidate>(current: Pick<Book, 'id' | 'ageMin' | 'ageMax'>, candidates: readonly T[]): T[] {
  return candidates
    .filter((c) => c.id !== current.id)
    .map((c) => ({ c, fits: overlaps(current, c) ? 0 : 1, gap: Math.abs(c.ageMin - current.ageMin), locked: c.access.canRead ? 0 : 1 }))
    .sort((x, y) => x.fits - y.fits || x.gap - y.gap || x.locked - y.locked || x.c.createdAt.localeCompare(y.c.createdAt))
    .map((x) => x.c);
}
