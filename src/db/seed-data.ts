import type { PageActivity, Reaction, Sticker } from '../domain/activity.js';
import type { BookInput } from '../services/books.js';

export interface SeedPage {
  text: string;
  /** Indonesian text for the page. */
  id: string;
  emoji: string;
  activity?: PageActivity;
}

/**
 * Seeds carry no image paths (seed.ts derives /stories/<slug>/cover.jpg, p1.jpg, ...) and spell the Indonesian
 * translation inline (`titleId`, `summaryId`, page `id`) which seed.ts folds into the `i18n` fields.
 */
export type SeedBook = Omit<BookInput, 'coverUrl' | 'pages' | 'i18n'> & { titleId: string; summaryId: string; pages: SeedPage[] };

const b = (x: Omit<SeedBook, 'status' | 'previewPages'> & Partial<Pick<SeedBook, 'status' | 'previewPages'>>): SeedBook => ({
  status: 'published',
  previewPages: 2,
  ...x,
});

// Small builders keep the story data readable. Positions are percentages over the illustration.
/** A touchable sticker. `soundId` is the Indonesian sound word ("Quack!" is "Kwek!"). */
const tap = (emoji: string, x: number, y: number, sound: string, soundId: string, reaction: Reaction = 'hop'): Sticker => ({
  emoji,
  x,
  y,
  sound,
  reaction,
  i18n: soundId ? { id: { sound: soundId } } : {},
});
/** Choices are [emoji, English label, Indonesian label, correct?]. */
const ask = (prompt: string, promptId: string, ...choices: [string, string, string, boolean?][]) => ({
  prompt,
  i18n: { id: { prompt: promptId } },
  choices: choices.map(([emoji, label, labelId, correct]) => ({
    emoji,
    label,
    correct: correct === true,
    i18n: { id: { label: labelId } },
  })),
});
const play = (stickers: Sticker[] = [], question: ReturnType<typeof ask> | null = null): PageActivity => ({ stickers, question });

