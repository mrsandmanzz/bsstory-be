import { config, promo } from './config.js';
import type { Promo } from './domain/promo.js';
import { createDb, isUniqueViolation, type Db } from './db/client.js';
import { migrate } from './db/schema.js';
import { seedIfEmpty } from './db/seed.js';
import { billingRepo } from './repositories/billing.js';
import { booksRepo } from './repositories/books.js';
import { imagesRepo } from './repositories/images.js';
import { usersRepo } from './repositories/users.js';
import { authService } from './services/auth.js';
import { billingService } from './services/billing.js';
import { booksService } from './services/books.js';
import { imagesService } from './services/images.js';

/** Composition root: the only place that wires concrete implementations together. */
export function buildContainer(db: Db, clock: () => Date = () => new Date(), offer: Promo | null = promo) {
  const users = usersRepo(db);
  const books = booksRepo(db);
  const billing = billingRepo(db);
  const billingSvc = billingService(billing, books, clock, offer);
  return {
    db,
    auth: authService(users, clock),
    books: booksService(books, billing, billingSvc.currentSubscription, clock),
    billing: billingSvc,
    images: imagesService(imagesRepo(db), clock),
    /** Idempotent: brings an empty DB to a working demo state. Safe to call on every cold start. */
    async bootstrap() {
      await migrate(db);
      if (!config.autoSeed) return;
      try {
        await seedIfEmpty(db, books, users, clock);
      } catch (e) {
        // Two cold starts seeding an empty database at once: the other one wins, which is fine.
        if (!isUniqueViolation(e)) throw e;
      }
    },
  };
}

export type Container = ReturnType<typeof buildContainer>;

let shared: Promise<Container> | undefined;
/** Lazily created once per serverless instance. */
export function getContainer(): Promise<Container> {
  shared ??= (async () => {
    const c = buildContainer(await createDb());
    await c.bootstrap();
    return c;
  })();
  shared.catch(() => (shared = undefined)); // allow retry after a transient failure
  return shared;
}
