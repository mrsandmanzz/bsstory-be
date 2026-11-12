import type { Plan } from './domain/types.js';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Settings that are dangerous to default in production fail fast instead: a forgotten JWT_SECRET lets anyone
 * forge admin tokens, a forgotten ADMIN_EMAILS leaves the public demo admin account open, and a missing
 * DATABASE_URL would point a read-only serverless filesystem at a SQLite file.
 */
function setting(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) throw new Error(`${name} must be set in production`);
  return devDefault;
}

export const config = {
  databaseUrl: setting('DATABASE_URL', 'file:./data/local.db'),
  databaseAuthToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  jwtSecret: setting('JWT_SECRET', 'dev-only-secret-change-me'),
  currency: process.env.CURRENCY ?? 'IDR',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim()),
  /** Demo data is on by default in development; production must opt in with AUTO_SEED=true. */
  autoSeed: process.env.AUTO_SEED ? process.env.AUTO_SEED === 'true' : !isProduction,
  /** Emails that are granted the admin role on first login (mock auth). */
  adminEmails: setting('ADMIN_EMAILS', 'admin@mainstory.test')
    .split(',')
    .map((s) => s.trim().toLowerCase()),
};

/** Length of the free trial offered to an account that has never subscribed. Same as Epic, Vooks and Lingokids. */
export const TRIAL_DAYS = 7;

/** Plans are config, not data: two SKUs, no admin UI needed for the MVP. */
export const PLANS: Plan[] = [
  { id: 'monthly', name: 'Monthly', interval: 'month', price: 49_000, days: 30, tagline: 'Flexible. Cancel anytime.' },
  { id: 'yearly', name: 'Yearly', interval: 'year', price: 399_000, days: 365, tagline: 'Best value, about 4 months free.' },
];
