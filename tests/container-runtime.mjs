import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Resolve from the deployed API, where workspace dependencies must be present.
const apiRequire = createRequire("/app/apps/api/dist/social-interactions.js");
const { default: emojiRegex } = await import(pathToFileURL(apiRequire.resolve("emoji-regex")).href);
const catalog = JSON.parse(readFileSync("/tmp/reaction-emojis.json", "utf8"));
assert.ok(catalog.length > 3000, "The complete picker catalog must be checked");
for (const { emoji } of catalog) {
  const matches = [...emoji.matchAll(emojiRegex())];
  assert.equal(matches.length, 1, `Unsupported picker emoji: ${emoji}`);
  assert.equal(matches[0][0], emoji, `Incomplete picker emoji: ${emoji}`);
}
console.log(`API container supports all ${catalog.length} picker emoji variants.`);
