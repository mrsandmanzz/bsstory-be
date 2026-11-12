import type { Db } from './client.js';
import type { booksRepo } from '../repositories/books.js';
import type { usersRepo } from '../repositories/users.js';
import { slugify } from '../domain/slug.js';
import { SEED_BOOKS } from './seed-data.js';

export const DEMO_USERS = [
  { email: 'admin@mainstory.test', name: 'Admin Ayu', role: 'admin' as const },
  { email: 'parent@mainstory.test', name: 'Parent Putri', role: 'user' as const },
  { email: 'subscriber@mainstory.test', name: 'Subscriber Sari', role: 'user' as const },
];

export async function seedIfEmpty(
  db: Db,
  books: ReturnType<typeof booksRepo>,
  users: ReturnType<typeof usersRepo>,
  clock: () => Date,
): Promise<void> {
  if ((await books.count()) > 0) return;
  const now = clock().toISOString();
  for (const input of SEED_BOOKS) {
    const { pages, ...fields } = input;
    const s = slugify(input.title);
    await books.save(
      { id: crypto.randomUUID(), slug: s, coverUrl: `/stories/${s}/cover.jpg`, ...fields },
      pages.map((p, i) => ({ ...p, imageUrl: `/stories/${s}/p${i + 1}.jpg`, activity: p.activity ?? null })),
      now,
      true,
    );
  }
  for (const u of DEMO_USERS) {
    if (!(await users.findByEmail(u.email))) await users.create({ id: crypto.randomUUID(), createdAt: now, ...u });
  }
  // Give the demo subscriber a live yearly subscription so the "subscribed" state is explorable immediately.
  const sub = await users.findByEmail('subscriber@mainstory.test');
  if (sub) {
    const end = new Date(clock().getTime() + 365 * 86_400_000).toISOString();
    const payId = crypto.randomUUID();
    await db.batch(
      [
        {
          sql: `INSERT INTO payments (id,user_id,kind,ref_id,amount,currency,status,failure_reason,idempotency_key,last4,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          args: [payId, sub.id, 'subscription', 'yearly', 399000, 'IDR', 'succeeded', null, null, '4242', now],
        },
        {
          sql: 'INSERT INTO subscriptions (id,user_id,plan_id,current_period_start,current_period_end,cancel_at_period_end) VALUES (?,?,?,?,?,0)',
          args: [crypto.randomUUID(), sub.id, 'yearly', now, end],
        },
      ],
      'write',
    );
  }
}
