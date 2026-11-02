// Render the sourced SVGs without changing their artwork. PNG counterparts are
// compatible with existing Android clients as well as the web directory.
import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
const folder = path.resolve("apps/web/public/assets/companies");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  for (const name of (await fs.readdir(folder)).filter((n) =>
    n.endsWith(".svg"),
  )) {
    const source =
      "data:image/svg+xml;base64," +
      (await fs.readFile(path.join(folder, name))).toString("base64");
    const png = await page.evaluate(async (source) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const scale = Math.min(
        512 / image.naturalWidth,
        192 / image.naturalHeight,
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png").split(",")[1];
    }, source);
    await fs.writeFile(
      path.join(folder, name.replace(/\.svg$/, ".png")),
      Buffer.from(png, "base64"),
    );
    console.log(name + " → PNG");
  }
} finally {
  await browser.close();
}
