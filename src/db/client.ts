import { mkdirSync } from 'node:fs';
import { config } from '../config.js';

/**
 * The database as the rest of the app sees it: plain SQL with `?` placeholders, rows as objects, and atomic
 * multi-statement writes. Two engines sit behind it, both real PostgreSQL:
 *
 * - `postgres://...` (Supabase in production) through node-postgres (`pg`), which is pure JavaScript, so a serverless
 *   function never has to load a native module. It sends one query at a time per connection, which matters: the
 *   `postgres` package pipelines queries, and Supabase documents that pipelining through its pooler can hang or
 *   return mismatched rows;
 * - `pglite:` (local development and tests), PostgreSQL running inside the Node process: `pglite:memory` keeps
 *   nothing, `pglite:./data/dev` keeps its files in that folder. Nothing to install and no server to start.
 *
 * Keeping both on PostgreSQL means the tests exercise the same SQL, constraints and locking rules as production.
 */
export type Row = Record<string, unknown>;
export interface Result {
  rows: Row[];
  rowsAffected: number;
}
export type Statement = string | { sql: string; args?: readonly unknown[] };

/** Anything that can run a statement: the database itself, or one open transaction. */
export interface Executor {
  execute(stmt: Statement): Promise<Result>;
}
export interface Db extends Executor {
  /** Runs all statements in one transaction: either every one is applied or none is. */
  batch(stmts: readonly Statement[], mode?: 'write'): Promise<Result[]>;
  /** Runs `fn` in one transaction, for writes that depend on what an earlier statement in it returned. */
  transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const normalise = (stmt: Statement) =>
  typeof stmt === 'string' ? { sql: stmt, args: [] as readonly unknown[] } : { sql: stmt.sql, args: stmt.args ?? [] };

/** `?` placeholders to PostgreSQL's `$1, $2, ...`. A `?` inside a quoted string is left alone. */
export function toPgPlaceholders(sql: string): string {
  let out = '';
  let n = 0;
  let quote: string | null = null;
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '?') {
      out += `$${++n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

type Runner = (sql: string, args: unknown[]) => Promise<Result>;

/** Builds the `Db` on top of an engine: how to run one statement, one transaction, and how to shut down. */
function makeDb(run: Runner, tx: <T>(fn: (run: Runner) => Promise<T>) => Promise<T>, close: () => Promise<void>): Db {
  const exec = (runner: Runner) => (stmt: Statement) => {
    const { sql, args } = normalise(stmt);
    return runner(toPgPlaceholders(sql), [...args]);
  };
  const transaction = <T>(fn: (t: Executor) => Promise<T>) => tx((runner) => fn({ execute: exec(runner) }));
  return {
    execute: exec(run),
    transaction,
    batch: (stmts) =>
      transaction(async (t) => {
        const results: Result[] = [];
        for (const s of stmts) results.push(await t.execute(s)); // in order, inside the one transaction
        return results;
      }),
    close,
  };
}

async function pgliteDb(url: string): Promise<Db> {
  const target = url.slice('pglite:'.length);
  const { PGlite } = await import('@electric-sql/pglite');
  let dataDir: string | undefined;
  if (target && target !== 'memory') {
    mkdirSync(target, { recursive: true });
    dataDir = target;
  }
  const pg = new PGlite(dataDir);
  await pg.waitReady;
  type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> };
  const runner =
    (q: Queryable): Runner =>
    async (sql, args) => {
      const r = await q.query(sql, args);
      return { rows: r.rows as Row[], rowsAffected: r.affectedRows ?? 0 };
    };
  return makeDb(
    runner(pg),
    (fn) => pg.transaction((t) => fn(runner(t))),
    () => pg.close(),
  );
}

async function postgresDb(url: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
  const pool = new pg.Pool({
    connectionString: withoutSslMode(url),
    // Encrypt like `sslmode=require` (the pooler's certificate is not in Node's trust store, so it is not verified).
    ssl: local ? false : { rejectUnauthorized: false },
    // Supabase advises a tiny pool per serverless instance: the shared pooler is what fans many instances into the
    // database. Two (not one) so a transaction waiting on a second query can never deadlock against itself.
    max: 2,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
  });
  // An idle connection the server drops must not take the whole function down.
  pool.on('error', (e) => console.error('database pool error:', e.message));

  type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> };
  const runner =
    (q: Queryable): Runner =>
    async (text, args) => {
      const r = await q.query(text, args);
      return { rows: r.rows as Row[], rowsAffected: r.rowCount ?? 0 };
    };
  return makeDb(
    runner(pool),
    async (fn) => {
      const client = await pool.connect();
      let broken = false;
      try {
        await client.query('BEGIN');
        const out = await fn(runner(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch {
          broken = true; // could not even roll back: throw this connection away instead of reusing it
        }
        throw e;
      } finally {
        client.release(broken ? new Error('discarded after a failed rollback') : undefined);
      }
    },
    () => pool.end(),
  );
}

/** node-postgres reads `sslmode=require` as full certificate verification; we set SSL explicitly above instead. */
function withoutSslMode(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return url; // an unusual string (say, an unencoded password): hand it over untouched
  }
}

export async function createDb(url = config.databaseUrl): Promise<Db> {
  if (url.startsWith('pglite:')) return pgliteDb(url);
  if (/^postgres(ql)?:\/\//.test(url)) return postgresDb(url);
  throw new Error('DATABASE_URL must start with postgres:// (Supabase) or pglite: (local). See .env.example.');
}

/** True for PostgreSQL unique-constraint failures (SQLSTATE 23505). */
export const isUniqueViolation = (e: unknown): boolean =>
  (e as { code?: string } | null)?.code === '23505' || /duplicate key value violates unique constraint/i.test(String(e));

const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  '28P01',
  '28000',
  '53300',
  '57P01',
  '57P02',
  '57P03',
]);

/**
 * True when the database could not be reached or refused us (it is down, restarting, out of connections, or the
 * connection settings are wrong). Callers answer 503 "try again" instead of a bare 500. SQLSTATE class 08 is
 * "connection exception".
 */
export function isDatabaseUnavailable(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code && (UNAVAILABLE_CODES.has(err.code) || err.code.startsWith('08'))) return true;
  return /Connection terminated|timeout exceeded when trying to connect|Tenant or user not found|password authentication failed|too many clients|ECONNREFUSED/i.test(
    String(err?.message ?? ''),
  );
}
