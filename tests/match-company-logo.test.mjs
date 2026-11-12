import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { needsDarkLogoBackground } = await tsImport(
  "../apps/web/src/match-company-logo.tsx",
  import.meta.url,
);
const pixels = (...groups) =>
  new Uint8ClampedArray(
    groups.flatMap(([count, rgba]) =>
      Array.from({ length: count }, () => rgba).flat(),
    ),
  );
const transparent = [0, 0, 0, 0];
const white = [255, 255, 255, 255];
const yellow = [255, 202, 0, 255];
const dark = [25, 40, 48, 255];

test("white wordmark with yellow artwork on transparency receives a dark surface", () => {
  assert.equal(
    needsDarkLogoBackground(
      pixels([50, transparent], [24, white], [26, yellow]),
    ),
    true,
  );
});

test("an entirely white transparent mark is visible on a dark surface", () => {
  assert.equal(
    needsDarkLogoBackground(pixels([70, transparent], [30, white])),
    true,
  );
});

test("an ordinary opaque white-background image stays white", () => {
  assert.equal(
    needsDarkLogoBackground(pixels([85, white], [10, dark], [5, yellow])),
    false,
  );
});

test("a dark wordmark with bright artwork on transparency stays white", () => {
  assert.equal(
    needsDarkLogoBackground(
      pixels([50, transparent], [24, dark], [26, yellow]),
    ),
    false,
  );
});

test("white details cannot override a substantial dark wordmark", () => {
  assert.equal(
    needsDarkLogoBackground(pixels([50, transparent], [26, white], [24, dark])),
    false,
  );
});

test("rounded transparent corners do not make an opaque white logo plate dark", () => {
  assert.equal(
    needsDarkLogoBackground(pixels([4, transparent], [90, white], [6, yellow])),
    false,
  );
});

test("near-transparent white edge pixels do not count as a white wordmark", () => {
  assert.equal(
    needsDarkLogoBackground(
      pixels([50, transparent], [26, [255, 255, 255, 35]], [24, yellow]),
    ),
    false,
  );
});

test("missing or fully transparent images remain blank white", () => {
  assert.equal(needsDarkLogoBackground(new Uint8ClampedArray()), false);
  assert.equal(needsDarkLogoBackground(pixels([100, transparent])), false);
});
