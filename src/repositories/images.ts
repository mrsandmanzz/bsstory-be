import type { Db } from '../db/client.js';
import type { ImageType } from '../domain/image.js';

export interface StoredImage {
  contentType: ImageType;
  data: Uint8Array;
}

export function imagesRepo(db: Db) {
  return {
    async save(id: string, contentType: ImageType, data: Uint8Array, now: Date): Promise<void> {
      await db.execute({
        sql: 'INSERT INTO images (id, content_type, data, size, created_at) VALUES (?,?,?,?,?)',
        args: [id, contentType, data, data.byteLength, now.toISOString()],
      });
    },
    async get(id: string): Promise<StoredImage | null> {
      const r = (await db.execute({ sql: 'SELECT content_type, data FROM images WHERE id = ?', args: [id] })).rows[0];
      if (!r) return null;
      // node-postgres hands back a Buffer and PGlite a Uint8Array; both are Uint8Arrays.
      return { contentType: r.content_type as ImageType, data: r.data as Uint8Array };
    },
  };
}
