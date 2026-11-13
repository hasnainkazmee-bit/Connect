import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const origin = "https://connect.example.test";
const source = await readFile(
  new URL("../apps/web/src/web-push.ts", import.meta.url),
  "utf8",
);
const app = vm.createContext({
  exports: {},
  URL,
  URLSearchParams,
  location: { origin },
  require: () => ({}),
});
vm.runInContext(
  ts.transpileModule(source, {
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
  await readFile(
    new URL("../apps/web/public/push-sw.js", import.meta.url),
    "utf8",
  ),
  worker,
);
const job = "11111111-1111-4111-8111-111111111111";
const provider = "22222222-2222-4222-8222-222222222222";
const company = "33333333-3333-4333-8333-333333333333";
const destination = (value) =>
  app.exports.notificationDestination(value, company);

test("task and quote notifications preserve their specific review destination", () => {
  for (const hash of [
    "#work-checklist",
    "#job-review",
    "#received-quotes",
    "#quote-form",
  ]) {
    const path = `/jobs/${job}${hash}`;
    assert.equal(destination(path).path, path);
    const pushed = new URL(worker.safeDestination(path, company));
    assert.equal(pushed.hash, hash);
    assert.equal(pushed.searchParams.get("notificationCompany"), company);
    assert.equal(
      destination(pushed.href).path,
      path,
      "Worker-to-app handoff retains the review section",
    );
  }
});

test("thread notification normalization stays stable for duplicate-alert suppression", () => {
  const path = `/jobs/inbox?job=${job}&provider=${provider}`;
  assert.equal(destination(path + "&unsafe=drop#work-checklist").path, path);
  assert.equal(destination(path).companyId, company);
  assert.equal(
    destination(`/jobs/inbox?job=bad&provider=${provider}`).path,
    "/jobs/inbox",
  );
  assert.equal(
    new URL(worker.safeDestination(path + "#work-checklist", company)).hash,
    "",
  );
});

test("unrecognized fragments and external destinations stay rejected or stripped", () => {
  assert.equal(
    destination(`/jobs/${job}?token=secret#arbitrary`).path,
    `/jobs/${job}`,
  );
  assert.equal(
    new URL(
      worker.safeDestination(`/jobs/${job}?token=secret#arbitrary`, company),
    ).hash,
    "",
  );
  assert.equal(destination("/account#work-checklist").path, "/account");
  assert.equal(destination(`/jobs/not-a-uuid#work-checklist`), null);
  for (const path of [
    "https://other.example/jobs/" + job,
    "//other.example/jobs/" + job,
    "/api/auth/logout",
  ]) {
    assert.equal(destination(path), null);
    assert.equal(worker.safeDestination(path, company), null);
  }
});
