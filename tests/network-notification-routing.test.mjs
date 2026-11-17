import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
const origin = "https://connect.example.test";
const app = vm.createContext({
  exports: {},
  URL,
  URLSearchParams,
  location: { origin },
  require: () => ({}),
});
vm.runInContext(
  ts.transpileModule(await fs.readFile("apps/colabb/src/web-push.ts", "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText,
  app,
);
const worker = vm.createContext({
  URL,
  self: { location: { origin }, addEventListener() {} },
});
vm.runInContext(
  await fs.readFile("apps/colabb/public/push-sw.js", "utf8"),
  worker,
);
const id = "11111111-1111-4111-8111-111111111111";
test("Network notification destinations retain exact post/community and reject unrelated paths", () => {
  for (const route of [
    `/network/posts/${id}`,
    `/network/communities/${id}`,
    `/network/companies/${id}`,
    "/network/notifications",
    `/network/communities/${id}/manage/members`,
    `/network/invitations/${"a".repeat(64)}`,
  ]) {
    assert.equal(app.exports.notificationDestination(route).path, route);
    assert.equal(new URL(worker.safeDestination(route)).pathname, route);
  }
  for (const route of [
    "//evil.example/network",
    "https://evil.example/network",
    "/network/../../account/private",
    "/network/invitations/secret",
    "/network/posts/not-a-uuid",
    "/network/settings/delete-all",
  ]) {
    assert.equal(app.exports.notificationDestination(route), null, route);
    assert.equal(worker.safeDestination(route), null, route);
  }
});
