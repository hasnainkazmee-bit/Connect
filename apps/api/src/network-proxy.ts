import http from "node:http";
import type { RequestHandler } from "express";

// Network shares the authenticated session with the Rust jobs service. Never
// forward client-supplied identity headers; authorization is checked from the DB.
export const networkProxy: RequestHandler = (req, res) => {
  const target = new URL(
    process.env.JOBS_SERVICE_URL || "http://127.0.0.1:4201",
  );
  const headers: http.OutgoingHttpHeaders = {
    cookie: req.headers.cookie || "",
    "content-type": req.headers["content-type"] || "application/json",
  };
  for (const key of [
    "content-length",
    "x-file-name",
    "x-upload-id",
    "range",
    "if-none-match",
    "idempotency-key",
  ]) {
    if (req.headers[key]) headers[key] = req.headers[key];
  }
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: req.originalUrl.slice(4),
      headers,
      timeout: 120000,
    },
    (response) => {
      res.status(response.statusCode || 502);
      for (const key of [
        "content-type",
        "content-disposition",
        "content-length",
        "content-range",
        "accept-ranges",
        "etag",
      ]) {
        if (response.headers[key]) res.setHeader(key, response.headers[key]!);
      }
      response.on("error", () => res.destroy());
      response.pipe(res);
    },
  );
  upstream.on("timeout", () =>
    upstream.destroy(new Error("Network upstream timeout")),
  );
  upstream.on("error", () => {
    if (!res.headersSent)
      res
        .status(502)
        .json({
          error: "Network is temporarily unavailable. Please try again.",
        });
    else res.end();
  });
  req.on("aborted", () => upstream.destroy());
  res.on("close", () => {
    if (!res.writableFinished) upstream.destroy();
  });
  req.pipe(upstream);
};
