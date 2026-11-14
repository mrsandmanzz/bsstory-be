/** The only formats an admin can upload. SVG is left out on purpose: it can carry scripts. */
export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Vercel functions accept at most 4.5 MB per request, and the web app shrinks pictures far below this first. */
export const MAX_IMAGE_BYTES = 2_500_000;

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** Looks at the first bytes of the file, not at what the client claims, so a renamed .exe is never stored. */
export function detectImageType(b: Uint8Array): ImageType | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // WebP is "RIFF" + 4 size bytes + "WEBP".
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}
