import sharp from "sharp";

// Only public company images reach this helper. A small, bounded cache prevents
// repeated decoding; the browser/CDN cache handles subsequent visits.
const cache = new Map<string, Buffer>();
const pending = new Map<string, Promise<Buffer | null>>();
const maxBytes = 24 * 1024 * 1024;
let bytes = 0;
let active = 0;
const waiting: (() => void)[] = [];
function acquire() {
  if (active < 2) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else active--;
}
export const profileImageWidths = new Set([96, 192, 384, 768, 1280]);
export async function profileImage(
  key: string,
  width: number,
  load: () => Promise<Buffer>,
): Promise<Buffer | null> {
  if (!profileImageWidths.has(width)) return null;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const existing = pending.get(key);
  if (existing) return existing;
  // Avoid an unbounded transform queue. A busy server can serve the original.
  if (pending.size >= 34) return null;
  const task = (async () => {
    await acquire();
    try {
      const input = await load();
      if (input.length > 10 * 1024 * 1024) return null;
      const image = await sharp(input, {
        limitInputPixels: 25_000_000,
        animated: false,
      })
        .rotate()
        .resize({
          width,
          height: width,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 84, effort: 3 })
        .toBuffer();
      while (bytes + image.length > maxBytes && cache.size) {
        const oldest = cache.keys().next().value!;
        bytes -= cache.get(oldest)!.length;
        cache.delete(oldest);
      }
      if (image.length <= maxBytes) {
        cache.set(key, image);
        bytes += image.length;
      }
      return image;
    } catch {
      return null;
    } finally {
      // Damaged/unsupported originals retain their existing delivery path.
      release();
    }
  })();
  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}
