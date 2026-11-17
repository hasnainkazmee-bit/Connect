import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { once } from "node:events";
import { networkProxy } from "../apps/api/dist/network-proxy.js";
const listen = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
};
const close = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });
test("Network gateway preserves binary uploads and session, without trusting identity headers", async () => {
  let received;
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = {
      url: req.url,
      headers: req.headers,
      bytes: Buffer.concat(chunks),
    };
    res.writeHead(201, { "content-type": "application/json" });
    res.end('{"file":{"id":"local"}}');
  });
  process.env.JOBS_SERVICE_URL = await listen(upstream);
  const app = express();
  app.use("/api/network-v2", networkProxy);
  const gateway = http.createServer(app),
    base = await listen(gateway);
  try {
    const data = Buffer.from("%PDF-1.7\n\0\xff\n%%EOF", "latin1");
    const response = await fetch(base + "/api/network-v2/files?name=plan.pdf", {
      method: "POST",
      headers: {
        cookie: "connect_session=test-session",
        "content-type": "application/pdf",
        "x-user-id": "attacker",
        "x-company-id": "another-company",
      },
      body: data,
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).file.id, "local");
    assert.deepEqual(received.bytes, data);
    assert.equal(received.url, "/network-v2/files?name=plan.pdf");
    assert.equal(received.headers.cookie, "connect_session=test-session");
    assert.equal(received.headers["x-user-id"], undefined);
    assert.equal(received.headers["x-company-id"], undefined);
  } finally {
    await close(gateway);
    await close(upstream);
  }
});
test("Network gateway streams guarded file responses without caching or header loss", async () => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="plan.pdf"',
      "cache-control": "public, max-age=3600",
    });
    res.end("%PDF-1.7\n");
  });
  process.env.JOBS_SERVICE_URL = await listen(upstream);
  const app = express();
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api/network-v2", networkProxy);
  const gateway = http.createServer(app),
    base = await listen(gateway);
  try {
    const response = await fetch(
      base + "/api/network-v2/files/local?preview=1",
    );
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(
      response.headers.get("content-disposition"),
      'inline; filename="plan.pdf"',
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(await response.text(), /%PDF/);
  } finally {
    await close(gateway);
    await close(upstream);
  }
});
