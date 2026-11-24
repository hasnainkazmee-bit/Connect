import sharp from "sharp";

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
