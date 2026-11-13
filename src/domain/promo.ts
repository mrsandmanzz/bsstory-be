/**
 * A limited-time launch offer on subscriptions. Pure rules, no I/O.
 *
 * The countdown is real: the offer ends at a fixed instant (`endsAt`) that comes from configuration, never a
 * timer that resets per visitor. The server is the only judge of whether it is still running; the web app just
 * displays what the server says and counts down to the same instant.
 */
export interface Promo {
  /** Whole percent taken off the first payment of a subscription (1 to 90). */
  percent: number;
  /** ISO instant the offer stops being available. */
  endsAt: string;
  label: string;
}

/** The promo if it is running at `now`, otherwise null. The end instant itself is already too late. */
export function activePromo(promo: Promo | null, now: Date): Promo | null {
  if (!promo) return null;
  const end = Date.parse(promo.endsAt);
  return Number.isFinite(end) && now.getTime() < end ? promo : null;
}

const ROUND_TO = 1_000;

/** Price after the discount, rounded to the nearest 1,000 so prices read like "Rp 279.000", never "Rp 279.300". */
export function discountedPrice(price: number, percent: number): number {
  if (percent <= 0) return price;
  return Math.max(0, Math.round((price * (100 - percent)) / 100 / ROUND_TO) * ROUND_TO);
}

/** Reads a promo from raw settings. Anything missing or invalid means "no promo" rather than a half-working one. */
export function parsePromo(percent: string | undefined, endsAt: string | undefined, label: string | undefined): Promo | null {
  const pct = Number(percent);
  if (!percent || !Number.isInteger(pct) || pct < 1 || pct > 90) return null;
  if (!endsAt || !Number.isFinite(Date.parse(endsAt))) return null;
  return { percent: pct, endsAt: new Date(endsAt).toISOString(), label: label?.trim() || 'Launch offer' };
}
