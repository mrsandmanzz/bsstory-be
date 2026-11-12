import type { Book, Subscription, SubscriptionState, User } from './types.js';

/**
 * Access policy — the single source of truth for "can this person read this book?".
 * Pure functions (no I/O, clock injected) so every rule is unit-testable.
 */

export type AccessReason =
  | 'free' // price 0 book, open to everyone
  | 'admin' // staff can read everything (incl. drafts)
  | 'purchased' // owned forever, survives subscription lapse
  | 'subscription' // active (or ending-but-paid) subscription
  | 'locked' // published but needs purchase / subscription
  | 'unavailable'; // draft/archived and not entitled: behaves as non-existent

export interface AccessDecision {
  canRead: boolean;
  reason: AccessReason;
  /** Pages readable even when locked (teaser). */
  previewPages: number;
  /** Can this user buy this book right now? */
  canPurchase: boolean;
}

export function subscriptionState(sub: Subscription | null, now: Date): SubscriptionState {
  if (!sub) return 'none';
  const paidUntil = new Date(sub.currentPeriodEnd).getTime();
  if (paidUntil <= now.getTime()) return 'expired';
  return sub.cancelAtPeriodEnd ? 'ending' : 'active';
}

/** A cancelled subscription ("ending") keeps access until the paid period ends. */
export function hasSubscriptionAccess(sub: Subscription | null, now: Date): boolean {
  const s = subscriptionState(sub, now);
  return s === 'active' || s === 'ending';
}

export function decideAccess(input: {
  book: Book;
  user: User | null;
  subscription: Subscription | null;
  owned: boolean;
  now: Date;
}): AccessDecision {
  const { book, user, subscription, owned, now } = input;
  const isAdmin = user?.role === 'admin';
  const preview = book.previewPages;

  if (isAdmin) return { canRead: true, reason: 'admin', previewPages: preview, canPurchase: false };

  // Draft books are invisible to everyone but staff.
  if (book.status === 'draft') return { canRead: false, reason: 'unavailable', previewPages: 0, canPurchase: false };

  // Owners keep access even if the book is later archived (we sold it to them).
  if (owned) return { canRead: true, reason: 'purchased', previewPages: preview, canPurchase: false };

  // Archived (withdrawn from sale): not even subscribers get it, not purchasable.
  if (book.status === 'archived') {
    return { canRead: false, reason: 'unavailable', previewPages: 0, canPurchase: false };
  }

  if (book.price === 0) return { canRead: true, reason: 'free', previewPages: preview, canPurchase: false };

  if (user && hasSubscriptionAccess(subscription, now)) {
    // Subscribers may still buy to keep a book forever, so canPurchase stays true.
    return { canRead: true, reason: 'subscription', previewPages: preview, canPurchase: true };
  }

  return { canRead: false, reason: 'locked', previewPages: preview, canPurchase: true };
}
