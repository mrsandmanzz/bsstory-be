import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { z, type ZodTypeAny } from 'zod';
import { config } from '../config.js';
import type { Container } from '../container.js';
import { AppError, Errors } from '../domain/errors.js';
import type { User } from '../domain/types.js';
import { TEST_CARDS } from '../payments/mockGateway.js';
import { cardInput } from '../services/billing.js';
import { bookInput } from '../services/books.js';

type Env = { Variables: { c: Container; user: User | null } };

async function parse<T extends ZodTypeAny>(ctx: Context, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await ctx.req.json();
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
  return validate(schema, body);
}

function validate<T extends ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw Errors.validation(r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  return r.data;
}

const nextQuery = z.object({
  limit: z.coerce.number().int().min(1).max(6).default(3),
  /** Comma-separated slugs the reader already finished (kept on their device). */
  exclude: z
    .string()
    .max(600)
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(/^[a-z0-9-]{1,80}$/, 'Invalid slug')).max(30)),
});

const listQuery = z.object({
  search: z.string().trim().max(80).optional(),
  age: z.coerce.number().int().min(0).max(12).optional(),
});

export function createApp(getContainer: () => Promise<Container>) {
  const app = new Hono<Env>();

  app.use('*', secureHeaders());
  app.use(
    '*',
    cors({
      origin: config.allowedOrigins.includes('*') ? '*' : config.allowedOrigins,
      allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );

  // Wire the container, then resolve the (optional) user from the Bearer token.
  app.use('*', async (ctx, next) => {
    const c = await getContainer();
    ctx.set('c', c);
    const header = ctx.req.header('Authorization');
    // A bad or expired token on a public route degrades to "guest"; protected routes still answer 401 via requireUser.
    const user = header?.startsWith('Bearer ') ? await c.auth.authenticate(header.slice(7)).catch(() => null) : null;
    ctx.set('user', user);
    await next();
  });

  const requireUser = (ctx: Context<Env>): User =>
    ctx.get('user') ??
    (() => {
      throw Errors.unauthenticated();
    })();
  const requireAdmin = (ctx: Context<Env>): User => {
    const u = requireUser(ctx);
    if (u.role !== 'admin') throw Errors.forbidden('Admin access required');
    return u;
  };
  const idemKey = (ctx: Context<Env>) => ctx.req.header('Idempotency-Key') || undefined;

  app.get('/', (ctx) => ctx.json({ name: 'MainStory Storybook API', version: 'v1', docs: '/v1/meta', health: '/health' }));
  app.get('/health', (ctx) => ctx.json({ ok: true, time: new Date().toISOString() }));

  /** Machine-readable hints for the demo UI: test cards and demo accounts. */
  app.get('/v1/meta', (ctx) =>
    ctx.json({
      currency: config.currency,
      testCards: TEST_CARDS,
      demoAccounts: ['admin@mainstory.test', 'parent@mainstory.test', 'subscriber@mainstory.test'],
    }),
  );

  // ---- Auth (mocked) ----
  app.post('/v1/auth/login', async (ctx) => {
    const { email, name } = await parse(
      ctx,
      z.object({ email: z.string().trim().email().max(120), name: z.string().trim().max(60).optional() }),
    );
    return ctx.json(await ctx.get('c').auth.login(email, name));
  });
  app.get('/v1/me', async (ctx) => ctx.json(await ctx.get('c').billing.me(requireUser(ctx))));

  // ---- Catalog ----
  app.get('/v1/books', async (ctx) => {
    const query = validate(listQuery, ctx.req.query());
    return ctx.json({ books: await ctx.get('c').books.list(ctx.get('user'), query) });
  });
  /** What to read next, for the end-of-book screen. Includes locked books; the client opens payment when one is tapped. */
  app.get('/v1/books/:key/next', async (ctx) => {
    const { limit, exclude } = validate(nextQuery, ctx.req.query());
    return ctx.json({ books: await ctx.get('c').books.next(ctx.req.param('key'), ctx.get('user'), { limit, exclude }) });
  });
  app.get('/v1/books/:key', async (ctx) => ctx.json({ book: await ctx.get('c').books.get(ctx.req.param('key'), ctx.get('user')) }));
  /** The content gate: returns full pages only if the caller is entitled, else the preview. */
  app.get('/v1/books/:key/read', async (ctx) => ctx.json(await ctx.get('c').books.read(ctx.req.param('key'), ctx.get('user'))));

  // ---- Catalog management (admin) ----
  app.get('/v1/admin/books/:key', async (ctx) => {
    requireAdmin(ctx);
    return ctx.json({ book: await ctx.get('c').books.adminGet(ctx.req.param('key')) });
  });
  app.post('/v1/books', async (ctx) => {
    requireAdmin(ctx);
    return ctx.json({ book: await ctx.get('c').books.create(await parse(ctx, bookInput)) }, 201);
  });
  app.put('/v1/books/:key', async (ctx) => {
    requireAdmin(ctx);
    return ctx.json({ book: await ctx.get('c').books.update(ctx.req.param('key'), await parse(ctx, bookInput)) });
  });
  app.delete('/v1/books/:key', async (ctx) => {
    requireAdmin(ctx);
    return ctx.json(await ctx.get('c').books.remove(ctx.req.param('key')));
  });

  // ---- Billing (mock payments) ----
  app.get('/v1/plans', async (ctx) => ctx.json({ plans: ctx.get('c').billing.plans(), currency: config.currency }));
  app.post('/v1/checkout/subscription', async (ctx) => {
    const user = requireUser(ctx);
    const { planId, card } = await parse(ctx, z.object({ planId: z.string(), card: cardInput }));
    return ctx.json(await ctx.get('c').billing.subscribe(user, planId, card, idemKey(ctx)), 201);
  });
  app.post('/v1/checkout/books/:key', async (ctx) => {
    const user = requireUser(ctx);
    const { card } = await parse(ctx, z.object({ card: cardInput }));
    return ctx.json(await ctx.get('c').billing.buyBook(user, ctx.req.param('key'), card, idemKey(ctx)), 201);
  });
  app.post('/v1/subscription/cancel', async (ctx) => ctx.json(await ctx.get('c').billing.cancel(requireUser(ctx))));
  app.post('/v1/subscription/resume', async (ctx) => ctx.json(await ctx.get('c').billing.resume(requireUser(ctx))));
  app.get('/v1/billing/history', async (ctx) => ctx.json(await ctx.get('c').billing.history(requireUser(ctx))));

  app.notFound((ctx) => ctx.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));
  app.onError((err, ctx) => {
    if (err instanceof AppError) {
      return ctx.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
    }
    console.error(err);
    return ctx.json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side' } }, 500);
  });

  return app;
}
