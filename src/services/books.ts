import { z } from 'zod';
import { activitySchema } from '../domain/activity.js';
import { decideAccess, type AccessDecision } from '../domain/access.js';
import { Errors } from '../domain/errors.js';
import { TRANSLATION_LANGS, bookTranslations, pageTranslations } from '../domain/i18n.js';
import { rankNext } from '../domain/recommend.js';
import { slugify } from '../domain/slug.js';
import type { Book, BookPage, Subscription, User } from '../domain/types.js';
import type { billingRepo } from '../repositories/billing.js';
import type { booksRepo } from '../repositories/books.js';

/** Local path (/stories/..) or https URL only, so admins cannot inject javascript: or data: URLs. */
const imageRef = z
  .string()
  .trim()
  .max(300)
  .regex(/^(\/(?!\/)[\w\-./]+|https:\/\/[^\s]+)$/, 'Use a path like /stories/x/cover.jpg or an https:// URL')
  .nullish()
  .transform((v) => v || null);

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #FFB84D');

export const bookInput = z
  .object({
    title: z.string().trim().min(1).max(120),
    author: z.string().trim().min(1).max(80),
    summary: z.string().trim().min(1).max(600),
    ageMin: z.number().int().min(0).max(12),
    ageMax: z.number().int().min(0).max(12),
    price: z.number().int().min(0).max(10_000_000),
    status: z.enum(['draft', 'published', 'archived']),
    previewPages: z.number().int().min(0).max(10),
    coverEmoji: z.string().trim().min(1).max(8),
    coverUrl: imageRef,
    coverFrom: hex,
    coverTo: hex,
    readingMinutes: z.number().int().min(1).max(60),
    i18n: bookTranslations,
    pages: z
      .array(
        z.object({
          text: z.string().trim().min(1).max(500),
          emoji: z.string().trim().min(1).max(8),
          imageUrl: imageRef,
          activity: activitySchema,
          i18n: pageTranslations,
        }),
      )
      .max(40),
  })
  .refine((b) => b.ageMin <= b.ageMax, { path: ['ageMax'], message: 'Max age must be ≥ min age' })
  .refine((b) => b.status !== 'published' || b.pages.length > 0, { path: ['pages'], message: 'Add at least one page before publishing' })
  .refine((b) => b.previewPages <= b.pages.length, { path: ['previewPages'], message: 'Preview pages cannot exceed total pages' })
  // A language is all-or-nothing: either the title, summary and EVERY page are translated, or none are. This is what
  // lets the app offer a language without ever showing a half-translated book.
  .superRefine((b, ctx) => {
    for (const lang of TRANSLATION_LANGS) {
      const titled = Boolean(b.i18n[lang]);
      const translatedPages = b.pages.filter((p) => p.i18n[lang]?.text).length;
      if (!titled && translatedPages === 0) continue;
      if (!titled)
        ctx.addIssue({
          code: 'custom',
          path: ['i18n', lang, 'title'],
          message: `Add the ${lang.toUpperCase()} title and summary, or remove the page translations`,
        });
      b.pages.forEach((p, i) => {
        if (!p.i18n[lang]?.text)
          ctx.addIssue({ code: 'custom', path: ['pages', i, 'i18n', lang, 'text'], message: `This page needs ${lang.toUpperCase()} text` });
      });
    }
  });

export type BookInput = z.infer<typeof bookInput>;
export type BookView = Book & { access: AccessDecision };

/** Resolves a user's subscription (renewing it if due), so catalog access agrees with what `/me` reports. */
export type SubscriptionLookup = (userId: string) => Promise<Subscription | null>;

