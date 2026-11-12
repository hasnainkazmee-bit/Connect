import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import dotenv from "dotenv";
const url = new URL(
  process.env.TEST_DATABASE_URL ||
    "postgres://sunhub:sunhub_local@localhost:5438/sunhub_community_test",
);
const dbName = url.pathname.slice(1);
if (!/^[a-z0-9_]+_test$/.test(dbName))
  throw new Error(
    "TEST_DATABASE_URL must use a dedicated database ending in _test.",
  );
const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";
const admin = new pg.Pool({ connectionString: adminUrl.href });
if (
  !(await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [dbName]))
    .rowCount
)
  await admin.query('CREATE DATABASE "' + dbName + '"');
await admin.end();
const uploads = await fs.mkdtemp(
  path.join(os.tmpdir(), "sunhub-community-test-"),
);
const env = {
  ...process.env,
  DATABASE_URL: url.href,
  PORT: "4101",
  APP_ORIGIN: "http://localhost:4101",
  API_TEST_URL: "http://localhost:4101",
  UPLOAD_DIR: uploads,
  NODE_ENV: "test",
  REQUIRE_EMAIL_VERIFICATION: "false",
  AUTH_TOKEN_SECRET: "connect-isolated-test-secret-not-for-production-2026",
  CONNECT_SUNHUB_SYNC_TOKEN: "connect-sunhub-test-token-only-2026-11-09",
  STORAGE_BACKEND: "local",
  SMTP_HOST: "",
  WEB_PUSH_PUBLIC_KEY: "",
  WEB_PUSH_PRIVATE_KEY: "",
  FIREBASE_SERVICE_ACCOUNT_FILE: "",
  PUSH_WORKER_DISABLED: "true",
};
const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(cmd + " exited " + code)),
    );
  });
await run(process.execPath, ["apps/api/dist/migrate.js"]);
let server;
async function startServer() {
  server = spawn(process.execPath, ["apps/api/dist/server.js"], {
    env,
    stdio: "inherit",
  });
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(env.API_TEST_URL + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await wait(200);
  }
  if (!ready) throw new Error("Test API did not become ready.");
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const stopped = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await stopped;
}
try {
  for (const suite of [
    "tests/api.test.mjs",
    "tests/social.test.mjs",
    "tests/message-requests.test.mjs",
    "tests/accounts.test.mjs",
    "tests/session-persistence.test.mjs",
    "tests/sunhub-sso.test.mjs",
    "tests/publishing-profiles.test.mjs",
    "tests/directory.test.mjs",
    "tests/sunhub-integration.test.mjs",
    "tests/credentials.test.mjs",
    "tests/credential-batches.test.mjs",
    "tests/provider-enrichment.test.mjs",
    "tests/notifications.test.mjs",
  ]) {
    env.REQUIRE_EMAIL_VERIFICATION =
      suite === "tests/accounts.test.mjs" ? "true" : "false";
    env.SUNHUB_SSO_ISSUER =
      suite === "tests/sunhub-sso.test.mjs" ? "http://127.0.0.1:4103" : "";
    await startServer();
    await run(process.execPath, ["--test", suite]);
    await stopServer();
  }
  env.REQUIRE_EMAIL_VERIFICATION = "false";
  env.SUNHUB_SSO_ISSUER = "";
  if (process.argv.includes("--services")) {
    // Earlier API suites intentionally queue mail with SMTP disabled. Delivery
    // scenarios start with their own outbox in this dedicated test database.
    const mailDb = new pg.Pool({ connectionString: url.href });
    await mailDb.query("DELETE FROM email_outbox WHERE sent_at IS NULL");
    await mailDb.end();
    const local = dotenv.parse(await fs.readFile(".env"));
    const saved = { ...env };
    for (const key of [
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_REQUIRE_TLS",
      "MAIL_FROM",
    ])
      env[key] = local[key];
    env.STORAGE_BACKEND = "s3";
    env.REQUIRE_EMAIL_VERIFICATION = "true";
    await startServer();
    await run(process.execPath, ["--test", "tests/services.test.mjs"]);
    env.CONNECT_ACCOUNT_E2E = "true";
    await run(process.execPath, [
      "node_modules/@playwright/test/cli.js",
      "test",
      "tests/browser/account-onboarding.spec.ts",
    ]);
    env.CONNECT_ACCOUNT_E2E = "false";
    await stopServer();
    Object.assign(env, saved);
  }
  if (process.argv.includes("--ui")) {
    // Each independent browser suite gets a fresh rate-limit window. Recovery
    // tests deliberately sign in repeatedly; production limits stay unchanged.
    const suites = (await fs.readdir("tests/browser"))
      .filter((name) => name.endsWith(".spec.ts"))
      .sort();
    for (const suite of suites) {
      await startServer();
      await run(process.execPath, [
        "node_modules/@playwright/test/cli.js",
        "test",
        "tests/browser/" + suite,
        "--output=test-results/browser/" + suite.replace(".spec.ts", ""),
      ]);
      await stopServer();
    }
  }
  if (process.argv.includes("--rust")) {
    await startServer();
    await run("cargo", [
      "test",
      "-p",
      "sunhub-mobile-core",
      "--test",
      "api",
      "--",
      "--ignored",
    ]);
    await stopServer();
  }
  if (process.argv.includes("--android")) {
    await startServer();
    await run("apps/android/with-local-tools.sh", [
      "./gradlew",
      "connectedDebugAndroidTest",
      "-PsunhubApiUrl=http://10.0.2.2:4101",
      "--console=plain",
      ...(process.env.CONNECT_ANDROID_INIT_SCRIPT
        ? [
            "--init-script",
            process.env.CONNECT_ANDROID_INIT_SCRIPT,
            "--no-daemon",
          ]
        : []),
      ...(process.env.ANDROID_EVENT_POLLING === "true"
        ? ["-PsunhubEventPolling=true"]
        : []),
    ]);
  }
} finally {
  await stopServer();
  await fs.rm(uploads, { recursive: true, force: true });
}
