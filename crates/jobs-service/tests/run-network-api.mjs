// Starts only an isolated test service, then cleans up its process and uploads.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
const database = new URL(process.env.DATABASE_URL || "postgres://invalid");
assert.ok(
  ["localhost", "127.0.0.1"].includes(database.hostname) &&
    database.pathname.includes("test"),
  "Use an isolated local test database.",
);
const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const uploads = await mkdtemp(join(tmpdir(), "colabb-network-api-"));
const base = `http://127.0.0.1:${port}`;
const server = spawn("./target/debug/connect-jobs", [], {
  env: {
    ...process.env,
    JOBS_BIND: `127.0.0.1:${port}`,
    JOBS_UPLOAD_DIR: uploads,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (chunk) => {
  logs = (logs + chunk).slice(-8000);
});
server.stderr.on("data", (chunk) => {
  logs = (logs + chunk).slice(-8000);
});
const ended = once(server, "exit");
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null)
      throw Error("Jobs test service exited: " + logs);
    try {
      if (
        (await fetch(base + "/health", { signal: AbortSignal.timeout(1000) }))
          .ok
      ) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "Jobs test service did not start: " + logs);
  const test = spawn(
    process.execPath,
    ["crates/jobs-service/tests/network-api.mjs"],
    { env: { ...process.env, JOBS_TEST_URL: base }, stdio: "inherit" },
  );
  const [code] = await once(test, "exit");
  assert.equal(code, 0, "Network API tests failed.");
} finally {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await ended;
  }
  await rm(uploads, { recursive: true, force: true });
}
