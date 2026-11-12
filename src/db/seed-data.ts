import type { PageActivity, Reaction, Sticker } from '../domain/activity.js';
import type { BookInput } from '../services/books.js';

export interface SeedPage {
  text: string;
  emoji: string;
  activity?: PageActivity;
}

/** Seeds carry no image paths; seed.ts derives conventional ones (/stories/<slug>/cover.jpg, p1.jpg, ...). */
export type SeedBook = Omit<BookInput, 'coverUrl' | 'pages'> & { pages: SeedPage[] };

const b = (x: Omit<SeedBook, 'status' | 'previewPages'> & Partial<Pick<SeedBook, 'status' | 'previewPages'>>): SeedBook => ({
  status: 'published',
  previewPages: 2,
  ...x,
});

// Small builders keep the story data readable. Positions are percentages over the illustration.
const tap = (emoji: string, x: number, y: number, sound = '', reaction: Reaction = 'hop'): Sticker => ({ emoji, x, y, sound, reaction });
/** Choices are [emoji, label, correct?]. */
const ask = (prompt: string, ...choices: [string, string, boolean?][]) => ({
  prompt,
  choices: choices.map(([emoji, label, correct]) => ({ emoji, label, correct: correct === true })),
});
const play = (stickers: Sticker[] = [], question: ReturnType<typeof ask> | null = null): PageActivity => ({ stickers, question });

