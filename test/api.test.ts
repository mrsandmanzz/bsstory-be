import { beforeEach, describe, expect, it } from 'vitest';
import { buildContainer } from '../src/container.js';
import { createDb } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';
import { decideAccess } from '../src/domain/access.js';
import type { Book, Subscription } from '../src/domain/types.js';

const OK = '4242 4242 4242 4242';
const card = (number = OK) => ({ number, exp: '12/39', cvc: '123' });

let now = new Date('2026-01-01T00:00:00Z');
let app: ReturnType<typeof createApp>;

async function setup() {
  now = new Date('2026-01-01T00:00:00Z');
  // No launch offer by default, so every price assertion below is about the regular prices.
  const c = buildContainer(await createDb('pglite:memory'), () => now, null);
  await c.bootstrap();
  app = createApp(async () => c);
}
beforeEach(setup);

async function call(method: string, path: string, opts: { token?: string; body?: unknown; key?: string } = {}) {
  const res = await app.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.key ? { 'Idempotency-Key': opts.key } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as any };
}
const login = async (email: string) => (await call('POST', '/v1/auth/login', { body: { email } })).json.token as string;
const paidSlug = 'the-little-red-boat';

describe('access control over HTTP', () => {
  it('guest sees locked books and only the preview pages', async () => {
    const list = await call('GET', '/v1/books');
    const boat = list.json.books.find((b: any) => b.slug === paidSlug);
    expect(boat.access).toMatchObject({ canRead: false, reason: 'locked' });
    const read = await call('GET', `/v1/books/${paidSlug}/read`);
    expect(read.json.locked).toBe(true);
    expect(read.json.pages).toHaveLength(2);
    expect(read.json.totalPages).toBe(6);
  });

  it('free books are readable by guests in full', async () => {
    const read = await call('GET', '/v1/books/moon-wants-a-nap/read');
    expect(read.json.locked).toBe(false);
    expect(read.json.pages).toHaveLength(6);
  });

  it('subscriber reads everything; draft books stay hidden', async () => {
    const token = await login('subscriber@mainstory.test');
    const read = await call('GET', `/v1/books/${paidSlug}/read`, { token });
    expect(read.json.locked).toBe(false);
    expect(read.json.book.access.reason).toBe('subscription');
    expect((await call('GET', '/v1/books/the-brave-mango-draft', { token })).status).toBe(404);
  });

  it('one-time purchase unlocks only that book, and cannot be bought twice', async () => {
    const token = await login('buyer@x.test');
    expect((await call('POST', `/v1/checkout/books/${paidSlug}`, { token, body: { card: card() } })).status).toBe(201);
    expect((await call('GET', `/v1/books/${paidSlug}/read`, { token })).json.locked).toBe(false);
    expect((await call('GET', '/v1/books/bima-and-the-sleepy-dragon/read', { token })).json.locked).toBe(true);
    const again = await call('POST', `/v1/checkout/books/${paidSlug}`, { token, body: { card: card() } });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe('ALREADY_OWNED');
  });

  it('declined card grants nothing; idempotent retry does not double charge', async () => {
    const token = await login('buyer2@x.test');
    const bad = await call('POST', `/v1/checkout/books/${paidSlug}`, { token, body: { card: card('4000 0000 0000 0002') } });
    expect(bad.status).toBe(402);
    expect((await call('GET', `/v1/books/${paidSlug}/read`, { token })).json.locked).toBe(true);

    await call('POST', `/v1/checkout/books/${paidSlug}`, { token, body: { card: card() }, key: 'k1' });
    const retry = await call('POST', `/v1/checkout/books/${paidSlug}`, { token, body: { card: card() }, key: 'k1' });
    expect(retry.status).toBe(201);
    const hist = await call('GET', '/v1/billing/history', { token });
    expect(hist.json.purchases).toHaveLength(1);
    expect(hist.json.payments.filter((p: any) => p.status === 'succeeded')).toHaveLength(1);
  });

  it('purchases survive subscription lapse; cancelled subscription works until period end', async () => {
    const token = await login('lapse@x.test');
    await call('POST', `/v1/checkout/books/${paidSlug}`, { token, body: { card: card() } });
    await call('POST', '/v1/checkout/subscription', { token, body: { planId: 'monthly', card: card() } });
    expect((await call('POST', '/v1/checkout/subscription', { token, body: { planId: 'monthly', card: card() } })).json.error.code).toBe(
      'ALREADY_SUBSCRIBED',
    );

    const cancelled = await call('POST', '/v1/subscription/cancel', { token });
    expect(cancelled.json.subscription.state).toBe('ending');
    expect((await call('GET', '/v1/books/bima-and-the-sleepy-dragon/read', { token })).json.locked).toBe(false);

    now = new Date('2026-03-01T00:00:00Z'); // period over
    expect((await call('GET', '/v1/books/bima-and-the-sleepy-dragon/read', { token })).json.locked).toBe(true);
    expect((await call('GET', `/v1/books/${paidSlug}/read`, { token })).json.locked).toBe(false);
    expect((await call('GET', '/v1/me', { token })).json.subscription.state).toBe('expired');
  });

  it('deleting a sold book archives it: owners keep access, others lose it', async () => {
    const admin = await login('admin@mainstory.test');
    const owner = await login('owner@x.test');
    const other = await login('subscriber@mainstory.test');
    await call('POST', `/v1/checkout/books/${paidSlug}`, { token: owner, body: { card: card() } });
    expect((await call('DELETE', `/v1/books/${paidSlug}`, { token: admin })).json.archived).toBe(true);
    expect((await call('GET', `/v1/books/${paidSlug}/read`, { token: owner })).json.locked).toBe(false);
    expect((await call('GET', `/v1/books/${paidSlug}`, { token: other })).status).toBe(404);
  });
});