/** Original, short read-aloud stories in English and Indonesian. Placeholder art is emoji on gradients until real illustrations land. */
export const SEED_BOOKS: SeedBook[] = [
  b({
    title: 'Moon Wants a Nap',
    titleId: 'Bulan Mau Tidur',
    author: 'Main Story Studio',
    price: 0,
    ageMin: 0,
    ageMax: 3,
    readingMinutes: 2,
    previewPages: 6,
    summary: 'The moon is very, very sleepy. Can the stars help her find a cozy place to rest? A free bedtime read-aloud.',
    summaryId:
      'Bulan sangat, sangat mengantuk. Bisakah bintang-bintang membantunya menemukan tempat yang nyaman untuk beristirahat? Cerita pengantar tidur gratis.',
    coverEmoji: '🌙',
    coverFrom: '#3B3F8F',
    coverTo: '#8E7CF0',
    pages: [
      {
        emoji: '🌙',
        text: 'The moon yawned a big, round yawn. "I am so sleepy," she said.',
        id: 'Bulan menguap lebar sekali. "Aku mengantuk sekali," katanya.',
        activity: play([tap('⭐', 18, 24, 'Twinkle!', 'Kerlap-kerlip!', 'float')]),
      },
      {
        emoji: '⭐',
        text: 'A little star twinkled. "Come rest on my bed of light!"',
        id: 'Seorang bintang kecil berkelap-kelip. "Ayo istirahat di tempat tidur cahayaku!"',
        activity: play([tap('✨', 78, 28, 'Ting!', 'Ting!', 'spin'), tap('⭐', 22, 72, 'Twinkle!', 'Kerlap-kerlip!', 'float')]),
      },
      {
        emoji: '☁️',
        text: 'But the star-bed was too bright. The moon blinked and blinked.',
        id: 'Tapi tempat tidur bintang itu terlalu terang. Bulan berkedip-kedip terus.',
      },
      {
        emoji: '🌳',
        text: 'A tall tree waved. "Rest in my branches!" But the leaves went swish, swish, swish.',
        id: 'Sebatang pohon tinggi melambai. "Istirahatlah di dahanku!" Tapi daun-daunnya berbunyi sret, sret, sret.',
        activity: play([tap('🍃', 24, 30, 'Swish!', 'Sret!', 'wiggle'), tap('🍃', 76, 62, 'Swish!', 'Sret!', 'wiggle')]),
      },
      {
        emoji: '🌊',
        text: 'The sea hummed a slow song. Shhh… shhh… shhh… The moon felt her eyes grow heavy.',
        id: 'Laut menyenandungkan lagu yang pelan. Syuuu… syuuu… syuuu… Mata Bulan terasa semakin berat.',
        activity: play(
          [],
          ask(
            'What sound does the sea make in this story?',
            'Suara apa yang dibuat laut dalam cerita ini?',
            ['🌊', 'Shhh…', 'Syuuu…', true],
            ['🦁', 'Roar!', 'Aum!'],
            ['🔔', 'Ding!', 'Ting!'],
          ),
        ),
      },
      {
        emoji: '😴',
        text: 'And so the moon slept on the quiet sea. Goodnight, moon. Goodnight, you.',
        id: 'Maka Bulan pun tidur di atas laut yang tenang. Selamat malam, Bulan. Selamat malam, kamu.',
        activity: play([tap('💤', 50, 24, 'Zzz…', 'Zzz…', 'float')]),
      },
    ],
  }),
  b({
    title: 'The Little Red Boat',
    titleId: 'Perahu Merah Kecil',
    author: 'Main Story Studio',
    price: 35_000,
    ageMin: 2,
    ageMax: 4,
    readingMinutes: 4,
    summary: 'A tiny red boat dreams of the open sea, but first she must learn that brave things start small.',
    summaryId:
      'Sebuah perahu merah mungil bermimpi tentang laut lepas, tetapi pertama-tama ia harus belajar bahwa hal-hal berani dimulai dari yang kecil.',
    coverEmoji: '⛵',
    coverFrom: '#FF7A59',
    coverTo: '#FFC46B',
    pages: [
      {
        emoji: '⛵',
        text: 'Down at the busy harbor lived a little red boat named Rosie.',
        id: 'Di pelabuhan yang ramai, tinggallah sebuah perahu merah kecil bernama Rosie.',
        activity: play([tap('🐦', 80, 22, 'Squawk!', 'Kwak!', 'hop')]),
      },
      {
        emoji: '🚢',
        text: 'The big ships sailed far away. "Beep beep!" they said. "Too small for the sea!"',
        id: 'Kapal-kapal besar berlayar jauh. "Tut tut!" kata mereka. "Terlalu kecil untuk laut!"',
        activity: play([tap('🚢', 72, 66, 'Beep beep!', 'Tut tut!', 'hop')]),
      },
      {
        emoji: '🌧️',
        text: 'One stormy morning, a tiny duckling got lost in the waves.',
        id: 'Suatu pagi yang berbadai, seekor anak bebek kecil tersesat di antara ombak.',
        activity: play(
          [],
          ask(
            'Who got lost in the waves?',
            'Siapa yang tersesat di ombak?',
            ['🐘', 'An elephant', 'Seekor gajah'],
            ['🦆', 'A duckling', 'Anak bebek', true],
            ['🐟', 'A fish', 'Seekor ikan'],
          ),
        ),
      },
      {
        emoji: '🦆',
        text: 'The big ships were too big to reach her. But Rosie was just the right size.',
        id: 'Kapal-kapal besar terlalu besar untuk menjangkaunya. Tapi Rosie berukuran pas.',
        activity: play([tap('🦆', 30, 62, 'Quack!', 'Kwek!', 'hop')]),
      },
      {
        emoji: '🌈',
        text: 'Rosie scooped up the duckling, safe and dry. A rainbow stretched across the sky.',
        id: 'Rosie menyelamatkan anak bebek itu, aman dan kering. Pelangi terbentang di langit.',
        activity: play([tap('🌈', 70, 24, 'Wow!', 'Wah!', 'grow')]),
      },
      {
        emoji: '💛',
        text: 'From that day on, everyone knew: small boats can do big, brave things.',
        id: 'Sejak hari itu, semua orang tahu: perahu kecil pun bisa melakukan hal besar dan berani.',
      },
    ],
  }),
  b({
    title: 'Bima and the Sleepy Dragon',
    titleId: 'Bima dan Naga yang Susah Tidur',
    author: 'Main Story Studio',
    price: 39_000,
    ageMin: 3,
    ageMax: 5,
    readingMinutes: 5,
    summary: 'Bima finds a dragon who cannot fall asleep. Together they discover that the best lullaby is a kind friend.',
    summaryId:
      'Bima menemukan seekor naga yang tidak bisa tidur. Bersama-sama mereka menemukan bahwa lagu pengantar tidur terbaik adalah sahabat yang baik.',
    coverEmoji: '🐉',
    coverFrom: '#2FA37A',
    coverTo: '#A5E6C0',
    pages: [
      {
        emoji: '🏔️',
        text: 'High on a misty mountain, Bima heard a sound: huuuuuh… huuuuuh…',
        id: 'Di atas gunung yang berkabut, Bima mendengar suara: huuuuuh… huuuuuh…',
      },
      {
        emoji: '🐉',
        text: 'It was a dragon, and he was wide awake! "I can\'t sleep," he sniffled.',
        id: 'Ternyata seekor naga, dan ia masih terjaga! "Aku tidak bisa tidur," katanya sambil terisak.',
        activity: play([tap('💧', 66, 40, 'Sniff!', 'Hiks!', 'hop')]),
      },
      {
        emoji: '🔥',
        text: 'Each time he sighed, tiny sparks floated up like fireflies.',
        id: 'Setiap kali ia menghela napas, percikan api kecil melayang naik seperti kunang-kunang.',
        activity: play([
          tap('✨', 24, 30, 'Pop!', 'Pletuk!', 'float'),
          tap('✨', 52, 20, 'Pop!', 'Pletuk!', 'float'),
          tap('✨', 78, 34, 'Pop!', 'Pletuk!', 'float'),
        ]),
      },
      {
        emoji: '📖',
        text: 'Bima counted the sparks. One… two… three… all the way to ten.',
        id: 'Bima menghitung percikan api itu. Satu… dua… tiga… sampai sepuluh.',
        activity: play(
          [],
          ask(
            'How many sparks did Bima count?',
            'Berapa percikan api yang dihitung Bima?',
            ['3️⃣', 'Three', 'Tiga'],
            ['🔟', 'Ten', 'Sepuluh', true],
            ['7️⃣', 'Seven', 'Tujuh'],
          ),
        ),
      },
      {
        emoji: '🎶',
        text: "Then Bima hummed a quiet song. The dragon's big eyes got small.",
        id: 'Lalu Bima bersenandung pelan. Mata besar si naga pun mengecil.',
        activity: play([tap('🎵', 30, 30, 'La la la…', 'La la la…', 'float'), tap('🎶', 74, 54, 'Mmm…', 'Mmm…', 'float')]),
      },
      {
        emoji: '💤',
        text: 'Zzzz… the dragon slept. And Bima tiptoed home under a sky full of stars.',
        id: 'Zzzz… sang naga tertidur. Dan Bima berjingkat pulang di bawah langit penuh bintang.',
        activity: play([tap('💤', 50, 26, 'Zzz…', 'Zzz…', 'float')]),
      },
    ],
  }),
  b({
    title: 'Counting Fireflies',
    titleId: 'Menghitung Kunang-kunang',
    author: 'Main Story Studio',
    price: 29_000,
    ageMin: 2,
    ageMax: 4,
    readingMinutes: 3,
    summary: 'One by one, the fireflies light up the garden. A gentle counting book from one to six.',
    summaryId: 'Satu per satu, kunang-kunang menyalakan taman. Buku berhitung yang lembut dari satu sampai enam.',
    coverEmoji: '✨',
    coverFrom: '#1E2A5A',
    coverTo: '#F2C94C',
    pages: [
      {
        emoji: '1️⃣',
        text: 'One firefly wakes up under a leaf. Blink!',
        id: 'Satu kunang-kunang bangun di bawah daun. Kedip!',
        activity: play([tap('🪲', 50, 46, 'Blink!', 'Kedip!', 'grow')]),
      },
      {
        emoji: '2️⃣',
        text: 'Two fireflies dance by the pond. Blink, blink!',
        id: 'Dua kunang-kunang menari di tepi kolam. Kedip, kedip!',
        activity: play([tap('🪲', 32, 40, 'Blink!', 'Kedip!', 'grow'), tap('🪲', 68, 56, 'Blink!', 'Kedip!', 'grow')]),
      },
      {
        emoji: '3️⃣',
        text: 'Three fireflies tickle the tall grass.',
        id: 'Tiga kunang-kunang menggelitik rumput yang tinggi.',
        activity: play([
          tap('🪲', 25, 34, 'Blink!', 'Kedip!', 'grow'),
          tap('🪲', 52, 58, 'Blink!', 'Kedip!', 'grow'),
          tap('🪲', 76, 36, 'Blink!', 'Kedip!', 'grow'),
        ]),
      },
      {
        emoji: '4️⃣',
        text: 'Four fireflies zoom around the old oak tree.',
        id: 'Empat kunang-kunang berputar-putar di sekitar pohon ek tua.',
        activity: play([
          tap('🪲', 24, 30, 'Zoom!', 'Wuusss!', 'spin'),
          tap('🪲', 76, 28, 'Zoom!', 'Wuusss!', 'spin'),
          tap('🪲', 30, 70, 'Zoom!', 'Wuusss!', 'spin'),
          tap('🪲', 72, 68, 'Zoom!', 'Wuusss!', 'spin'),
        ]),
      },
      {
        emoji: '5️⃣',
        text: 'Five fireflies make a twinkly circle.',
        id: 'Lima kunang-kunang membuat lingkaran yang berkelap-kelip.',
        activity: play(
          [],
          ask(
            'How many fireflies make the circle?',
            'Berapa kunang-kunang yang membuat lingkaran?',
            ['3️⃣', 'Three', 'Tiga'],
            ['5️⃣', 'Five', 'Lima', true],
            ['6️⃣', 'Six', 'Enam'],
          ),
        ),
      },
      {
        emoji: '6️⃣',
        text: 'Six fireflies, and the whole garden glows. Goodnight, little lights.',
        id: 'Enam kunang-kunang, dan seluruh taman bersinar. Selamat malam, lampu-lampu kecil.',
        activity: play(
          [],
          ask(
            'How many fireflies glow in the garden?',
            'Berapa kunang-kunang yang bersinar di taman?',
            ['4️⃣', 'Four', 'Empat'],
            ['5️⃣', 'Five', 'Lima'],
            ['6️⃣', 'Six', 'Enam', true],
          ),
        ),
      },
    ],
  }),
  b({
    title: "Mina's Rainy Day Orchestra",
    titleId: 'Orkestra Hari Hujan Mina',
    author: 'Main Story Studio',
    price: 39_000,
    ageMin: 3,
    ageMax: 6,
    readingMinutes: 5,
    summary: 'It is raining and Mina is bored, until the pots, pans and puddles start to play music.',
    summaryId: 'Hujan turun dan Mina bosan, sampai panci, wajan, dan genangan air mulai memainkan musik.',
    coverEmoji: '🥁',
    coverFrom: '#4FA8FF',
    coverTo: '#BFE3FF',
    pages: [
      {
        emoji: '🌧️',
        text: 'Pitter, patter, pitter. Rain again! Mina pressed her nose to the window.',
        id: 'Tik, tak, tik. Hujan lagi! Mina menempelkan hidungnya di jendela.',
        activity: play([tap('💧', 28, 26, 'Pitter!', 'Tik!', 'hop'), tap('💧', 72, 44, 'Patter!', 'Tak!', 'hop')]),
      },
      {
        emoji: '🍳',
        text: 'She tapped a pan. Ting! She tapped a pot. Dong!',
        id: 'Ia memukul wajan. Ting! Ia memukul panci. Dong!',
        activity: play([tap('🍳', 30, 58, 'Ting!', 'Ting!', 'hop'), tap('🥘', 70, 58, 'Dong!', 'Dong!', 'hop')]),
      },
      {
        emoji: '🥄',
        text: 'A wooden spoon went rat-a-tat on the kitchen floor.',
        id: 'Sebuah sendok kayu berbunyi tak-tak-tak di lantai dapur.',
        activity: play([tap('🥄', 50, 60, 'Rat-a-tat!', 'Tak tak tak!', 'wiggle')]),
      },
      {
        emoji: '🐱',
        text: 'Even the cat joined in: "Meow-ooo!" It was a band!',
        id: 'Bahkan si kucing ikut: "Meong-ooo!" Jadilah sebuah band!',
        activity: play(
          [],
          ask(
            'Who joined the band?',
            'Siapa yang ikut bergabung dalam band?',
            ['🐶', 'A dog', 'Seekor anjing'],
            ['🐱', 'A cat', 'Seekor kucing', true],
            ['🐰', 'A rabbit', 'Seekor kelinci'],
          ),
        ),
      },
      {
        emoji: '☔',
        text: 'Outside, the puddles went splash, splash, splish. The rain kept the beat.',
        id: 'Di luar, genangan air berbunyi byur, byur, plash. Hujan menjaga iramanya.',
        activity: play([tap('💦', 30, 68, 'Splash!', 'Byur!', 'hop'), tap('💦', 70, 68, 'Splish!', 'Plash!', 'hop')]),
      },
      {
        emoji: '🎉',
        text: 'Mina took a bow. The best concert ever, and it only needed a rainy day.',
        id: 'Mina membungkuk memberi hormat. Konser terbaik sepanjang masa, dan hanya butuh hari yang hujan.',
        activity: play([tap('👏', 50, 30, 'Clap clap!', 'Prok prok!', 'grow')]),
      },
    ],
  }),
  b({
    title: 'The Very Shy Cloud',
    titleId: 'Awan yang Sangat Pemalu',
    author: 'Main Story Studio',
    price: 35_000,
    ageMin: 3,
    ageMax: 5,
    readingMinutes: 4,
    summary: 'Puff is too shy to rain, but a thirsty garden gives him the courage to try.',
    summaryId: 'Puff terlalu malu untuk menurunkan hujan, tetapi taman yang kehausan memberinya keberanian untuk mencoba.',
    coverEmoji: '☁️',
    coverFrom: '#FF8FB1',
    coverTo: '#FFD6E5',
    pages: [
      {
        emoji: '☁️',
        text: 'Puff was a small cloud who was very, very shy.',
        id: 'Puff adalah awan kecil yang sangat, sangat pemalu.',
        activity: play([tap('☁️', 50, 28, 'Hello…', 'Halo…', 'wiggle')]),
      },
      {
        emoji: '🌻',
        text: 'Below him, a garden of sunflowers drooped. "We are so thirsty," they sighed.',
        id: 'Di bawahnya, taman bunga matahari terkulai. "Kami haus sekali," keluh mereka.',
        activity: play([tap('🌻', 28, 64, 'Sigh…', 'Huuh…', 'wiggle'), tap('🌻', 72, 64, 'Sigh…', 'Huuh…', 'wiggle')]),
      },
      {
        emoji: '😳',
        text: '"I can\'t," whispered Puff. "What if everyone looks at me?"',
        id: '"Aku tidak bisa," bisik Puff. "Bagaimana kalau semua orang melihatku?"',
      },
      {
        emoji: '🐝',
        text: 'A bee buzzed up. "We\'ll look at the flowers. Not at you."',
        id: 'Seekor lebah terbang menghampiri. "Kami akan melihat bunga-bunga. Bukan melihatmu."',
        activity: play([tap('🐝', 62, 36, 'Bzzz!', 'Nging!', 'float')]),
      },
      {
        emoji: '💧',
        text: 'Puff took a deep breath. Drip… drip… drip-drip-drip!',
        id: 'Puff menarik napas dalam-dalam. Tik… tik… tik-tik-tik!',
        activity: play([
          tap('💧', 30, 36, 'Drip!', 'Tik!', 'hop'),
          tap('💧', 52, 52, 'Drip!', 'Tik!', 'hop'),
          tap('💧', 74, 38, 'Drip!', 'Tik!', 'hop'),
        ]),
      },
      {
        emoji: '🌈',
        text: 'The sunflowers stood tall and cheered. Puff smiled, and so did the sky.',
        id: 'Bunga-bunga matahari berdiri tegak dan bersorak. Puff tersenyum, begitu juga langit.',
        activity: play(
          [],
          ask(
            'Who cheered at the end?',
            'Siapa yang bersorak di akhir cerita?',
            ['🦈', 'A shark', 'Seekor hiu'],
            ['🌻', 'The sunflowers', 'Bunga matahari', true],
            ['🚗', 'A car', 'Sebuah mobil'],
          ),
        ),
      },
    ],
  }),
  b({
    title: 'The Brave Mango (draft)',
    titleId: 'Mangga yang Berani (draf)',
    author: 'Main Story Studio',
    price: 39_000,
    ageMin: 3,
    ageMax: 5,
    readingMinutes: 4,
    status: 'draft',
    summary: 'Work in progress: a mango learns to leave the tree. Only visible to admins.',
    summaryId: 'Sedang dikerjakan: sebuah mangga belajar meninggalkan pohonnya. Hanya terlihat oleh admin.',
    coverEmoji: '🥭',
    coverFrom: '#FFB020',
    coverTo: '#FFE08A',
    pages: [
      { emoji: '🥭', text: 'High in the tree, a little mango held on tight.', id: 'Di atas pohon, sebuah mangga kecil berpegangan erat.' },
    ],
  }),
];