/** Original, short read-aloud stories. Placeholder art is emoji on gradients until real illustrations land. */
export const SEED_BOOKS: SeedBook[] = [
  b({
    title: 'Moon Wants a Nap',
    author: 'Main Story Studio',
    price: 0,
    ageMin: 0,
    ageMax: 3,
    readingMinutes: 2,
    previewPages: 6,
    summary: 'The moon is very, very sleepy. Can the stars help her find a cozy place to rest? A free bedtime read-aloud.',
    coverEmoji: '🌙',
    coverFrom: '#3B3F8F',
    coverTo: '#8E7CF0',
    pages: [
      {
        emoji: '🌙',
        text: 'The moon yawned a big, round yawn. "I am so sleepy," she said.',
        activity: play([tap('⭐', 18, 24, 'Twinkle!', 'float')]),
      },
      {
        emoji: '⭐',
        text: 'A little star twinkled. "Come rest on my bed of light!"',
        activity: play([tap('✨', 78, 28, 'Ting!', 'spin'), tap('⭐', 22, 72, 'Twinkle!', 'float')]),
      },
      { emoji: '☁️', text: 'But the star-bed was too bright. The moon blinked and blinked.' },
      {
        emoji: '🌳',
        text: 'A tall tree waved. "Rest in my branches!" But the leaves went swish, swish, swish.',
        activity: play([tap('🍃', 24, 30, 'Swish!', 'wiggle'), tap('🍃', 76, 62, 'Swish!', 'wiggle')]),
      },
      {
        emoji: '🌊',
        text: 'The sea hummed a slow song. Shhh… shhh… shhh… The moon felt her eyes grow heavy.',
        activity: play([], ask('What sound does the sea make in this story?', ['🌊', 'Shhh…', true], ['🦁', 'Roar!'], ['🔔', 'Ding!'])),
      },
      {
        emoji: '😴',
        text: 'And so the moon slept on the quiet sea. Goodnight, moon. Goodnight, you.',
        activity: play([tap('💤', 50, 24, 'Zzz…', 'float')]),
      },
    ],
  }),
  b({
    title: 'The Little Red Boat',
    author: 'Main Story Studio',
    price: 35_000,
    ageMin: 2,
    ageMax: 4,
    readingMinutes: 4,
    summary: 'A tiny red boat dreams of the open sea, but first she must learn that brave things start small.',
    coverEmoji: '⛵',
    coverFrom: '#FF7A59',
    coverTo: '#FFC46B',
    pages: [
      {
        emoji: '⛵',
        text: 'Down at the busy harbor lived a little red boat named Rosie.',
        activity: play([tap('🐦', 80, 22, 'Squawk!', 'hop')]),
      },
      {
        emoji: '🚢',
        text: 'The big ships sailed far away. "Beep beep!" they said. "Too small for the sea!"',
        activity: play([tap('🚢', 72, 66, 'Beep beep!', 'hop')]),
      },
      {
        emoji: '🌧️',
        text: 'One stormy morning, a tiny duckling got lost in the waves.',
        activity: play([], ask('Who got lost in the waves?', ['🐘', 'An elephant'], ['🦆', 'A duckling', true], ['🐟', 'A fish'])),
      },
      {
        emoji: '🦆',
        text: 'The big ships were too big to reach her. But Rosie was just the right size.',
        activity: play([tap('🦆', 30, 62, 'Quack!', 'hop')]),
      },
      {
        emoji: '🌈',
        text: 'Rosie scooped up the duckling, safe and dry. A rainbow stretched across the sky.',
        activity: play([tap('🌈', 70, 24, 'Wow!', 'grow')]),
      },
      { emoji: '💛', text: 'From that day on, everyone knew: small boats can do big, brave things.' },
    ],
  }),
  b({
    title: 'Bima and the Sleepy Dragon',
    author: 'Main Story Studio',
    price: 39_000,
    ageMin: 3,
    ageMax: 5,
    readingMinutes: 5,
    summary: 'Bima finds a dragon who cannot fall asleep. Together they discover that the best lullaby is a kind friend.',
    coverEmoji: '🐉',
    coverFrom: '#2FA37A',
    coverTo: '#A5E6C0',
    pages: [
      { emoji: '🏔️', text: 'High on a misty mountain, Bima heard a sound: huuuuuh… huuuuuh…' },
      {
        emoji: '🐉',
        text: 'It was a dragon, and he was wide awake! "I can\'t sleep," he sniffled.',
        activity: play([tap('💧', 66, 40, 'Sniff!', 'hop')]),
      },
      {
        emoji: '🔥',
        text: 'Each time he sighed, tiny sparks floated up like fireflies.',
        activity: play([tap('✨', 24, 30, 'Pop!', 'float'), tap('✨', 52, 20, 'Pop!', 'float'), tap('✨', 78, 34, 'Pop!', 'float')]),
      },
      {
        emoji: '📖',
        text: 'Bima counted the sparks. One… two… three… all the way to ten.',
        activity: play([], ask('How many sparks did Bima count?', ['3️⃣', 'Three'], ['🔟', 'Ten', true], ['7️⃣', 'Seven'])),
      },
      {
        emoji: '🎶',
        text: "Then Bima hummed a quiet song. The dragon's big eyes got small.",
        activity: play([tap('🎵', 30, 30, 'La la la…', 'float'), tap('🎶', 74, 54, 'Mmm…', 'float')]),
      },
      {
        emoji: '💤',
        text: 'Zzzz… the dragon slept. And Bima tiptoed home under a sky full of stars.',
        activity: play([tap('💤', 50, 26, 'Zzz…', 'float')]),
      },
    ],
  }),
  b({
    title: 'Counting Fireflies',
    author: 'Main Story Studio',
    price: 29_000,
    ageMin: 2,
    ageMax: 4,
    readingMinutes: 3,
    summary: 'One by one, the fireflies light up the garden. A gentle counting book from one to six.',
    coverEmoji: '✨',
    coverFrom: '#1E2A5A',
    coverTo: '#F2C94C',
    pages: [
      { emoji: '1️⃣', text: 'One firefly wakes up under a leaf. Blink!', activity: play([tap('🪲', 50, 46, 'Blink!', 'grow')]) },
      {
        emoji: '2️⃣',
        text: 'Two fireflies dance by the pond. Blink, blink!',
        activity: play([tap('🪲', 32, 40, 'Blink!', 'grow'), tap('🪲', 68, 56, 'Blink!', 'grow')]),
      },
      {
        emoji: '3️⃣',
        text: 'Three fireflies tickle the tall grass.',
        activity: play([tap('🪲', 25, 34, 'Blink!', 'grow'), tap('🪲', 52, 58, 'Blink!', 'grow'), tap('🪲', 76, 36, 'Blink!', 'grow')]),
      },
      {
        emoji: '4️⃣',
        text: 'Four fireflies zoom around the old oak tree.',
        activity: play([
          tap('🪲', 24, 30, 'Zoom!', 'spin'),
          tap('🪲', 76, 28, 'Zoom!', 'spin'),
          tap('🪲', 30, 70, 'Zoom!', 'spin'),
          tap('🪲', 72, 68, 'Zoom!', 'spin'),
        ]),
      },
      {
        emoji: '5️⃣',
        text: 'Five fireflies make a twinkly circle.',
        activity: play([], ask('How many fireflies make the circle?', ['3️⃣', 'Three'], ['5️⃣', 'Five', true], ['6️⃣', 'Six'])),
      },
      {
        emoji: '6️⃣',
        text: 'Six fireflies, and the whole garden glows. Goodnight, little lights.',
        activity: play([], ask('How many fireflies glow in the garden?', ['4️⃣', 'Four'], ['5️⃣', 'Five'], ['6️⃣', 'Six', true])),
      },
    ],
  }),
  b({
    title: "Mina's Rainy Day Orchestra",
    author: 'Main Story Studio',
    price: 39_000,
    ageMin: 3,
    ageMax: 6,
    readingMinutes: 5,
    summary: 'It is raining and Mina is bored, until the pots, pans and puddles start to play music.',
    coverEmoji: '🥁',
    coverFrom: '#4FA8FF',
    coverTo: '#BFE3FF',
    pages: [
      {
        emoji: '🌧️',
        text: 'Pitter, patter, pitter. Rain again! Mina pressed her nose to the window.',
        activity: play([tap('💧', 28, 26, 'Pitter!', 'hop'), tap('💧', 72, 44, 'Patter!', 'hop')]),
      },
      {
        emoji: '🍳',
        text: 'She tapped a pan. Ting! She tapped a pot. Dong!',
        activity: play([tap('🍳', 30, 58, 'Ting!', 'hop'), tap('🥘', 70, 58, 'Dong!', 'hop')]),
      },
      {
        emoji: '🥄',
        text: 'A wooden spoon went rat-a-tat on the kitchen floor.',
        activity: play([tap('🥄', 50, 60, 'Rat-a-tat!', 'wiggle')]),
      },
      {
        emoji: '🐱',
        text: 'Even the cat joined in: "Meow-ooo!" It was a band!',
        activity: play([], ask('Who joined the band?', ['🐶', 'A dog'], ['🐱', 'A cat', true], ['🐰', 'A rabbit'])),
      },
      {
        emoji: '☔',
        text: 'Outside, the puddles went splash, splash, splish. The rain kept the beat.',
        activity: play([tap('💦', 30, 68, 'Splash!', 'hop'), tap('💦', 70, 68, 'Splish!', 'hop')]),
      },
      {
        emoji: '🎉',
        text: 'Mina took a bow. The best concert ever, and it only needed a rainy day.',
        activity: play([tap('👏', 50, 30, 'Clap clap!', 'grow')]),
      },
    ],
  }),
  b({
    title: 'The Very Shy Cloud',
    author: 'Main Story Studio',
    price: 35_000,
    ageMin: 3,
    ageMax: 5,
    readingMinutes: 4,
    summary: 'Puff is too shy to rain, but a thirsty garden gives him the courage to try.',
    coverEmoji: '☁️',
    coverFrom: '#FF8FB1',
    coverTo: '#FFD6E5',
    pages: [
      { emoji: '☁️', text: 'Puff was a small cloud who was very, very shy.', activity: play([tap('☁️', 50, 28, 'Hello…', 'wiggle')]) },
      {
        emoji: '🌻',
        text: 'Below him, a garden of sunflowers drooped. "We are so thirsty," they sighed.',
        activity: play([tap('🌻', 28, 64, 'Sigh…', 'wiggle'), tap('🌻', 72, 64, 'Sigh…', 'wiggle')]),
      },
      { emoji: '😳', text: '"I can\'t," whispered Puff. "What if everyone looks at me?"' },
      {
        emoji: '🐝',
        text: 'A bee buzzed up. "We\'ll look at the flowers. Not at you."',
        activity: play([tap('🐝', 62, 36, 'Bzzz!', 'float')]),
      },
      {
        emoji: '💧',
        text: 'Puff took a deep breath. Drip… drip… drip-drip-drip!',
        activity: play([tap('💧', 30, 36, 'Drip!', 'hop'), tap('💧', 52, 52, 'Drip!', 'hop'), tap('💧', 74, 38, 'Drip!', 'hop')]),
      },
      {
        emoji: '🌈',
        text: 'The sunflowers stood tall and cheered. Puff smiled, and so did the sky.',
        activity: play([], ask('Who cheered at the end?', ['🦈', 'A shark'], ['🌻', 'The sunflowers', true], ['🚗', 'A car'])),
      },
    ],
  }),
  b({
    title: 'The Brave Mango (draft)',
    author: 'Main Story Studio',
    price: 39_000,
    ageMin: 3,
    ageMax: 5,
    readingMinutes: 4,
    status: 'draft',
    summary: 'Work in progress: a mango learns to leave the tree. Only visible to admins.',
    coverEmoji: '🥭',
    coverFrom: '#FFB020',
    coverTo: '#FFE08A',
    pages: [{ emoji: '🥭', text: 'High in the tree, a little mango held on tight.' }],
  }),
];
