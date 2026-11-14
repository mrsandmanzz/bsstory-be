import { beforeEach, describe, expect, it } from 'vitest';
import { buildContainer } from '../src/container.js';
import { createDb } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';
import { MAX_IMAGE_BYTES, detectImageType } from '../src/domain/image.js';

// A real 1x1 PNG, so the bytes are a genuine image and not just a matching signature.
const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  const c = buildContainer(await createDb('pglite:memory'), () => new Date('2026-01-01T00:00:00Z'), null);
  await c.bootstrap();
  app = createApp(async () => c);
});

async function login(email: string): Promise<string> {
  const res = await app.request('/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return ((await res.json()) as { token: string }).token;
}

const upload = (body: Uint8Array, token?: string, type = 'application/octet-stream') =>
  app.request('/v1/admin/images', {
    method: 'POST',
    headers: { 'Content-Type': type, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body as Uint8Array<ArrayBuffer>,
  });

describe('image type detection', () => {
  it('recognises JPEG, PNG and WebP by their first bytes, and nothing else', () => {
    expect(detectImageType(JPEG)).toBe('image/jpeg');
    expect(detectImageType(PNG)).toBe('image/png');
    expect(detectImageType(WEBP)).toBe('image/webp');
    expect(detectImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectImageType(new TextEncoder().encode('#!/bin/sh\necho hi'))).toBeNull();
    expect(detectImageType(new Uint8Array(0))).toBeNull();
  });
});

describe('image upload and delivery', () => {
  it('stores an admin upload and serves the same bytes to anyone, cached for good and usable cross-origin', async () => {
    const admin = await login('admin@mainstory.test');
    const res = await upload(PNG, admin);
    expect(res.status).toBe(201);
    const { url, contentType, size } = (await res.json()) as { url: string; contentType: string; size: number };
    expect(url).toMatch(/^\/v1\/images\/[0-9a-f-]{36}$/);
    expect(contentType).toBe('image/png');
    expect(size).toBe(PNG.byteLength);

    const got = await app.request(url); // no token: covers are public
    expect(got.status).toBe(200);
    expect(got.headers.get('Content-Type')).toBe('image/png');
    expect(got.headers.get('Cache-Control')).toContain('immutable');
    expect(got.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG);
  });

  it('uses the detected type, not the one the client claims', async () => {
    const admin = await login('admin@mainstory.test');
    const res = await upload(JPEG, admin, 'image/png');
    expect(((await res.json()) as { contentType: string }).contentType).toBe('image/jpeg');
  });

  it('only admins may upload', async () => {
    expect((await upload(PNG)).status).toBe(401);
    expect((await upload(PNG, await login('parent@mainstory.test'))).status).toBe(403);
  });

  it('rejects files that are not JPEG, PNG or WebP, including SVG', async () => {
    const admin = await login('admin@mainstory.test');
    const svg = await upload(new TextEncoder().encode('<svg onload="alert(1)"></svg>'), admin, 'image/svg+xml');
    expect(svg.status).toBe(422);
    expect(((await svg.json()) as any).error.code).toBe('IMAGE_TYPE_NOT_ALLOWED');
    expect((await upload(new Uint8Array(0), admin)).status).toBe(422);
  });

  it('rejects an image over the size limit', async () => {
    const admin = await login('admin@mainstory.test');
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG);
    const res = await upload(big, admin);
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.code).toBe('IMAGE_TOO_LARGE');
  });

  it('answers 404 for an unknown or malformed id', async () => {
    expect((await app.request('/v1/images/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await app.request('/v1/images/not-an-id')).status).toBe(404);
  });

  it('lets an uploaded picture be saved as a book cover and page picture', async () => {
    const admin = await login('admin@mainstory.test');
    const { url } = (await (await upload(PNG, admin)).json()) as { url: string };
    const body = {
      title: 'Picture Book',
      author: 'Me',
      summary: 'A book with its own art.',
      ageMin: 0,
      ageMax: 3,
      price: 0,
      status: 'published',
      previewPages: 1,
      coverEmoji: '📖',
      coverUrl: url,
      coverFrom: '#FFB84D',
      coverTo: '#FF8A5C',
      readingMinutes: 2,
      i18n: {},
      pages: [{ text: 'Page one', emoji: '✨', imageUrl: url, activity: null, i18n: {} }],
    };
    const res = await app.request('/v1/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    const { book } = (await res.json()) as { book: { slug: string; coverUrl: string } };
    expect(book.coverUrl).toBe(url);
    const read = (await (await app.request(`/v1/books/${book.slug}/read`)).json()) as { pages: { imageUrl: string }[] };
    expect(read.pages[0]?.imageUrl).toBe(url);
  });
});
