#!/usr/bin/env node
/**
 * Post-deploy smoke test for the MainStory API.
 *
 *   npm run smoke -- https://your-api.vercel.app --origin https://your-web.vercel.app
 *   npm run smoke -- http://localhost:8788 --write
 *
 * By default it only READS (nothing is created). With --write it also signs up a throwaway account, starts the
 * free trial with the demo test card and cancels it, which proves the database accepts writes.
 */
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? 'http://localhost:8787').replace(/\/$/, '');
const flag = (name) => args.includes(name);
const origin = args[args.indexOf('--origin') + 1]?.startsWith('http') ? args[args.indexOf('--origin') + 1] : null;
const write = flag('--write');

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? '' });
  } catch (e) {
    results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { res, json, text };
}

console.log(`Smoke test against ${base}${write ? ' (with writes)' : ' (read-only)'}\n`);

await check('GET /health', async () => {
  const { res, json } = await call('GET', '/health');
  assert(res.status === 200 && json?.ok === true, `status ${res.status}`);
});

let books = [];
await check('GET /v1/books returns a catalog (DB reachable and seeded)', async () => {
  const { res, json } = await call('GET', '/v1/books');
  assert(res.status === 200, `status ${res.status}: ${JSON.stringify(json)?.slice(0, 160)}`);
  books = json.books;
  assert(books.length > 0, 'empty catalog: set AUTO_SEED=true or run the seed once');
  return `${books.length} books`;
});

await check('Drafts are never listed to guests', async () => {
  assert(
    books.every((b) => b.status === 'published'),
    'a non-published book is visible to guests',
  );
});

await check('A free book reads in full for a guest', async () => {
  const free = books.find((b) => b.price === 0);
  assert(free, 'no free book in the catalog');
  const { json } = await call('GET', `/v1/books/${free.slug}/read`);
  assert(json.locked === false && json.pages.length === free.pageCount, 'free book is not fully readable');
});

await check('A paid book is gated: guests get only the preview pages', async () => {
  const paid = books.find((b) => b.price > 0);
  assert(paid, 'no paid book in the catalog');
  const { json } = await call('GET', `/v1/books/${paid.slug}/read`);
  assert(json.locked === true, 'paid book is not locked for a guest');
  assert(json.pages.length <= paid.previewPages, `${json.pages.length} pages leaked (preview is ${paid.previewPages})`);
});

await check('GET /v1/plans lists monthly and yearly', async () => {
  const { json } = await call('GET', '/v1/plans');
  const ids = json.plans.map((p) => p.id);
  assert(ids.includes('monthly') && ids.includes('yearly'), `plans: ${ids}`);
});

await check('Protected routes answer 401 without a token', async () => {
  assert((await call('GET', '/v1/me')).res.status === 401, 'expected 401');
});

await check('Admin routes refuse guests', async () => {
  assert((await call('POST', '/v1/books', { body: {} })).res.status === 401, 'expected 401');
});

await check('Security headers are present', async () => {
  const { res } = await call('GET', '/health');
  assert(res.headers.get('x-content-type-options') === 'nosniff', 'missing x-content-type-options');
});

if (origin) {
  await check(`CORS allows the web origin ${origin}`, async () => {
    const { res } = await call('OPTIONS', '/v1/books', {
      headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
    });
    const allowed = res.headers.get('access-control-allow-origin');
    assert(allowed === origin || allowed === '*', `access-control-allow-origin was "${allowed}"`);
    return allowed === '*' ? 'wildcard: set ALLOWED_ORIGINS to the web URL for production' : 'exact origin';
  });
}

if (write) {
  const email = `smoke-${Date.now()}@example.test`;
  let token = '';
  await check('WRITE: sign up a throwaway account', async () => {
    const { res, json } = await call('POST', '/v1/auth/login', { body: { email } });
    assert(res.status === 200 && json.token, `status ${res.status}`);
    token = json.token;
    assert(json.user.role === 'user', 'throwaway account became admin: check ADMIN_EMAILS');
  });
  await check('WRITE: start the free trial with the demo test card', async () => {
    const { res, json } = await call('POST', '/v1/checkout/subscription', {
      token,
      body: { planId: 'monthly', card: { number: '4242 4242 4242 4242', exp: '12/39', cvc: '123' } },
    });
    assert(res.status === 201, `status ${res.status}: ${JSON.stringify(json)?.slice(0, 160)}`);
    assert(json.subscription.trial === true, 'subscription is not a trial');
  });
  await check('WRITE: a paid book is now readable in full', async () => {
    const paid = books.find((b) => b.price > 0);
    const { json } = await call('GET', `/v1/books/${paid.slug}/read`, { token });
    assert(json.locked === false, 'still locked after subscribing');
  });
  await check('WRITE: cancel the trial (no charge)', async () => {
    const { res, json } = await call('POST', '/v1/subscription/cancel', { token });
    assert(res.status === 200 && json.subscription.state === 'ending', 'cancel failed');
  });
}

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
