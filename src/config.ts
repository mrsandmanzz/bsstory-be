import { parsePromo, type Promo } from './domain/promo.js';
import type { Plan } from './domain/types.js';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Settings that are dangerous to default in production fail fast instead: a forgotten JWT_SECRET lets anyone
 * forge admin tokens, a forgotten ADMIN_EMAILS leaves the public demo admin account open, and a missing
 * DATABASE_URL would leave a read-only serverless filesystem to hold the data.
 */
function setting(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) throw new Error(`${name} must be set in production`);
  return devDefault;
}

export const config = {
  databaseUrl: setting('DATABASE_URL', 'pglite:./data/dev'),
  jwtSecret: setting('JWT_SECRET', 'dev-only-secret-change-me'),
  currency: process.env.CURRENCY ?? 'IDR',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim()),
  /** Demo data is on by default in development; production must opt in with AUTO_SEED=true (any letter case). */
  autoSeed: process.env.AUTO_SEED ? process.env.AUTO_SEED.trim().toLowerCase() === 'true' : !isProduction,
  /** Emails that are granted the admin role on first login (mock auth). */
  adminEmails: setting('ADMIN_EMAILS', 'admin@mainstory.test')
    .split(',')
    .map((s) => s.trim().toLowerCase()),
};

/**
 * The launch offer. In development it defaults to a fixed, visible demo offer so the countdown can be seen;
 * in production there is NO promo unless PROMO_PERCENT and PROMO_ENDS_AT are both set.
 */
export const promo: Promo | null = parsePromo(
  process.env.PROMO_PERCENT ?? (isProduction ? undefined : '30'),
  process.env.PROMO_ENDS_AT ?? (isProduction ? undefined : '2026-11-30T16:59:59Z'), // 23:59:59 WIB
  process.env.PROMO_LABEL,
);

/** Length of the free trial offered to an account that has never subscribed. Same as Epic, Vooks and Lingokids. */
export const TRIAL_DAYS = 7;

/** Plans are config, not data: two SKUs, no admin UI needed for the MVP. */
export const PLANS: Plan[] = [
  { id: 'monthly', name: 'Monthly', interval: 'month', price: 49_000, days: 30, tagline: 'Flexible. Cancel anytime.' },
  { id: 'yearly', name: 'Yearly', interval: 'year', price: 399_000, days: 365, tagline: 'Best value, about 4 months free.' },
];