export const booksService = (
  books: ReturnType<typeof booksRepo>,
  billing: ReturnType<typeof billingRepo>,
  subscriptionOf: SubscriptionLookup,
  clock: () => Date,
) => {
  const isStaff = (u: User | null) => u?.role === 'admin';

  async function context(user: User | null) {
    const [subscription, purchases] = user ? await Promise.all([subscriptionOf(user.id), billing.purchasesOf(user.id)]) : [null, []];
    return { subscription, owned: new Set(purchases.map((p) => p.bookId)) };
  }

  const view = (book: Book, user: User | null, ctx: Awaited<ReturnType<typeof context>>): BookView => ({
    ...book,
    access: decideAccess({ book, user, subscription: ctx.subscription, owned: ctx.owned.has(book.id), now: clock() }),
  });

  /** Drafts/archived books the user cannot see behave exactly like missing ones (no information leak). */
  async function getVisible(key: string, user: User | null) {
    const book = await books.findByIdOrSlug(key);
    if (!book) throw Errors.notFound('Book');
    const ctx = await context(user);
    const v = view(book, user, ctx);
    if (v.access.reason === 'unavailable') throw Errors.notFound('Book');
    return v;
  }

  return {
    async list(user: User | null, q: { search?: string; age?: number }): Promise<BookView[]> {
      const ctx = await context(user);
      const all = await books.list({ includeAll: isStaff(user), ids: [...ctx.owned] });
      const term = q.search?.trim().toLowerCase();
      return (
        all
          .filter((b) => !term || `${b.title} ${b.author} ${b.summary}`.toLowerCase().includes(term))
          .filter((b) => q.age === undefined || (b.ageMin <= q.age && q.age <= b.ageMax))
          .map((b) => view(b, user, ctx))
          // e.g. a book the user bought that was later pulled back to draft: hidden here exactly as `get` hides it.
          .filter((b) => b.access.reason !== 'unavailable')
      );
    },

    get: getVisible,

    /**
     * Suggestions for what to read after `key`. Locked books are included on purpose: the app shows them with a lock
     * and opens the payment pop-up on tap. `exclude` lets the client skip books this reader already finished.
     */
    async next(key: string, user: User | null, opts: { limit: number; exclude: readonly string[] }): Promise<BookView[]> {
      const current = await getVisible(key, user);
      const ctx = await context(user);
      const skip = new Set(opts.exclude);
      const all = await books.list({ includeAll: isStaff(user), ids: [...ctx.owned] });
      const candidates = all
        .filter((b) => b.id !== current.id && !skip.has(b.slug))
        .map((b) => view(b, user, ctx))
        .filter((b) => b.access.reason !== 'unavailable' && b.status === 'published');
      return rankNext(current, candidates).slice(0, opts.limit);
    },

    /** The content gate. Full text is only ever returned when decideAccess says canRead. */
    async read(key: string, user: User | null): Promise<{ book: BookView; pages: BookPage[]; locked: boolean; totalPages: number }> {
      const book = await getVisible(key, user);
      const locked = !book.access.canRead;
      const pages = await books.pages(book.id, locked ? book.access.previewPages : undefined);
      return { book, pages, locked, totalPages: book.pageCount };
    },

    async adminGet(key: string) {
      const book = await books.findByIdOrSlug(key);
      if (!book) throw Errors.notFound('Book');
      return { ...book, pages: await books.pages(book.id) };
    },

    async create(input: BookInput) {
      const slug = await uniqueSlug(input.title);
      const id = crypto.randomUUID();
      const { pages, ...fields } = input;
      await books.save({ id, slug, ...fields }, pages, clock().toISOString(), true);
      return this.adminGet(id);
    },

    async update(key: string, input: BookInput) {
      const existing = await books.findByIdOrSlug(key);
      if (!existing) throw Errors.notFound('Book');
      const { pages, ...fields } = input;
      await books.save({ id: existing.id, slug: existing.slug, ...fields }, pages, clock().toISOString(), false);
      return this.adminGet(existing.id);
    },

    /**
     * Books people have paid for are archived, never destroyed: customers keep what they bought.
     * Books with no purchases are removed for real.
     */
    async remove(key: string): Promise<{ archived: boolean }> {
      const existing = await books.findByIdOrSlug(key);
      if (!existing) throw Errors.notFound('Book');
      if (await books.hasPurchases(existing.id)) {
        const pages = await books.pages(existing.id);
        const { pageCount: _pc, languages: _l, createdAt: _c, updatedAt: _u, ...rest } = existing;
        await books.save({ ...rest, status: 'archived' }, pages, clock().toISOString(), false);
        return { archived: true };
      }
      await books.remove(existing.id);
      return { archived: false };
    },
  };

  async function uniqueSlug(title: string) {
    const base = slugify(title);
    let slug = base;
    for (let i = 2; await books.slugTaken(slug); i++) slug = `${base}-${i}`;
    return slug;
  }
};
