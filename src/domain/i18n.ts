import { z } from 'zod';

/**
 * Languages. English is the default and lives in the plain fields (`title`, `text`, ...). Every other language is
 * an optional translation stored next to it under `i18n`, so adding a language never changes the shape of a book.
 */
export const DEFAULT_LANG = 'en';
export const TRANSLATION_LANGS = ['id'] as const;
export type TranslationLang = (typeof TRANSLATION_LANGS)[number];
export type Lang = typeof DEFAULT_LANG | TranslationLang;
export const ALL_LANGS: readonly Lang[] = [DEFAULT_LANG, ...TRANSLATION_LANGS];

export type Translations<T> = Partial<Record<TranslationLang, T>>;

/**
 * Optional translations for one object. `.strict()` rejects unknown language keys (including the default language,
 * which must use the plain field), so a typo like "ind" is a validation error instead of silently lost text.
 * Missing means "no translation": consumers fall back to the default language.
 */
export const translations = <T extends z.ZodTypeAny>(shape: T) =>
  z
    .object({ id: shape.optional() })
    .strict()
    .optional()
    .transform((v) => (v ?? {}) as Translations<z.output<T>>);

export const bookTranslations = translations(
  z.object({ title: z.string().trim().min(1).max(120), summary: z.string().trim().min(1).max(600) }),
);
export const pageTranslations = translations(z.object({ text: z.string().trim().min(1).max(500) }));

/** Reads a stored JSON column defensively: a corrupt row must not take the whole book down. */
export function parseStoredJson<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.output<T> {
  const empty = schema.parse(undefined);
  if (typeof raw !== 'string' || raw === '') return empty;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : empty;
  } catch {
    return empty;
  }
}

export type BookTranslations = z.output<typeof bookTranslations>;
export type PageTranslations = z.output<typeof pageTranslations>;