describe('book management', () => {
  const valid = {
    title: 'New Tale',
    author: 'A',
    summary: 'S',
    ageMin: 1,
    ageMax: 3,
    price: 10000,
    status: 'published',
    previewPages: 1,
    coverEmoji: '🦊',
    coverFrom: '#FFAA00',
    coverTo: '#FFEE99',
    readingMinutes: 2,
    pages: [{ text: 'Once.', emoji: '🦊' }],
  };

  it('requires admin and validates input', async () => {
    const user = await login('p@x.test');
    expect((await call('POST', '/v1/books', { body: valid })).status).toBe(401);
    expect((await call('POST', '/v1/books', { token: user, body: valid })).status).toBe(403);
    const admin = await login('admin@mainstory.test');
    const bad = await call('POST', '/v1/books', { token: admin, body: { ...valid, price: -5, pages: [] } });
    expect(bad.status).toBe(422);
    expect(bad.json.error.details.length).toBeGreaterThan(0);
  });

  it('supports create → update → delete', async () => {
    const admin = await login('admin@mainstory.test');
    const created = await call('POST', '/v1/books', { token: admin, body: valid });
    expect(created.status).toBe(201);
    const slug = created.json.book.slug;
    const upd = await call('PUT', `/v1/books/${slug}`, { token: admin, body: { ...valid, title: 'New Tale 2', price: 0 } });
    expect(upd.json.book.title).toBe('New Tale 2');
    expect((await call('DELETE', `/v1/books/${slug}`, { token: admin })).json.archived).toBe(false);
    expect((await call('GET', `/v1/books/${slug}`)).status).toBe(404);
  });
});

