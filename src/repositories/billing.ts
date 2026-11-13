import type { Db } from '../db/client.js';
import type { Payment, Purchase, Subscription } from '../domain/types.js';

const mapSub = (r: Record<string, unknown>): Subscription => ({
  id: String(r.id),
  userId: String(r.user_id),
  planId: String(r.plan_id),
  currentPeriodStart: String(r.current_period_start),
  currentPeriodEnd: String(r.current_period_end),
  cancelAtPeriodEnd: Number(r.cancel_at_period_end) === 1,
  trial: Number(r.trial) === 1,
  promoPercent: Number(r.promo_percent ?? 0),
});

const mapPayment = (r: Record<string, unknown>): Payment => ({
  id: String(r.id),
  userId: String(r.user_id),
  kind: r.kind as Payment['kind'],
  refId: String(r.ref_id),
  amount: Number(r.amount),
  currency: String(r.currency),
  status: r.status as Payment['status'],
  failureReason: (r.failure_reason as string | null) ?? null,
  idempotencyKey: (r.idempotency_key as string | null) ?? null,
  last4: (r.last4 as string | null) ?? null,
  createdAt: String(r.created_at),
});

const mapPurchase = (r: Record<string, unknown>): Purchase => ({
  id: String(r.id),
  userId: String(r.user_id),
  bookId: String(r.book_id),
  paymentId: String(r.payment_id),
  amount: Number(r.amount),
  createdAt: String(r.created_at),
});

const PAYMENT_INSERT = `INSERT INTO payments (id,user_id,kind,ref_id,amount,currency,status,failure_reason,idempotency_key,last4,created_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?)`;
const PAYMENT_INSERT_SELECT = `INSERT INTO payments (id,user_id,kind,ref_id,amount,currency,status,failure_reason,idempotency_key,last4,created_at)
                               SELECT ?,?,?,?,?,?,?,?,?,?,?`;
const paymentArgs = (p: Payment) => [
  p.id,
  p.userId,
  p.kind,
  p.refId,
  p.amount,
  p.currency,
  p.status,
  p.failureReason,
  p.idempotencyKey,
  p.last4,
  p.createdAt,
];

const SETTLE_SUCCESS = `UPDATE payments SET status = 'succeeded', last4 = ? WHERE id = ? AND status = 'pending'`;

export const billingRepo = (db: Db) => ({
  async subscriptionOf(userId: string): Promise<Subscription | null> {
    const r = await db.execute({ sql: 'SELECT * FROM subscriptions WHERE user_id = ?', args: [userId] });
    return r.rows[0] ? mapSub(r.rows[0]) : null;
  },
  async purchasesOf(userId: string): Promise<Purchase[]> {
    const r = await db.execute({ sql: 'SELECT * FROM purchases WHERE user_id = ? ORDER BY created_at DESC', args: [userId] });
    return r.rows.map(mapPurchase);
  },
  async owns(userId: string, bookId: string): Promise<boolean> {
    const r = await db.execute({ sql: 'SELECT 1 FROM purchases WHERE user_id = ? AND book_id = ?', args: [userId, bookId] });
    return r.rows.length > 0;
  },
  async paymentsOf(userId: string): Promise<Payment[]> {
    const r = await db.execute({ sql: 'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', args: [userId] });
    return r.rows.map(mapPayment);
  },
  /** The live (pending or succeeded) payment for an idempotency key. Failed attempts never block a retry. */
  async findLivePaymentByKey(userId: string, key: string): Promise<Payment | null> {
    const r = await db.execute({
      sql: `SELECT * FROM payments WHERE user_id = ? AND idempotency_key = ? AND status != 'failed'`,
      args: [userId, key],
    });
    return r.rows[0] ? mapPayment(r.rows[0]) : null;
  },

  /** Take the in-flight slot for this purchase. Throws a UNIQUE violation if one is already running. */
  async reservePayment(pending: Payment): Promise<void> {
    await db.execute({ sql: PAYMENT_INSERT, args: paymentArgs(pending) });
  },
  /** A crashed request would otherwise hold its reservation forever. */
  async expireStalePending(userId: string, olderThan: string): Promise<void> {
    await db.execute({
      sql: `UPDATE payments SET status = 'failed', failure_reason = 'Timed out' WHERE user_id = ? AND status = 'pending' AND created_at < ?`,
      args: [userId, olderThan],
    });
  },
  async failPayment(id: string, reason: string, last4: string | null): Promise<void> {
    await db.execute({
      sql: `UPDATE payments SET status = 'failed', failure_reason = ?, last4 = ? WHERE id = ? AND status = 'pending'`,
      args: [reason, last4, id],
    });
  },
  /** Mark the payment succeeded and grant the book in one atomic batch: never charged without access. */
  async completeBookPurchase(paymentId: string, last4: string, purchase: Purchase): Promise<void> {
    await db.batch(
      [
        { sql: SETTLE_SUCCESS, args: [last4, paymentId] },
        {
          sql: 'INSERT INTO purchases (id,user_id,book_id,payment_id,amount,created_at) VALUES (?,?,?,?,?,?)',
          args: [purchase.id, purchase.userId, purchase.bookId, purchase.paymentId, purchase.amount, purchase.createdAt],
        },
      ],
      'write',
    );
  },
  /** Mark the payment succeeded and start (or restart after expiry) the subscription atomically. */
  async completeSubscriptionPayment(paymentId: string, last4: string, sub: Subscription): Promise<void> {
    await db.batch(
      [
        { sql: SETTLE_SUCCESS, args: [last4, paymentId] },
        {
          sql: `INSERT INTO subscriptions (id,user_id,plan_id,current_period_start,current_period_end,cancel_at_period_end,trial,promo_percent)
                VALUES (?,?,?,?,?,0,?,?)
                ON CONFLICT(user_id) DO UPDATE SET plan_id=excluded.plan_id, current_period_start=excluded.current_period_start,
                  current_period_end=excluded.current_period_end, cancel_at_period_end=0, trial=excluded.trial,
                  promo_percent=excluded.promo_percent`,
          args: [sub.id, sub.userId, sub.planId, sub.currentPeriodStart, sub.currentPeriodEnd, sub.trial ? 1 : 0, sub.promoPercent],
        },
      ],
      'write',
    );
  },
  /**
   * Renew exactly once per lapsed period. The UPDATE only matches while the period end is still the value the
   * caller saw (compare-and-set), and the payment row is inserted only if that UPDATE changed a row, all in one
   * atomic batch. Concurrent requests therefore cannot both renew or both record a charge.
   * Returns whether this caller won.
   */
  async renewSubscription(payment: Payment, renewed: Subscription, expectedPeriodEnd: string): Promise<boolean> {
    const [update] = await db.batch(
      [
        {
          sql: `UPDATE subscriptions SET current_period_start = ?, current_period_end = ?, trial = 0, promo_percent = 0
                WHERE user_id = ? AND current_period_end = ? AND cancel_at_period_end = 0`,
          args: [renewed.currentPeriodStart, renewed.currentPeriodEnd, renewed.userId, expectedPeriodEnd],
        },
        { sql: `${PAYMENT_INSERT_SELECT} WHERE changes() > 0`, args: paymentArgs(payment) },
      ],
      'write',
    );
    return (update?.rowsAffected ?? 0) > 0;
  },
  async setCancelAtPeriodEnd(userId: string, value: boolean): Promise<void> {
    await db.execute({ sql: 'UPDATE subscriptions SET cancel_at_period_end = ? WHERE user_id = ?', args: [value ? 1 : 0, userId] });
  },
});
