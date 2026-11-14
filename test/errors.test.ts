import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContainer, type Container } from '../src/container.js';
import { createDb, isDatabaseUnavailable } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';

let c: Container;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  c = buildContainer(await createDb('pglite:memory'), () => new Date('2026-01-01T00:00:00Z'), null);
  await c.bootstrap();
  app = createApp(async () => c);
});

type Body = { error: { code: string; message: string; details?: unknown; requestId?: string } };
async function call(method: string, path: string, opts: { token?: string; body?: string; headers?: Record<string, string> } = {}) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
    body: opts.body,
  });
  const text = await res.text();
  return { res, status: res.status, text, json: (text ? JSON.parse(text) : null) as Body };
}
async function login(email: string): Promise<string> {
  const r = await call('POST', '/v1/auth/login', { body: JSON.stringify({ email }) });
  return (r.json as unknown as { token: string }).token;
}
const validBook = {
  title: 'Race Book',
  author: 'Me',
  summary: 'Two admins save at once.',
  ageMin: 0,
  ageMax: 3,
  price: 0,
  status: 'draft',
  previewPages: 0,
  coverEmoji: '📖',
  coverUrl: null,
  coverFrom: '#FFB84D',
  coverTo: '#FF8A5C',
  readingMinutes: 2,
  i18n: {},
  pages: [{ text: 'One page', emoji: '✨', imageUrl: null, activity: null, i18n: {} }],
};

describe('requests the API cannot accept', () => {
  it('answers 400 INVALID_JSON for a body that is not JSON', async () => {
    const r = await call('POST', '/v1/auth/login', { body: '{not json' });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('INVALID_JSON');
  });

  it('answers 422 VALIDATION_FAILED with the field names', async () => {
    const r = await call('POST', '/v1/auth/login', { body: JSON.stringify({}) });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(r.json.error.details)).toContain('email');
  });

  it('answers 413 PAYLOAD_TOO_LARGE for a huge JSON body, before reading it', async () => {
    const r = await call('POST', '/v1/auth/login', { body: JSON.stringify({ email: 'a@b.test', pad: 'x'.repeat(600_000) }) });
    expect(r.status).toBe(413);
    expect(r.json.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('answers 404 NOT_FOUND for an unknown route and for a known path with the wrong method', async () => {
    const unknown = await call('GET', '/v1/nope');
    expect(unknown.status).toBe(404);
    expect(unknown.json.error.code).toBe('NOT_FOUND');
    const wrongMethod = await call('PATCH', '/v1/books');
    expect(wrongMethod.status).toBe(404);
    expect(wrongMethod.json.error.code).toBe('NOT_FOUND');
  });

  it('answers 404 for a missing book, and for a draft when the caller is not an admin', async () => {
    expect((await call('GET', '/v1/books/does-not-exist')).status).toBe(404);
    const admin = await login('admin@mainstory.test');
    const made = await call('POST', '/v1/books', { token: admin, body: JSON.stringify(validBook) });
    expect(made.status).toBe(201);
    const slug = (made.json as unknown as { book: { slug: string } }).book.slug;
    expect((await call('GET', `/v1/books/${slug}`)).status).toBe(404);
    expect((await call('GET', `/v1/books/${slug}`, { token: admin })).status).toBe(200);
  });
});

describe('who is asking', () => {
  it('answers 401 UNAUTHENTICATED without a token and with a bad one on a protected route', async () => {
    expect((await call('GET', '/v1/me')).json.error.code).toBe('UNAUTHENTICATED');
    const bad = await call('GET', '/v1/me', { token: 'garbage' });
    expect(bad.status).toBe(401);
    expect(bad.json.error.code).toBe('UNAUTHENTICATED');
  });

  it('treats a bad token on a public route as a guest instead of failing', async () => {
    const r = await call('GET', '/v1/books', { token: 'garbage' });
    expect(r.status).toBe(200);
  });

  it('answers 403 FORBIDDEN when a normal user calls an admin route', async () => {
    const parent = await login('parent@mainstory.test');
    for (const [method, path] of [
      ['POST', '/v1/books'],
      ['DELETE', '/v1/books/the-little-red-boat'],
      ['POST', '/v1/admin/images'],
    ] as const) {
      const r = await call(method, path, { token: parent, body: method === 'POST' ? '{}' : undefined });
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.json.error.code).toBe('FORBIDDEN');
    }
  });
});

describe('two requests at the same moment', () => {
  it('never answers 500 when two admins save a book with the same title together', async () => {
    const admin = await login('admin@mainstory.test');
    const results = await Promise.all(
      Array.from({ length: 4 }, () => call('POST', '/v1/books', { token: admin, body: JSON.stringify(validBook) })),
    );
    for (const r of results) expect([201, 409]).toContain(r.status);
    expect(results.some((r) => r.status === 201)).toBe(true);
  });
});

describe('unexpected failures', () => {
  const boom = () => {
    throw new Error('secret internal detail: table users column x');
  };
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('answers 500 INTERNAL with a request id, and never leaks the cause', async () => {
    c.books.list = boom as never;
    const r = await call('GET', '/v1/books');
    expect(r.status).toBe(500);
    expect(r.json.error.code).toBe('INTERNAL');
    expect(r.json.error.requestId).toBe(r.res.headers.get('X-Request-Id'));
    expect(r.text).not.toContain('secret internal detail');
    expect(r.text).not.toContain('stack');
    // the real cause is logged with the same id so support can find it
    const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(logged).toContain(r.json.error.requestId as string);
  });

  it('answers 503 SERVICE_UNAVAILABLE with Retry-After when the database cannot be reached', async () => {
    c.books.list = (() => {
      throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:6543'), { code: 'ECONNREFUSED' });
    }) as never;
    const r = await call('GET', '/v1/books');
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(r.res.headers.get('Retry-After')).toBe('5');
    expect(r.text).not.toContain('10.0.0.1');
  });

  it('answers 503 when the database cannot even be opened on a cold start', async () => {
    const broken = createApp(async () => {
      throw Object.assign(new Error('password authentication failed for user "postgres"'), { code: '28P01' });
    });
    const res = await broken.request('/v1/books');
    expect(res.status).toBe(503);
    expect(((await res.json()) as Body).error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('answers 409 CONFLICT when a database unique rule stops a racing write', async () => {
    c.books.list = (() => {
      throw Object.assign(new Error('duplicate key value violates unique constraint "x"'), { code: '23505' });
    }) as never;
    const r = await call('GET', '/v1/books');
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('CONFLICT');
  });

  it('keeps the CORS headers on error responses, so the web app can read them', async () => {
    c.books.list = boom as never;
    const r = await call('GET', '/v1/books', { headers: { Origin: 'https://web.example' } });
    expect(r.status).toBe(500);
    expect(r.res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    expect(r.res.headers.get('Access-Control-Expose-Headers')).toContain('X-Request-Id');
  });
});

describe('browser preflight', () => {
  it('answers OPTIONS with 204 and allows the headers the web app sends', async () => {
    const res = await app.request('/v1/checkout/books/x', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://web.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'idempotency-key,authorization,content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain('idempotency-key');
  });
});

describe('classifying database failures', () => {
  it('treats connection problems as unavailable and ordinary errors as not', () => {
    expect(isDatabaseUnavailable(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error('x'), { code: '08006' }))).toBe(true);
    expect(isDatabaseUnavailable(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isDatabaseUnavailable(new Error('Tenant or user not found'))).toBe(true);
    expect(isDatabaseUnavailable(new Error('null value in column "title"'))).toBe(false);
    expect(isDatabaseUnavailable(null)).toBe(false);
  });
});
