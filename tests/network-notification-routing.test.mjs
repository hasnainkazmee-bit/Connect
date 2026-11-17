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
  URLSearchParams,
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

test("Company inbox notifications normalize legacy links and retain the target workspace", () => {
  const target = "22222222-2222-4222-8222-222222222222";
  const company = "33333333-3333-4333-8333-333333333333";
  const cases = [
    ["/messages", "/inbox/companies"],
    [`/messages?company=${target}`, `/inbox/companies?company=${target}`],
    [`/messages/company/${target}`, `/inbox/companies?company=${target}`],
    [
      `/messages?conversation=${target}`,
      `/inbox/companies?conversation=${target}`,
    ],
    [`/messages/${target}`, `/inbox/companies?conversation=${target}`],
    ["/requests", "/inbox/companies?filter=requests"],
    [
      `/inbox/companies?company=${target}&unsafe=drop`,
      `/inbox/companies?company=${target}`,
    ],
    [
      `/inbox/companies?conversation=${target}`,
      `/inbox/companies?conversation=${target}`,
    ],
    ["/inbox/companies?filter=requests", "/inbox/companies?filter=requests"],
    [
      `/inbox/companies?company=${target}&filter=unread`,
      `/inbox/companies?company=${target}&filter=unread`,
    ],
    ["/inbox/companies?company=bad&filter=bad", "/inbox/companies"],
  ];
  for (const [from, to] of cases) {
    const normalized = app.exports.notificationDestination(from, company);
    assert.equal(normalized.path, to, from);
    assert.equal(normalized.companyId, company);
    const pushed = new URL(worker.safeDestination(from, company));
    assert.equal(pushed.searchParams.get("notificationCompany"), company);
    assert.equal(app.exports.notificationDestination(pushed.href).path, to);
    assert.equal(
      app.exports.notificationDestination(pushed.href).companyId,
      company,
    );
  }
  for (const from of [`/messages/company/${target}`, `/messages/${target}`]) {
    const url = `${from}?notificationCompany=${company}&notification=${target}`;
    const pushed = new URL(worker.safeDestination(url));
    assert.equal(pushed.searchParams.get("notification"), target);
    assert.equal(app.exports.notificationDestination(url).companyId, company);
  }
  for (const invalid of [
    "/inbox/admin",
    "/inbox/companies/delete",
    "//evil.example/inbox/companies",
    "/messages/not-a-uuid",
  ]) {
    assert.equal(app.exports.notificationDestination(invalid), null);
    assert.equal(worker.safeDestination(invalid), null);
  }
});
