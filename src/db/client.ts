import { mkdirSync } from 'node:fs';
import { config } from '../config.js';

/**
 * The database as the rest of the app sees it: plain SQL with `?` placeholders, rows as objects, and atomic
 * multi-statement writes. Two engines sit behind it, both real PostgreSQL:
 *
 * - `postgres://...` (Supabase in production) through the `postgres` driver, which is pure JavaScript, so a
 *   serverless function never has to load a native module;
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
  const { default: postgres } = await import('postgres');
  const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
  const sql = postgres(url, {
    // Supabase's pooler runs in transaction mode, which cannot keep prepared statements between queries.
    prepare: false,
    ssl: local ? false : 'require',
    // A few connections per serverless instance: the pooler is what fans many instances into the database.
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    // The idempotent schema script prints a harmless "already exists, skipping" notice for every table; keep logs clean.
    onnotice: () => {},
  });
  type Unsafe = { unsafe: (query: string, params?: never[]) => Promise<unknown[] & { count: number }> };
  const runner =
    (q: Unsafe): Runner =>
    async (query, args) => {
      const r = await q.unsafe(query, args as never[]);
      return { rows: [...r] as Row[], rowsAffected: r.count ?? 0 };
    };
  return makeDb(
    runner(sql as unknown as Unsafe),
    (fn) => sql.begin((t) => fn(runner(t as unknown as Unsafe))) as Promise<never>,
    () => sql.end({ timeout: 5 }),
  );
}

export async function createDb(url = config.databaseUrl): Promise<Db> {
  if (url.startsWith('pglite:')) return pgliteDb(url);
  if (/^postgres(ql)?:\/\//.test(url)) return postgresDb(url);
  throw new Error('DATABASE_URL must start with postgres:// (Supabase) or pglite: (local). See .env.example.');
}

/** True for PostgreSQL unique-constraint failures (SQLSTATE 23505). */
export const isUniqueViolation = (e: unknown): boolean =>
  (e as { code?: string } | null)?.code === '23505' || /duplicate key value violates unique constraint/i.test(String(e));
