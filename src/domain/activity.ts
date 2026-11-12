import { z } from 'zod';

/**
 * Interactive layer of a page. Two kinds of play, both tuned for 2-5 year olds:
 * - stickers: small emoji "objects" over the illustration that react when touched (move, make a sound word);
 * - a question: tap one of 2-4 picture answers. There is no failure state, only "try again".
 */
export const REACTIONS = ['wiggle', 'grow', 'spin', 'hop', 'float'] as const;
export type Reaction = (typeof REACTIONS)[number];

const sticker = z.object({
  emoji: z.string().trim().min(1).max(8),
  /** Position over the illustration, in percent from the top-left. Kept off the edges so it is easy to tap. */
  x: z.number().min(5).max(95),
  y: z.number().min(5).max(95),
  /** The sound word shown in a speech bubble, e.g. "Quack!". */
  sound: z.string().trim().max(24).default(''),
  reaction: z.enum(REACTIONS).default('hop'),
});

const choice = z.object({
  emoji: z.string().trim().min(1).max(8),
  label: z.string().trim().min(1).max(24),
  correct: z.boolean(),
});

const question = z
  .object({
    prompt: z.string().trim().min(1).max(120),
    choices: z.array(choice).min(2).max(4),
  })
  .refine((q) => q.choices.filter((c) => c.correct).length === 1, { path: ['choices'], message: 'Mark exactly one correct answer' });

/** Accepts null/undefined/empty and normalises them all to `null`, so "no activity" has one representation. */
export const activitySchema = z
  .object({
    stickers: z.array(sticker).max(4).default([]),
    question: question.nullish().transform((q) => q ?? null),
  })
  .nullish()
  .transform((a) => (a && (a.stickers.length > 0 || a.question) ? { stickers: a.stickers, question: a.question } : null));

export type PageActivity = NonNullable<z.output<typeof activitySchema>>;
export type Sticker = PageActivity['stickers'][number];
export type Question = NonNullable<PageActivity['question']>;

/** Reads a stored JSON column defensively: a corrupt row must not take the whole book down. */
export function parseStoredActivity(raw: unknown): PageActivity | null {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const parsed = activitySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
