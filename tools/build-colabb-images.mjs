// Generate display-sized photos without changing the approved source artwork.
import fs from "node:fs/promises";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
const brand = new URL("../apps/colabb/", import.meta.url);
await fs.mkdir(new URL("dist/brand/photos/", brand), { recursive: true });
for (const name of ["roof", "planning", "detail", "craft"]) {
  const source = new URL(`public/brand/${name}.webp`, brand);
  const image = sharp(await fs.readFile(source));
  const { width } = await image.metadata();
  for (const size of [480, 960, width]) {
    await image
      .clone()
      .resize({ width: size, withoutEnlargement: true })
      .webp({ quality: 82, effort: 5 })
      .toFile(
        fileURLToPath(
          new URL(`dist/brand/photos/${name}-v1-${size}.webp`, brand),
        ),
      );
  }
}
