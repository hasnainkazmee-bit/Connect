import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { userInfo } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(
  userInfo().username,
  "node",
  "Run with the image's application user",
);
assert.notEqual(
  process.getuid(),
  0,
  "A root smoke test would hide unreadable files",
);

const rootPackage = JSON.parse(readFileSync("/app/package.json", "utf8"));
const apiPackage = JSON.parse(
  readFileSync("/app/apps/api/package.json", "utf8"),
);
assert.ok(rootPackage.workspaces.length);
assert.equal(apiPackage.type, "module");

function readTree(directory) {
  let count = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) count += readTree(filename);
    else {
      readFileSync(filename);
      count++;
    }
  }
  assert.ok(count > 0, `Runtime directory must not be empty: ${directory}`);
  return count;
}
const migrations = readTree("/app/apps/api/migrations");
const apiFiles = readTree("/app/apps/api/dist");
const webFiles = readTree("/app/apps/web/dist");

// Resolve from the deployed API, where workspace dependencies must be present.
const apiRequire = createRequire("/app/apps/api/dist/social-interactions.js");
for (const dependency of Object.keys(apiPackage.dependencies)) {
  await import(pathToFileURL(apiRequire.resolve(dependency)).href);
}
console.log(
  `Runtime user can read ${migrations} migrations, ${apiFiles} API files, ${webFiles} web assets, and load all ${Object.keys(apiPackage.dependencies).length} API dependencies.`,
);
const { default: emojiRegex } = await import(
  pathToFileURL(apiRequire.resolve("emoji-regex")).href
);
const catalog = JSON.parse(readFileSync("/tmp/reaction-emojis.json", "utf8"));
assert.ok(catalog.length > 3000, "The complete picker catalog must be checked");
for (const { emoji } of catalog) {
  const matches = [...emoji.matchAll(emojiRegex())];
  assert.equal(matches.length, 1, `Unsupported picker emoji: ${emoji}`);
  assert.equal(matches[0][0], emoji, `Incomplete picker emoji: ${emoji}`);
}
console.log(
  `API container supports all ${catalog.length} picker emoji variants.`,
);
