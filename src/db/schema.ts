import type { Db } from './client.js';

/**
 * Idempotent schema bootstrap (CREATE IF NOT EXISTS). For an MVP on serverless this beats a
 * migration runner: a cold start can always bring an empty database to a working state.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    summary TEXT NOT NULL,
    age_min INTEGER NOT NULL,
    age_max INTEGER NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
    preview_pages INTEGER NOT NULL DEFAULT 2 CHECK (preview_pages >= 0),
    cover_emoji TEXT NOT NULL,
    cover_url TEXT,
    i18n TEXT,
    cover_from TEXT NOT NULL,
    cover_to TEXT NOT NULL,
    reading_minutes INTEGER NOT NULL DEFAULT 3,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS book_pages (
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    text TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '✨',
    image_url TEXT,
    activity TEXT,
    i18n TEXT,
    PRIMARY KEY (book_id, position)
  )`,
  // One row per user: renewals mutate it, history lives in payments.
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
    plan_id TEXT NOT NULL,
    current_period_start TEXT NOT NULL,
    current_period_end TEXT NOT NULL,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    trial INTEGER NOT NULL DEFAULT 0,
    promo_percent INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('subscription','book')),
    ref_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed')),
    failure_reason TEXT,
    idempotency_key TEXT,
    last4 TEXT,
    created_at TEXT NOT NULL
  )`,
  // A failed attempt must not block a retry with the same key, so only live (pending/succeeded) rows are unique.
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_idem ON payments(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL AND status != 'failed'`,
  // At most one in-flight payment per user and thing being bought (a subscription counts as one thing): this
  // reservation is taken BEFORE the gateway is called, which is what prevents double charges under concurrency.
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_pending ON payments(user_id, kind, (CASE WHEN kind = 'subscription' THEN '' ELSE ref_id END)) WHERE status = 'pending'`,
  // UNIQUE(user, book) guarantees a book is granted at most once, even if every other guard fails.
  `CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    book_id TEXT NOT NULL REFERENCES books(id),
    payment_id TEXT NOT NULL REFERENCES payments(id),
    amount INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, book_id)
  )`,
  `CREATE INDEX IF NOT EXISTS ix_books_status ON books(status)`,
];

const TABLES = ['users', 'books', 'book_pages', 'subscriptions', 'payments', 'purchases'];

export async function migrate(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    // Two cold starts migrating at once would collide inside the catalog; the lock makes the second one wait its turn.
    await tx.execute('SELECT pg_advisory_xact_lock(727274)');
    for (const sql of STATEMENTS) await tx.execute(sql);
    // Supabase exposes tables through its REST API. Row level security with no policies shuts that door, so only our
    // own server-side connection (which bypasses it) can read or write. A later column goes here as
    // `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`.
    for (const t of TABLES) await tx.execute(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
  });
}
