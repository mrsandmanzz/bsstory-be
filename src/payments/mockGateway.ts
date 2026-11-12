/**
 * Mock payment gateway. Mirrors how real PSPs (Stripe/Xendit/Midtrans) expose test cards, so swapping in a
 * real provider only means re-implementing `charge`. Raw card data never leaves this function and is never stored.
 */
export interface CardInput {
  number: string;
  exp: string; // MM/YY
  cvc: string;
}

export type ChargeResult = { ok: true; last4: string } | { ok: false; reason: string; last4: string };

export const TEST_CARDS = {
  success: '4242424242424242',
  declined: '4000000000000002',
  insufficientFunds: '4000000000009995',
  expired: '4000000000000069',
} as const;

const DECLINES: Record<string, string> = {
  [TEST_CARDS.declined]: 'Your card was declined.',
  [TEST_CARDS.insufficientFunds]: 'Your card has insufficient funds.',
  [TEST_CARDS.expired]: 'Your card has expired.',
};

export function luhnValid(num: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = Number(num[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function charge(card: CardInput, now = new Date()): ChargeResult {
  const number = card.number.replace(/\s|-/g, '');
  const last4 = number.slice(-4);
  if (DECLINES[number]) return { ok: false, reason: DECLINES[number], last4 };
  if (!luhnValid(number)) return { ok: false, reason: 'Your card number is invalid.', last4 };

  const expiry = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(card.exp);
  if (!expiry) return { ok: false, reason: 'Your card expiry date is invalid.', last4 };
  const firstDayAfterExpiry = new Date(2000 + Number(expiry[2]), Number(expiry[1]), 1);
  if (firstDayAfterExpiry.getTime() <= now.getTime()) return { ok: false, reason: 'Your card has expired.', last4 };

  return { ok: true, last4 };
}
