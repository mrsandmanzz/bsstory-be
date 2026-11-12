import { z } from 'zod';
import { PLANS, TRIAL_DAYS, config } from '../config.js';
import { isUniqueViolation } from '../db/client.js';
import { decideAccess, subscriptionState } from '../domain/access.js';
import { Errors } from '../domain/errors.js';
import type { Payment, Subscription, User } from '../domain/types.js';
import { charge, type CardInput } from '../payments/mockGateway.js';
import type { billingRepo } from '../repositories/billing.js';
import type { booksRepo } from '../repositories/books.js';

export const cardInput = z.object({
  number: z.string().regex(/^[\d\s-]{12,23}$/, 'Enter a valid card number'),
  exp: z.string().regex(/^(0[1-9]|1[0-2])\/\d{2}$/, 'Use MM/YY'),
  cvc: z.string().regex(/^\d{3,4}$/, 'Enter a 3–4 digit CVC'),
});

const DAY_MS = 86_400_000;
/** A payment still "pending" after this long is assumed dead (crashed request) and stops blocking retries. */
const STALE_PENDING_MS = 2 * 60_000;
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);

export const billingService = (billing: ReturnType<typeof billingRepo>, books: ReturnType<typeof booksRepo>, clock: () => Date) => {
  /**
   * The user's subscription, renewing it first if it lapsed without being cancelled (mock auto-renewal,
   * card on file assumed). Every read path goes through here so access never depends on who called `/me` first.
   * A long lapse restarts the period today instead of back-charging missed months.
   */
  async function currentSubscription(userId: string): Promise<Subscription | null> {
    const sub = await billing.subscriptionOf(userId);
    const now = clock();
    if (!sub || sub.cancelAtPeriodEnd || subscriptionState(sub, now) !== 'expired') return sub;
    const plan = PLANS.find((p) => p.id === sub.planId);
    if (!plan) return sub;

    const lapsedEnd = new Date(sub.currentPeriodEnd);
    const start = addDays(lapsedEnd, plan.days) > now ? lapsedEnd : now;
    const renewed: Subscription = {
      ...sub,
      currentPeriodStart: start.toISOString(),
      currentPeriodEnd: addDays(start, plan.days).toISOString(),
      trial: false, // the first paid period begins: the trial is over
    };
    const payment: Payment = {
      id: crypto.randomUUID(),
      userId,
      kind: 'subscription',
      refId: plan.id,
      amount: plan.price,
      currency: config.currency,
      status: 'succeeded',
      failureReason: null,
      idempotencyKey: `renew:${sub.id}:${sub.currentPeriodEnd}`,
      last4: null, // renewal uses the card on file; the mock never stores card data
      createdAt: now.toISOString(),
    };
    const won = await billing.renewSubscription(payment, renewed, sub.currentPeriodEnd);
    return won ? renewed : billing.subscriptionOf(userId); // someone else renewed first
  }

  async function me(user: User) {
    const sub = await currentSubscription(user.id);
    const purchases = await billing.purchasesOf(user.id);
    return {
      user,
      subscription: sub && { ...sub, state: subscriptionState(sub, clock()), plan: PLANS.find((p) => p.id === sub.planId) ?? null },
      purchasedBookIds: purchases.map((p) => p.bookId),
      /** A never-subscribed account gets the free trial; once any subscription row exists it is used up. */
      trialEligible: sub === null,
      trialDays: TRIAL_DAYS,
    };
  }

  /**
   * Has this exact request (same Idempotency-Key, same target) already succeeded? Checked before anything
   * else, so a client retry gets the original result instead of an "already owned" error.
   */
  async function alreadyDone(user: User, kind: Payment['kind'], refId: string, key?: string): Promise<boolean> {
    if (!key) return false;
    const prior = await billing.findLivePaymentByKey(user.id, key);
    if (!prior) return false;
    if (prior.kind !== kind || prior.refId !== refId) throw Errors.keyReuse();
    if (prior.status === 'succeeded') return true;
    throw Errors.paymentInProgress();
  }

  /**
   * Reserve the in-flight slot BEFORE touching the gateway. The reservation is what makes concurrent buys
   * safe: a second request cannot reserve, so it cannot charge.
   */
  async function reserve(user: User, kind: Payment['kind'], refId: string, amount: number, key?: string): Promise<Payment> {
    const now = clock();
    await billing.expireStalePending(user.id, new Date(now.getTime() - STALE_PENDING_MS).toISOString());
    const payment: Payment = {
      id: crypto.randomUUID(),
      userId: user.id,
      kind,
      refId,
      amount,
      currency: config.currency,
      status: 'pending',
      failureReason: null,
      idempotencyKey: key ?? null,
      last4: null,
      createdAt: now.toISOString(),
    };
    try {
      await billing.reservePayment(payment);
    } catch (e) {
      throw isUniqueViolation(e) ? Errors.paymentInProgress() : e;
    }
    return payment;
  }

  /** Charge the reserved payment. A decline releases the reservation and is recorded for history. */
  async function collect(payment: Payment, card: CardInput): Promise<string> {
    const result = charge(card, clock());
    if (!result.ok) {
      await billing.failPayment(payment.id, result.reason, result.last4);
      throw Errors.paymentFailed(result.reason);
    }
    return result.last4;
  }

  /** The world changed between our checks and the reservation (a concurrent request finished): void instead of charging. */
  async function abort(payment: Payment, reason: string, error: Error): Promise<never> {
    await billing.failPayment(payment.id, reason, null);
    throw error;
  }

  return {
    plans: () => PLANS,
    currentSubscription,
    me,

    async history(user: User) {
      return { payments: await billing.paymentsOf(user.id), purchases: await billing.purchasesOf(user.id) };
    },

    async subscribe(user: User, planId: string, card: CardInput, key?: string) {
      const plan = PLANS.find((p) => p.id === planId);
      if (!plan) throw Errors.notFound('Plan');

      if (await alreadyDone(user, 'subscription', plan.id, key)) return me(user);
      const isActive = async () => ['active', 'ending'].includes(subscriptionState(await currentSubscription(user.id), clock()));
      if (await isActive()) throw Errors.alreadySubscribed();

      // First-time subscribers start with a free trial: the card is verified now, charged when the trial ends,
      // and nothing is charged at all if they cancel first. One trial per account.
      const existing = await billing.subscriptionOf(user.id);
      const trial = existing === null;

      const payment = await reserve(user, 'subscription', plan.id, trial ? 0 : plan.price, key);
      if (await isActive()) return abort(payment, 'Already subscribed', Errors.alreadySubscribed());

      const last4 = await collect(payment, card);
      const start = clock();
      await billing.completeSubscriptionPayment(payment.id, last4, {
        id: existing?.id ?? crypto.randomUUID(),
        userId: user.id,
        planId: plan.id,
        currentPeriodStart: start.toISOString(),
        currentPeriodEnd: addDays(start, trial ? TRIAL_DAYS : plan.days).toISOString(),
        cancelAtPeriodEnd: false,
        trial,
      });
      return me(user);
    },

    async buyBook(user: User, bookKey: string, card: CardInput, key?: string) {
      const book = await books.findByIdOrSlug(bookKey);
      if (!book) throw Errors.notFound('Book');

      const check = async () => {
        const owned = await billing.owns(user.id, book.id);
        if (owned) return Errors.alreadyOwned();
        // Price comes from the DB, never from the client. Drafts, archived and free books cannot be bought.
        const subscription = await currentSubscription(user.id);
        return decideAccess({ book, user, subscription, owned, now: clock() }).canPurchase ? null : Errors.notPurchasable();
      };

      if (await alreadyDone(user, 'book', book.id, key)) return me(user);
      const early = await check();
      if (early) throw early;
      const payment = await reserve(user, 'book', book.id, book.price, key);
      const late = await check();
      if (late) return abort(payment, late.message, late);

      const last4 = await collect(payment, card);
      try {
        await billing.completeBookPurchase(payment.id, last4, {
          id: crypto.randomUUID(),
          userId: user.id,
          bookId: book.id,
          paymentId: payment.id,
          amount: book.price,
          createdAt: payment.createdAt,
        });
      } catch (e) {
        // UNIQUE(user_id, book_id) is the final guard. The batch rolled back, so release the reservation.
        if (isUniqueViolation(e)) return abort(payment, 'Already owned', Errors.alreadyOwned());
        throw e;
      }
      return me(user);
    },

    /** Cancelling stops renewal; paid access continues until the period ends (no pro-rata, no instant cut-off). */
    async cancel(user: User) {
      // Read the raw row: cancelling must never trigger a renewal charge first.
      const sub = await billing.subscriptionOf(user.id);
      if (!sub || sub.cancelAtPeriodEnd) throw Errors.conflict('No active subscription to cancel');
      await billing.setCancelAtPeriodEnd(user.id, true);
      return me(user);
    },

    async resume(user: User) {
      const sub = await billing.subscriptionOf(user.id);
      if (subscriptionState(sub, clock()) !== 'ending') throw Errors.conflict('Only a subscription that is set to end can be resumed');
      await billing.setCancelAtPeriodEnd(user.id, false);
      return me(user);
    },
  };
};
