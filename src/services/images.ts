import { randomUUID } from 'node:crypto';
import { AppError, Errors } from '../domain/errors.js';
import { MAX_IMAGE_BYTES, detectImageType } from '../domain/image.js';
import type { imagesRepo } from '../repositories/images.js';

/** An image lives at this path on the API. It is stored in `cover_url` / `image_url` exactly like any other path. */
export const imagePath = (id: string) => `/v1/images/${id}`;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function imagesService(repo: ReturnType<typeof imagesRepo>, clock: () => Date) {
  return {
    async upload(data: Uint8Array) {
      if (data.byteLength === 0) throw Errors.validation([{ field: 'image', message: 'Choose an image file' }]);
      if (data.byteLength > MAX_IMAGE_BYTES) throw Errors.imageTooLarge();
      const type = detectImageType(data);
      if (!type) throw new AppError(422, 'IMAGE_TYPE_NOT_ALLOWED', 'Upload a JPEG, PNG or WebP image.');
      const id = randomUUID();
      await repo.save(id, type, data, clock());
      return { url: imagePath(id), contentType: type, size: data.byteLength };
    },
    async get(id: string) {
      const image = ID.test(id) ? await repo.get(id) : null;
      if (!image) throw Errors.notFound('Image');
      return image;
    },
  };
}
