import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { profileImage } from "../apps/api/dist/profile-image.js";

test("public thumbnails preserve logo proportions and alpha, deduplicate work and stay bounded", async () => {
  const input = await sharp({
    create: {
      width: 1600,
      height: 800,
      channels: 4,
      background: { r: 255, g: 106, b: 0, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  let reads = 0;
  const load = async () => {
    reads++;
    return input;
  };
  const [a, b] = await Promise.all([
    profileImage("logo-192", 192, load),
    profileImage("logo-192", 192, load),
  ]);
  assert.equal(reads, 1);
  assert.deepEqual(a, b);
  const meta = await sharp(a).metadata();
  assert.equal(meta.width, 192);
  assert.equal(meta.height, 96);
  assert.equal(meta.hasAlpha, true);
  assert.equal(meta.format, "webp");
  await profileImage("logo-192", 192, load);
  assert.equal(reads, 1);
  assert.equal(await profileImage("bad-width", 999, load), null);
  assert.equal(reads, 1);
  assert.equal(
    await profileImage("not-image", 192, async () =>
      Buffer.from("not an image"),
    ),
    null,
  );
  const tiny = await sharp({
    create: { width: 24, height: 12, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  assert.equal(
    (await sharp(await profileImage("small", 192, async () => tiny)).metadata())
      .width,
    24,
  );
});

test("excess parallel transforms fall back instead of building an unbounded queue", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const load = async () => {
    await gate;
    return Buffer.from("invalid");
  };
  const queued = Array.from({ length: 34 }, (_, i) =>
    profileImage("pending-" + i, 96, load),
  );
  try {
    assert.equal(await profileImage("overflow", 96, load), null);
  } finally {
    release();
    await Promise.all(queued);
  }
});
