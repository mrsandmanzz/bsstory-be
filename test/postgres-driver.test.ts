import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildContainer } from '../src/container.js';
import { createDb, isUniqueViolation, toPgPlaceholders, type Db } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';

describe('placeholders', () => {
  it('turns ? into $1, $2, ... and leaves a ? inside a quoted string alone', () => {
    expect(toPgPlaceholders(`SELECT ?, '?', "a?b", ?`)).toBe(`SELECT $1, '?', "a?b", $2`);
  });
});

/**
 * The `postgres://` path is what runs against Supabase. PGlite can speak the PostgreSQL wire protocol over a local
 * port, so the real `postgres` driver (and our adapter around it) can be exercised here without installing a server.
 * Everything below goes over that connection.
 */
describe('postgres:// driver, the Supabase path', () => {
  let backing: PGlite;
  let server: PGLiteSocketServer;
  let db: Db;

  beforeAll(async () => {
    backing = new PGlite();
    await backing.waitReady;
    // The app opens a few connections at once, like it does against Supabase's pooler; PGlite queues their queries.
    server = new PGLiteSocketServer({ db: backing, port: 54329, host: '127.0.0.1', maxConnections: 10 });
    await server.start();
    db = await createDb('postgres://postgres:postgres@127.0.0.1:54329/postgres');
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await server.stop();
    await backing.close();
  });

  it('runs statements with ? arguments and reports rows and affected rows', async () => {
    await db.execute('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL)');
    const ins = await db.execute({ sql: 'INSERT INTO t (id, n) VALUES (?, ?), (?, ?)', args: ['a', 1, 'b', 2] });
    expect(ins.rowsAffected).toBe(2);
    const up = await db.execute({ sql: 'UPDATE t SET n = ? WHERE id = ?', args: [10, 'a'] });
    expect(up.rowsAffected).toBe(1);
    const rows = (await db.execute({ sql: 'SELECT id, n FROM t WHERE id != ? ORDER BY id', args: ['zzz'] })).rows;
    expect(rows).toEqual([
      { id: 'a', n: 10 },
      { id: 'b', n: 2 },
    ]);
    // COUNT(*) is a bigint in PostgreSQL; the repositories wrap it in Number(), so either form must convert cleanly.
    expect(Number((await db.execute('SELECT COUNT(*) AS n FROM t')).rows[0]?.n)).toBe(2);
  });

  it('applies a batch all together, or not at all', async () => {
    await expect(
      db.batch([
        { sql: 'INSERT INTO t (id, n) VALUES (?, ?)', args: ['c', 3] },
        { sql: 'INSERT INTO t (id, n) VALUES (?, ?)', args: ['a', 99] }, // duplicate key
      ]),
    ).rejects.toSatisfy(isUniqueViolation);
    expect((await db.execute({ sql: 'SELECT 1 FROM t WHERE id = ?', args: ['c'] })).rows).toHaveLength(0);
  });

  it('commits a transaction that returns a value and rolls back one that throws', async () => {
    const won = await db.transaction(async (tx) => {
      const r = await tx.execute({ sql: 'UPDATE t SET n = n + 1 WHERE id = ?', args: ['b'] });
      return r.rowsAffected > 0;
    });
    expect(won).toBe(true);
    expect((await db.execute({ sql: 'SELECT n FROM t WHERE id = ?', args: ['b'] })).rows[0]?.n).toBe(3);

    await expect(
      db.transaction(async (tx) => {
        await tx.execute({ sql: 'UPDATE t SET n = 0 WHERE id = ?', args: ['b'] });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await db.execute({ sql: 'SELECT n FROM t WHERE id = ?', args: ['b'] })).rows[0]?.n).toBe(3);
  });

  it('migrates, seeds and serves the app over the real driver, and migrating twice is harmless', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const c = buildContainer(db, () => now, null);
    await c.bootstrap();
    await c.bootstrap();
    const app = createApp(async () => c);

    const books = await (await app.request('/v1/books')).json();
    expect(books.books).toHaveLength(6);

    const login = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'driver-test@x.test' }),
    });
    const { token } = await login.json();
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    expect((await (await app.request('/v1/books/the-little-red-boat/read', { headers: auth })).json()).locked).toBe(true);
    const buy = await app.request('/v1/checkout/books/the-little-red-boat', {
      method: 'POST',
      headers: { ...auth, 'Idempotency-Key': 'driver-1' },
      body: JSON.stringify({ card: { number: '4242 4242 4242 4242', exp: '12/39', cvc: '123' } }),
    });
    expect(buy.status).toBe(201);
    expect((await (await app.request('/v1/books/the-little-red-boat/read', { headers: auth })).json()).locked).toBe(false);

    // the same purchase again is refused by the database-backed rules
    const again = await app.request('/v1/checkout/books/the-little-red-boat', {
      method: 'POST',
      headers: { ...auth, 'Idempotency-Key': 'driver-2' },
      body: JSON.stringify({ card: { number: '4242 4242 4242 4242', exp: '12/39', cvc: '123' } }),
    });
    expect(again.status).toBe(409);
  }, 60_000);

  it('stores and returns binary image data intact over the real driver', async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 253, 254, 255]);
    const c = buildContainer(db, () => new Date('2026-01-01T00:00:00Z'), null);
    const { url } = await c.images.upload(bytes);
    const back = await c.images.get(url.split('/').pop() ?? '');
    expect(back.contentType).toBe('image/png');
    expect(Array.from(back.data)).toEqual(Array.from(bytes));
  });

  it("enables row level security on every table, so Supabase's public REST API cannot read them", async () => {
    const r = await db.execute(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('users','books','book_pages','subscriptions','payments','purchases','images')`,
    );
    expect(r.rows).toHaveLength(7);
    expect(r.rows.every((row) => row.relrowsecurity === true)).toBe(true);
  });
});