describe('decideAccess (pure policy)', () => {
  const book = { id: 'b', status: 'published', price: 1000, previewPages: 2 } as Book;
  const sub = (end: string, cancel = false) => ({ currentPeriodEnd: end, cancelAtPeriodEnd: cancel }) as Subscription;
  const user = { id: 'u', role: 'user' } as any;
  const t = new Date('2026-01-01T00:00:00Z');

  it('lapsed subscription grants nothing', () => {
    expect(decideAccess({ book, user, subscription: sub('2025-12-31T00:00:00Z'), owned: false, now: t }).canRead).toBe(false);
  });
  it('owned wins over subscription in the reason shown', () => {
    expect(decideAccess({ book, user, subscription: sub('2026-02-01T00:00:00Z'), owned: true, now: t }).reason).toBe('purchased');
  });
  it('admin cannot purchase', () => {
    expect(decideAccess({ book, user: { ...user, role: 'admin' }, subscription: null, owned: false, now: t }).canPurchase).toBe(false);
  });
});

describe('request validation and hardening', () => {
  it('rejects a bad age filter instead of silently returning nothing', async () => {
    expect((await call('GET', '/v1/books?age=abc')).status).toBe(422);
    const ok = await call('GET', '/v1/books?age=1');
    expect(ok.status).toBe(200);
    expect(ok.json.books.every((b: any) => b.ageMin <= 1 && b.ageMax >= 1)).toBe(true);
  });

  it('requires a token for account endpoints and rejects malformed JSON', async () => {
    expect((await call('GET', '/v1/me')).status).toBe(401);
    const res = await app.request('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
    expect(res.status).toBe(400);
  });

  it('only accepts safe image references', async () => {
    const admin = await login('admin@mainstory.test');
    const base = {
      title: 'Pic',
      author: 'A',
      summary: 'S',
      ageMin: 1,
      ageMax: 3,
      price: 0,
      status: 'draft',
      previewPages: 0,
      coverEmoji: '🦊',
      coverFrom: '#FFAA00',
      coverTo: '#FFEE99',
      readingMinutes: 1,
      pages: [{ text: 'x', emoji: '🦊' }],
    };
    const evil = await call('POST', '/v1/books', { token: admin, body: { ...base, coverUrl: 'javascript:alert(1)' } });
    expect(evil.status).toBe(422);
    expect(evil.json.error.details[0].field).toBe('coverUrl');
    const fine = await call('POST', '/v1/books', {
      token: admin,
      body: {
        ...base,
        coverUrl: '/stories/pic/cover.jpg',
        pages: [{ text: 'x', emoji: '🦊', imageUrl: 'https://cdn.example.com/p1.jpg' }],
      },
    });
    expect(fine.status).toBe(201);
    expect(fine.json.book.coverUrl).toBe('/stories/pic/cover.jpg');
  });

  it('sends security headers', async () => {
    const res = await app.request('/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('subscription renewal', () => {
  it('renews a non-cancelled subscription lazily and records an auto payment without card data', async () => {
    const token = await login('renew@x.test');
    await call('POST', '/v1/checkout/subscription', { token, body: { planId: 'monthly', card: card() } });
    now = new Date('2026-02-05T00:00:00Z'); // 35 days later: first period is over
    const me = await call('GET', '/v1/me', { token });
    expect(me.json.subscription.state).toBe('active');
    const hist = await call('GET', '/v1/billing/history', { token });
    const succeeded = hist.json.payments.filter((p: any) => p.status === 'succeeded');
    expect(succeeded).toHaveLength(2);
    expect(succeeded.some((p: any) => p.last4 === null)).toBe(true);
  });
});

describe('payment safety (regressions from review)', () => {
  const buy = (token: string, slug = paidSlug, key?: string, number?: string) =>
    call('POST', `/v1/checkout/books/${slug}`, { token, body: { card: card(number) }, key });
  const succeeded = async (token: string) =>
    (await call('GET', '/v1/billing/history', { token })).json.payments.filter((p: any) => p.status === 'succeeded');

  it('two concurrent buys of the same book charge exactly once', async () => {
    const token = await login('race@x.test');
    const results = await Promise.all([buy(token), buy(token), buy(token, paidSlug, 'other-key')]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 201).every((r) => r.status === 409)).toBe(true);
    expect(await succeeded(token)).toHaveLength(1);
    expect((await call('GET', '/v1/billing/history', { token })).json.purchases).toHaveLength(1);
  });

  it('lets the user retry with the same idempotency key after a decline', async () => {
    const token = await login('retry@x.test');
    expect((await buy(token, paidSlug, 'same', '4000 0000 0000 0002')).status).toBe(402);
    expect((await buy(token, paidSlug, 'same')).status).toBe(201);
    expect(await succeeded(token)).toHaveLength(1);
  });

  it('refuses to reuse an idempotency key for a different purchase', async () => {
    const token = await login('reuse@x.test');
    await buy(token, paidSlug, 'k');
    const other = await buy(token, 'bima-and-the-sleepy-dragon', 'k');
    expect(other.status).toBe(422);
    expect(other.json.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await call('GET', '/v1/books/bima-and-the-sleepy-dragon/read', { token })).json.locked).toBe(true);
  });

  it('a long lapse renews once from today, and concurrent reads cannot renew twice', async () => {
    const token = await login('lapse90@x.test');
    await call('POST', '/v1/checkout/subscription', { token, body: { planId: 'monthly', card: card() } });
    now = new Date('2026-04-15T00:00:00Z'); // ~3.5 months later
    const reads = await Promise.all([1, 2, 3, 4, 5].map(() => call('GET', '/v1/me', { token })));
    expect(reads.every((r) => r.json.subscription.state === 'active')).toBe(true);
    expect(await succeeded(token)).toHaveLength(2); // original + exactly one renewal
    expect(new Date(reads[0]!.json.subscription.currentPeriodEnd).getTime()).toBeGreaterThan(now.getTime());
    await call('GET', '/v1/me', { token });
    expect(await succeeded(token)).toHaveLength(2);
  });

  it('catalog access agrees with /me: a due renewal applies without calling /me first', async () => {
    const token = await login('norenewcall@x.test');
    await call('POST', '/v1/checkout/subscription', { token, body: { planId: 'monthly', card: card() } });
    now = new Date('2026-02-10T00:00:00Z');
    expect((await call('GET', '/v1/books/bima-and-the-sleepy-dragon/read', { token })).json.locked).toBe(false);
  });

  it('cancelling a lapsed subscription does not charge a renewal first', async () => {
    const token = await login('cancellate@x.test');
    await call('POST', '/v1/checkout/subscription', { token, body: { planId: 'monthly', card: card() } });
    now = new Date('2026-03-01T00:00:00Z');
    expect((await call('POST', '/v1/subscription/cancel', { token })).status).toBe(200);
    expect(await succeeded(token)).toHaveLength(1);
    expect((await call('GET', '/v1/me', { token })).json.subscription.state).toBe('expired');
  });

  it('does not list a purchased book that was pulled back to draft', async () => {
    const admin = await login('admin@mainstory.test');
    const owner = await login('draftowner@x.test');
    await buy(owner);
    const full = (await call('GET', `/v1/admin/books/${paidSlug}`, { token: admin })).json.book;
    const { id: _id, slug: _slug, ...fields } = full;
    await call('PUT', `/v1/books/${paidSlug}`, { token: admin, body: { ...fields, status: 'draft' } });
    const list = await call('GET', '/v1/books', { token: owner });
    expect(list.json.books.some((b: any) => b.slug === paidSlug)).toBe(false);
    expect((await call('GET', `/v1/books/${paidSlug}`, { token: owner })).status).toBe(404);
  });

  it('treats a bad token on a public route as a guest, and rejects protocol-relative image URLs', async () => {
    const res = await call('GET', '/v1/books', { token: 'not-a-real-token' });
    expect(res.status).toBe(200);
    expect((await call('GET', '/v1/me', { token: 'not-a-real-token' })).status).toBe(401);
    const admin = await login('admin@mainstory.test');
    const base = {
      title: 'P',
      author: 'A',
      summary: 'S',
      ageMin: 1,
      ageMax: 3,
      price: 0,
      status: 'draft',
      previewPages: 0,
      coverEmoji: '🦊',
      coverFrom: '#FFAA00',
      coverTo: '#FFEE99',
      readingMinutes: 1,
      pages: [{ text: 'x', emoji: '🦊' }],
    };
    expect((await call('POST', '/v1/books', { token: admin, body: { ...base, coverUrl: '//evil.example/x.png' } })).status).toBe(422);
  });
});

describe('interactive page activities', () => {
  const base = {
    title: 'Play',
    author: 'A',
    summary: 'S',
    ageMin: 1,
    ageMax: 3,
    price: 10000,
    status: 'published',
    previewPages: 1,
    coverEmoji: '🦊',
    coverFrom: '#FFAA00',
    coverTo: '#FFEE99',
    readingMinutes: 1,
  };
  const question = (choices: unknown[]) => ({ prompt: 'Who?', choices });
  const page = (activity: unknown) => ({ text: 'x', emoji: '🦊', activity });
  const good = [
    { emoji: '🦊', label: 'Fox', correct: true },
    { emoji: '🐶', label: 'Dog', correct: false },
  ];

  it('seeds playable books and delivers activities with the pages', async () => {
    const read = await call('GET', '/v1/books/moon-wants-a-nap/read');
    expect(read.json.pages[4].activity.question.choices.filter((c: any) => c.correct)).toHaveLength(1);
    expect(read.json.pages[0].activity.stickers[0]).toMatchObject({ emoji: '⭐', sound: 'Twinkle!' });
    expect(read.json.pages[2].activity).toBeNull();
  });

  it('stores stickers and a question, and returns them to the admin editor', async () => {
    const admin = await login('admin@mainstory.test');
    const activity = { stickers: [{ emoji: '🦊', x: 30, y: 40, sound: 'Yip!', reaction: 'wiggle' }], question: question(good) };
    const made = await call('POST', '/v1/books', { token: admin, body: { ...base, pages: [page(activity)] } });
    expect(made.status).toBe(201);
    expect(made.json.book.pages[0].activity.question.prompt).toBe('Who?');
    expect(made.json.book.pages[0].activity.stickers[0].reaction).toBe('wiggle');
  });

  it('rejects a question without exactly one correct answer, and stickers off the page', async () => {
    const admin = await login('admin@mainstory.test');
    const twoCorrect = good.map((c) => ({ ...c, correct: true }));
    const bad = await call('POST', '/v1/books', { token: admin, body: { ...base, pages: [page({ question: question(twoCorrect) })] } });
    expect(bad.status).toBe(422);
    expect(bad.json.error.details[0].field).toBe('pages.0.activity.question.choices');
    const offPage = await call('POST', '/v1/books', {
      token: admin,
      body: { ...base, pages: [page({ stickers: [{ emoji: '🦊', x: 500, y: 1 }] })] },
    });
    expect(offPage.status).toBe(422);
  });

  it('treats an empty activity as no activity', async () => {
    const admin = await login('admin@mainstory.test');
    const made = await call('POST', '/v1/books', { token: admin, body: { ...base, pages: [page({ stickers: [], question: null })] } });
    expect(made.json.book.pages[0].activity).toBeNull();
  });

  it('never leaks a locked page activity (the answer key rides with the text gate)', async () => {
    const read = await call('GET', `/v1/books/${paidSlug}/read`);
    expect(read.json.locked).toBe(true);
    expect(read.json.pages).toHaveLength(2);
    expect(JSON.stringify(read.json)).not.toContain('"A duckling"');
  });
});

describe('free trial', () => {
  const subscribe = (token: string, planId = 'monthly', number?: string) =>
    call('POST', '/v1/checkout/subscription', { token, body: { planId, card: card(number) } });
  const charges = async (token: string) =>
    (await call('GET', '/v1/billing/history', { token })).json.payments.filter((p: any) => p.status === 'succeeded' && p.amount > 0);

  it('a new account is trial-eligible; subscribing starts a 7-day trial and charges nothing', async () => {
    const token = await login('trial1@x.test');
    expect((await call('GET', '/v1/me', { token })).json).toMatchObject({ trialEligible: true, trialDays: 7 });
    const res = await subscribe(token);
    expect(res.status).toBe(201);
    expect(res.json.subscription).toMatchObject({ trial: true, state: 'active' });
    const days = (Date.parse(res.json.subscription.currentPeriodEnd) - now.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(7, 5);
    expect(await charges(token)).toHaveLength(0);
    expect(res.json.trialEligible).toBe(false);
    expect((await call('GET', '/v1/books/bima-and-the-sleepy-dragon/read', { token })).json.locked).toBe(false);
  });

  it('still verifies the card: a declined card does not start a trial', async () => {
    const token = await login('trial2@x.test');
    expect((await subscribe(token, 'monthly', '4000 0000 0000 0002')).status).toBe(402);
    expect((await call('GET', '/v1/me', { token })).json).toMatchObject({ subscription: null, trialEligible: true });
  });

  it('charges the plan price exactly once when the trial ends, and the subscription becomes a normal one', async () => {
    const token = await login('trial3@x.test');
    await subscribe(token);
    now = new Date('2026-01-09T00:00:00Z'); // 8 days later
    const me = (await call('GET', '/v1/me', { token })).json;
    expect(me.subscription).toMatchObject({ trial: false, state: 'active' });
    const paid = await charges(token);
    expect(paid).toHaveLength(1);
    expect(paid[0].amount).toBe(49_000);
    await call('GET', '/v1/me', { token });
    expect(await charges(token)).toHaveLength(1);
  });

  it('cancelling during the trial keeps access until it ends and never charges', async () => {
    const token = await login('trial4@x.test');
    await subscribe(token);
    const cancelled = await call('POST', '/v1/subscription/cancel', { token });
    expect(cancelled.json.subscription).toMatchObject({ trial: true, state: 'ending' });
    expect((await call('GET', '/v1/books/bima-and-the-sleepy-dragon/read', { token })).json.locked).toBe(false);
    now = new Date('2026-02-01T00:00:00Z');
    expect((await call('GET', '/v1/me', { token })).json.subscription.state).toBe('expired');
    expect(await charges(token)).toHaveLength(0);
  });

  it('gives only one trial per account: resubscribing after it lapsed is charged in full', async () => {
    const token = await login('trial5@x.test');
    await subscribe(token);
    await call('POST', '/v1/subscription/cancel', { token });
    now = new Date('2026-02-01T00:00:00Z');
    const again = await subscribe(token, 'yearly');
    expect(again.status).toBe(201);
    expect(again.json.subscription.trial).toBe(false);
    const paid = await charges(token);
    expect(paid).toHaveLength(1);
    expect(paid[0].amount).toBe(399_000);
  });
});

describe('translations (English and Indonesian)', () => {
  const base = {
    title: 'Tr',
    author: 'A',
    summary: 'S',
    ageMin: 1,
    ageMax: 3,
    price: 0,
    status: 'published',
    previewPages: 1,
    coverEmoji: '🦊',
    coverFrom: '#FFAA00',
    coverTo: '#FFEE99',
    readingMinutes: 1,
  };
  const page = (text: string, id?: string) => ({ text, emoji: '🦊', ...(id ? { i18n: { id: { text: id } } } : {}) });
  const create = async (body: unknown) => call('POST', '/v1/books', { token: await login('admin@mainstory.test'), body });

  it('seeded stories are offered in English and Indonesian, with every page translated', async () => {
    const list = await call('GET', '/v1/books');
    expect(list.json.books.every((b: any) => b.languages.includes('en') && b.languages.includes('id'))).toBe(true);
    const read = await call('GET', '/v1/books/moon-wants-a-nap/read');
    expect(read.json.book.i18n.id.title).toBe('Bulan Mau Tidur');
    expect(read.json.pages[0].i18n.id.text).toContain('Bulan menguap');
    expect(read.json.pages[4].activity.question.i18n.id.prompt).toContain('Suara apa');
    expect(read.json.pages[4].activity.question.choices[0].i18n.id.label).toBe('Syuuu…');
    expect(read.json.pages[0].activity.stickers[0].i18n.id.sound).toBe('Kerlap-kerlip!');
  });

  it('only offers a language when the title and every page are translated', async () => {
    const full = await create({
      ...base,
      i18n: { id: { title: 'Judul', summary: 'Ringkasan' } },
      pages: [page('One', 'Satu'), page('Two', 'Dua')],
    });
    expect(full.status).toBe(201);
    expect(full.json.book.pages[1].i18n.id.text).toBe('Dua');
    const slug = full.json.book.slug;
    expect((await call('GET', `/v1/books/${slug}`)).json.book.languages).toEqual(['en', 'id']);
    const english = await create({ ...base, title: 'Only English', pages: [page('One'), page('Two')] });
    expect((await call('GET', `/v1/books/${english.json.book.slug}`)).json.book.languages).toEqual(['en']);
  });

  it('rejects a half-translated book and points at the missing fields', async () => {
    const missingPage = await create({
      ...base,
      i18n: { id: { title: 'Judul', summary: 'Ringkasan' } },
      pages: [page('One', 'Satu'), page('Two')],
    });
    expect(missingPage.status).toBe(422);
    expect(missingPage.json.error.details.map((d: any) => d.field)).toContain('pages.1.i18n.id.text');
    const missingTitle = await create({ ...base, pages: [page('One', 'Satu')] });
    expect(missingTitle.status).toBe(422);
    expect(missingTitle.json.error.details.map((d: any) => d.field)).toContain('i18n.id.title');
  });

  it('rejects unknown language codes instead of silently dropping them', async () => {
    const bad = await create({ ...base, i18n: { fr: { title: 'Titre', summary: 'Résumé' } }, pages: [page('One')] });
    expect(bad.status).toBe(422);
  });
});

describe('what to read next', () => {
  const next = (slug: string, query = '', token?: string) => call('GET', `/v1/books/${slug}/next${query}`, { token });

  it('suggests other books for the same age first, including locked ones for a guest', async () => {
    const res = await next('moon-wants-a-nap');
    expect(res.status).toBe(200);
    expect(res.json.books).toHaveLength(3);
    expect(res.json.books.every((b: any) => b.slug !== 'moon-wants-a-nap')).toBe(true);
    // Moon is for ages 0-3: books for 2-4 come before books that only start at 3 or later.
    expect(res.json.books[0].ageMin).toBeLessThanOrEqual(3);
    expect(res.json.books.some((b: any) => b.access.canRead === false)).toBe(true); // locked suggestions are kept
  });

  it('never suggests drafts, and skips books the client says were finished', async () => {
    const all = await next('moon-wants-a-nap', '?limit=6');
    expect(all.json.books.some((b: any) => b.slug.includes('draft'))).toBe(false);
    const skipped = await next('moon-wants-a-nap', `?limit=6&exclude=${all.json.books[0].slug}`);
    expect(skipped.json.books.some((b: any) => b.slug === all.json.books[0].slug)).toBe(false);
  });

  it('marks suggestions the user can already read', async () => {
    const token = await login('subscriber@mainstory.test');
    const res = await next('moon-wants-a-nap', '', token);
    expect(res.json.books.every((b: any) => b.access.canRead === true)).toBe(true);
  });

  it('validates its query and hides unavailable books', async () => {
    expect((await next('moon-wants-a-nap', '?limit=99')).status).toBe(422);
    expect((await next('moon-wants-a-nap', '?exclude=Bad Slug!')).status).toBe(422);
    expect((await next('the-brave-mango-draft')).status).toBe(404);
  });
});

describe('launch offer', () => {
  const offer = { percent: 30, endsAt: '2026-01-31T00:00:00.000Z', label: 'Launch offer' };
  beforeEach(async () => {
    now = new Date('2026-01-01T00:00:00Z');
    const c = buildContainer(await createDb('pglite:memory'), () => now, offer);
    await c.bootstrap();
    app = createApp(async () => c);
  });
  const subscribe = (token: string, body: Record<string, unknown> = {}) =>
    call('POST', '/v1/checkout/subscription', { token, body: { planId: 'yearly', card: card(), ...body } });
  const payments = async (token: string) => (await call('GET', '/v1/billing/history', { token })).json.payments as any[];

  it('lists the offer price while it runs, with the server clock and end instant', async () => {
    const { json } = await call('GET', '/v1/plans');
    expect(json.promo).toMatchObject({ percent: 30, endsAt: offer.endsAt });
    expect(json.now).toBe('2026-01-01T00:00:00.000Z');
    expect(json.plans.find((p: any) => p.id === 'yearly')).toMatchObject({ price: 399_000, promoPrice: 279_000 });
    expect(json.plans.find((p: any) => p.id === 'monthly')).toMatchObject({ price: 49_000, promoPrice: 34_000 });
  });

  it('drops the offer the moment it ends', async () => {
    now = new Date(offer.endsAt);
    const { json } = await call('GET', '/v1/plans');
    expect(json.promo).toBeNull();
    expect(json.plans.every((p: any) => p.promoPrice === null)).toBe(true);
  });

  it('locks the discount in for a trial: nothing today, the offer price at the end, even after the offer is over', async () => {
    const token = await login('offer-trial@x.test');
    expect((await subscribe(token, { quotedPrice: 279_000 })).status).toBe(201);
    expect((await payments(token))[0]).toMatchObject({ amount: 0 });
    expect((await call('GET', '/v1/me', { token })).json.subscription).toMatchObject({
      trial: true,
      promoPercent: 30,
      nextAmount: 279_000,
    });

    now = new Date('2026-03-01T00:00:00Z'); // trial over AND offer over
    const me = (await call('GET', '/v1/me', { token })).json;
    const paid = (await payments(token)).filter((p) => p.amount > 0);
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ amount: 279_000, refId: 'yearly' }); // the price promised at signup
    expect(me.subscription).toMatchObject({ trial: false, promoPercent: 0, nextAmount: 399_000 }); // the next renewal is regular price
  });

  it('charges the offer price at once for someone who is not eligible for a trial', async () => {
    const token = await login('offer-returning@x.test');
    await subscribe(token); // trial
    await call('POST', '/v1/subscription/cancel', { token });
    now = new Date('2026-01-10T00:00:00Z'); // trial ended, no renewal because it was cancelled, offer still on
    expect((await call('GET', '/v1/me', { token })).json.subscription.state).toBe('expired');

    expect((await subscribe(token, { quotedPrice: 279_000 })).status).toBe(201);
    expect((await payments(token))[0]).toMatchObject({ amount: 279_000, status: 'succeeded' });
    expect((await call('GET', '/v1/me', { token })).json.subscription).toMatchObject({ promoPercent: 0, nextAmount: 399_000 });
  });

  it('refuses without charging when the price shown is not the price now', async () => {
    const token = await login('offer-stale@x.test');
    const stale = await subscribe(token, { quotedPrice: 399_000 }); // regular price shown, but the offer is running
    expect(stale.status).toBe(409);
    expect(stale.json.error).toMatchObject({ code: 'PRICE_CHANGED', details: { price: 279_000 } });
    expect(await payments(token)).toHaveLength(0);
    expect((await call('GET', '/v1/me', { token })).json.trialEligible).toBe(true); // nothing was used up

    now = new Date('2026-02-01T00:00:00Z'); // the offer ended while the customer was looking at the offer price
    const expired = await subscribe(token, { quotedPrice: 279_000 });
    expect(expired.status).toBe(409);
    expect(expired.json.error.details).toEqual({ price: 399_000 });
    expect(await payments(token)).toHaveLength(0);
  });

  it('still works for clients that send no quoted price', async () => {
    const token = await login('offer-noquote@x.test');
    expect((await subscribe(token)).status).toBe(201);
  });
});
