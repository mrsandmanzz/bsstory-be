import type { Db } from '../db/client.js';
import { parseStoredActivity } from '../domain/activity.js';
import { DEFAULT_LANG, TRANSLATION_LANGS, bookTranslations, pageTranslations, parseStoredJson } from '../domain/i18n.js';
import type { Book, BookPage, BookStatus } from '../domain/types.js';

/** One subselect per translation language: how many of the book's pages have text in it. Constants only, never user input. */
const TRANSLATED_PAGE_COUNTS = TRANSLATION_LANGS.map(
  (l) => `(SELECT COUNT(*) FROM book_pages p WHERE p.book_id = b.id AND (p.i18n::jsonb -> '${l}' ->> 'text') IS NOT NULL) AS tr_${l}`,
).join(', ');

const BOOK_SELECT = `SELECT b.*, (SELECT COUNT(*) FROM book_pages p WHERE p.book_id = b.id) AS page_count, ${TRANSLATED_PAGE_COUNTS} FROM books b`;

const map = (r: Record<string, unknown>): Book => {
  const i18n = parseStoredJson(bookTranslations, r.i18n);
  const pageCount = Number(r.page_count ?? 0);
  return {
    id: String(r.id),
    slug: String(r.slug),
    title: String(r.title),
    author: String(r.author),
    summary: String(r.summary),
    ageMin: Number(r.age_min),
    ageMax: Number(r.age_max),
    price: Number(r.price),
    status: r.status as BookStatus,
    previewPages: Number(r.preview_pages),
    coverEmoji: String(r.cover_emoji),
    coverUrl: (r.cover_url as string | null) ?? null,
    coverFrom: String(r.cover_from),
    coverTo: String(r.cover_to),
    readingMinutes: Number(r.reading_minutes),
    pageCount,
    i18n,
    // A language is offered only when the title AND every page are translated, so a reader never lands on a half-translated book.
    languages: [DEFAULT_LANG, ...TRANSLATION_LANGS.filter((l) => i18n[l] && pageCount > 0 && Number(r[`tr_${l}`]) === pageCount)],
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
};

export type BookWrite = Omit<Book, 'pageCount' | 'languages' | 'createdAt' | 'updatedAt'>;

export const booksRepo = (db: Db) => ({
  async list(opts: { includeAll: boolean; ids?: string[] }): Promise<Book[]> {
    // Staff see everything; everyone else sees published books plus archived books they own.
    const r = opts.includeAll
      ? await db.execute(`${BOOK_SELECT} ORDER BY b.created_at DESC`)
      : await db.execute({
          sql: `${BOOK_SELECT} WHERE b.status = 'published'
                ${opts.ids?.length ? `OR b.id IN (${opts.ids.map(() => '?').join(',')})` : ''}
                ORDER BY b.created_at DESC`,
          args: opts.ids ?? [],
        });
    return r.rows.map(map);
  },
  async findByIdOrSlug(key: string): Promise<Book | null> {
    const r = await db.execute({ sql: `${BOOK_SELECT} WHERE b.id = ? OR b.slug = ?`, args: [key, key] });
    return r.rows[0] ? map(r.rows[0]) : null;
  },
  async pages(bookId: string, maxPosition?: number): Promise<BookPage[]> {
    const r = await db.execute({
      sql: `SELECT position, text, emoji, image_url, activity, i18n FROM book_pages WHERE book_id = ? ${maxPosition !== undefined ? 'AND position <= ?' : ''} ORDER BY position`,
      args: maxPosition !== undefined ? [bookId, maxPosition] : [bookId],
    });
    return r.rows.map((p) => ({
      position: Number(p.position),
      text: String(p.text),
      emoji: String(p.emoji),
      imageUrl: (p.image_url as string | null) ?? null,
      i18n: parseStoredJson(pageTranslations, p.i18n),
      activity: parseStoredActivity(p.activity),
    }));
  },
  async slugTaken(slug: string, exceptId?: string): Promise<boolean> {
    const r = await db.execute({ sql: 'SELECT id FROM books WHERE slug = ? AND id != ?', args: [slug, exceptId ?? ''] });
    return r.rows.length > 0;
  },
  async count(): Promise<number> {
    const r = await db.execute('SELECT COUNT(*) AS n FROM books');
    return Number(r.rows[0]?.n ?? 0);
  },
  /** Insert or fully replace a book and its pages atomically. */
  async save(b: BookWrite, pages: Omit<BookPage, 'position'>[], now: string, isNew: boolean): Promise<void> {
    const i18n = Object.keys(b.i18n).length > 0 ? JSON.stringify(b.i18n) : null;
    const stmts = [
      isNew
        ? {
            sql: `INSERT INTO books (id,slug,title,author,summary,age_min,age_max,price,status,preview_pages,cover_emoji,cover_url,cover_from,cover_to,reading_minutes,i18n,created_at,updated_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            args: [
              b.id,
              b.slug,
              b.title,
              b.author,
              b.summary,
              b.ageMin,
              b.ageMax,
              b.price,
              b.status,
              b.previewPages,
              b.coverEmoji,
              b.coverUrl,
              b.coverFrom,
              b.coverTo,
              b.readingMinutes,
              i18n,
              now,
              now,
            ],
          }
        : {
            sql: `UPDATE books SET slug=?,title=?,author=?,summary=?,age_min=?,age_max=?,price=?,status=?,preview_pages=?,cover_emoji=?,cover_url=?,cover_from=?,cover_to=?,reading_minutes=?,i18n=?,updated_at=? WHERE id=?`,
            args: [
              b.slug,
              b.title,
              b.author,
              b.summary,
              b.ageMin,
              b.ageMax,
              b.price,
              b.status,
              b.previewPages,
              b.coverEmoji,
              b.coverUrl,
              b.coverFrom,
              b.coverTo,
              b.readingMinutes,
              i18n,
              now,
              b.id,
            ],
          },
      { sql: 'DELETE FROM book_pages WHERE book_id = ?', args: [b.id] },
      ...pages.map((p, i) => ({
        sql: 'INSERT INTO book_pages (book_id,position,text,emoji,image_url,activity,i18n) VALUES (?,?,?,?,?,?,?)',
        args: [
          b.id,
          i + 1,
          p.text,
          p.emoji,
          p.imageUrl,
          p.activity ? JSON.stringify(p.activity) : null,
          Object.keys(p.i18n).length > 0 ? JSON.stringify(p.i18n) : null,
        ],
      })),
    ];
    await db.batch(stmts, 'write');
  },
  async hasPurchases(bookId: string): Promise<boolean> {
    const r = await db.execute({ sql: 'SELECT 1 FROM purchases WHERE book_id = ? LIMIT 1', args: [bookId] });
    return r.rows.length > 0;
  },
  async remove(id: string): Promise<void> {
    await db.batch(
      [
        { sql: 'DELETE FROM book_pages WHERE book_id = ?', args: [id] },
        { sql: 'DELETE FROM books WHERE id = ?', args: [id] },
      ],
      'write',
    );
  },
});
