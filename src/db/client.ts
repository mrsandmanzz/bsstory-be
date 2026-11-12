import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Client } from '@libsql/client';
import { config } from '../config.js';

export type Db = Client;

/**
 * A libSQL client. Local development and tests use a SQLite file through the Node build, which needs a native
 * module. A remote database (Turso, `libsql://` or `https://`) uses the fetch-only `/web` build instead, which has
 * no native dependency, so a serverless function never has to load one.
 * The imports are dynamic so the unused build is never loaded.
 */
export async function createDb(url = config.databaseUrl, authToken = config.databaseAuthToken): Promise<Db> {
  if (url.startsWith('file:')) {
    if (!url.includes(':memory:')) mkdirSync(dirname(url.replace('file:', '')), { recursive: true });
    const { createClient } = await import('@libsql/client');
    return createClient({ url, authToken });
  }
  const { createClient } = await import('@libsql/client/web');
  return createClient({ url, authToken });
}

/** True for SQLite UNIQUE constraint failures (libSQL surfaces them as errors with this message). */
export const isUniqueViolation = (e: unknown): boolean => /UNIQUE constraint failed/i.test(String(e));
