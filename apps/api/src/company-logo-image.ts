import sharp from "sharp";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

// An operator can publish the exact artwork that passed visual review, even
// when the source CDN later fails. URLs remain bound to content hashes.
export async function reviewedCompanyLogos(directory: string) {
  const manifest = z
    .record(z.url(), z.string().regex(/^[a-f0-9]{64}$/))
    .parse(
      JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")),
    );
  return {
    has: (url: string) => Object.hasOwn(manifest, url),
    async read(url: string) {
      const hash = Object.hasOwn(manifest, url) ? manifest[url] : undefined;
      if (!hash) throw new Error("Logo source is not in the reviewed manifest");
      const bytes = await readFile(path.join(directory, hash + ".webp"));
      if (
        bytes.length > 2 * 1024 * 1024 ||
        createHash("sha256").update(bytes).digest("hex") !== hash
      )
        throw new Error("Reviewed logo content does not match its manifest");
      return bytes;
    },
  };
}

/** Preserve supplied colors; give reversed marks a contrasting plate. */
export async function companyLogoImage(
  source: Buffer,
  supportReversed = false,
) {
  const image = sharp(source, {
    failOn: "error",
    limitInputPixels: 25_000_000,
  }).rotate();
  if (supportReversed) {
    const { data } = await image
      .clone()
      .resize(120, 120, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let visible = 0,
      light = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      if (alpha < 0.2) continue;
      visible += alpha;
      if (Math.min(data[i], data[i + 1], data[i + 2]) > 220) light += alpha;
    }
    const metadata = await image.metadata();
    if (metadata.hasAlpha && visible > 0 && light / visible > 0.55)
      image.flatten({ background: "#182e39" });
  }
  return image
    .resize(640, 640, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 86, effort: 4 })
    .toBuffer();
}
