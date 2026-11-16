import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";

const release = "local-notice-regression-current";
let server: Server;
let origin: string;

test.beforeAll(async () => {
  // A normal development bundle deliberately disables release notices. Bundle
  // the actual component in memory with a synthetic release, without touching
  // the app dist folder or modifying its behavior to expose a test-only state.
  const appRoot = path.resolve("apps/colabb");
  const entry = "virtual:colabb-update-notice-test";
  const result = await build({
    configFile: false,
    root: appRoot,
    logLevel: "error",
    define: { "import.meta.env.VITE_CONNECT_RELEASE": JSON.stringify(release) },
    esbuild: { jsx: "automatic" },
    plugins: [{
      name: "colabb-update-notice-test-entry",
      resolveId(id) { if (id === entry) return "\0" + entry; },
      load(id) {
        if (id !== "\0" + entry) return;
        return `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import ${JSON.stringify(path.join(appRoot, "src/brand/foundation.css"))};
          import ${JSON.stringify(path.join(appRoot, "src/brand/colabb.css"))};
          import ${JSON.stringify(path.join(appRoot, "src/brand/settings.css"))};
          import ${JSON.stringify(path.join(appRoot, "src/brand/notices.css"))};
          import { WebUpdateNotice } from ${JSON.stringify(path.join(appRoot, "src/app-updates.tsx"))};
          createRoot(document.getElementById('root')).render(React.createElement(WebUpdateNotice));
        `;
      },
    }],
    build: {
      write: false,
      copyPublicDir: false,
      rollupOptions: { input: entry, output: { entryFileNames: "notice.js" } },
    },
  });
  if (Array.isArray(result) || !("output" in result)) throw Error("Expected one notice test bundle.");
  const files = new Map(result.output.map(file => [
    "/" + file.fileName,
    { data: file.type === "chunk" ? file.code : file.source, mime: file.fileName.endsWith(".css") ? "text/css" : "text/javascript" },
  ]));
  const styles = [...files.keys()].filter(name => name.endsWith(".css"));
  const font = await readFile(path.join(appRoot, "public/brand/fonts/Manrope-Variable.ttf"));
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Colabb update notice regression</title>${styles.map(name => `<link rel="stylesheet" href="${name}">`).join("")}</head><body><div id="root"></div><script type="module" src="/notice.js"></script></body></html>`;
  server = createServer((request, response) => {
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    const asset = files.get(pathname);
    response.setHeader("Cache-Control", "no-store");
    if (pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(html);
    } else if (asset) {
      response.setHeader("Content-Type", asset.mime);
      response.end(asset.data);
    } else if (pathname === "/brand/fonts/Manrope-Variable.ttf") {
      response.setHeader("Content-Type", "font/ttf");
      response.end(font);
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Expected a local test server.");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

for (const width of [1440, 390, 320]) {
  test(`Colabb refresh notice remains readable and actionable at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    let serverRelease = release;
    let healthChecks = 0;
    await page.route("**/api/health", async route => {
      healthChecks++;
      await route.fulfill({ json: { ok: true, release: serverRelease } });
    });
    await page.goto(origin);
    await expect.poll(() => healthChecks).toBeGreaterThan(0);
    const notice = page.getByRole("status");
    await expect(notice).toHaveCount(0);

    serverRelease = "local-notice-regression-next";
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(notice).toBeVisible();
    await expect(notice.getByText("A new Colabb is ready", { exact: true })).toBeVisible();
    await expect(notice.getByText("Refresh for the latest improvements.", { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const layout = await notice.evaluate(element => {
      const title = element.querySelector("strong")!;
      const detail = element.querySelector(".web-update-copy > span")!;
      const refresh = element.querySelector(".web-update-refresh")!;
      const close = element.querySelector(".update-dismiss")!;
      return {
        notice: element.getBoundingClientRect().toJSON(),
        title: title.getBoundingClientRect().toJSON(),
        detail: detail.getBoundingClientRect().toJSON(),
        refresh: refresh.getBoundingClientRect().toJSON(),
        close: close.getBoundingClientRect().toJSON(),
        titleWeight: Number(getComputedStyle(title).fontWeight),
        titleColor: getComputedStyle(title).color,
        detailColor: getComputedStyle(detail).color,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    expect(layout.title.bottom).toBeLessThanOrEqual(layout.detail.top);
    expect(layout.titleWeight).toBeGreaterThanOrEqual(700);
    expect(layout.titleColor).not.toBe(layout.detailColor);
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.notice.left).toBeGreaterThanOrEqual(0);
    expect(layout.notice.right).toBeLessThanOrEqual(width);
    for (const rect of [layout.title, layout.detail, layout.refresh, layout.close]) {
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.left).toBeGreaterThanOrEqual(layout.notice.left);
      expect(rect.right).toBeLessThanOrEqual(layout.notice.right);
      expect(rect.bottom).toBeLessThanOrEqual(layout.notice.bottom);
    }
    if (width <= 600) expect(layout.refresh.top).toBeGreaterThanOrEqual(layout.detail.bottom);
    else expect(layout.refresh.left).toBeGreaterThanOrEqual(layout.detail.right);
    await page.screenshot({ path: testInfo.outputPath(`refresh-notice-${width}.png`) });

    await notice.getByRole("button", { name: "Remind me later" }).click();
    await expect(notice).toHaveCount(0);
    const checksBeforeDismissedRecheck = healthChecks;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => healthChecks).toBeGreaterThan(checksBeforeDismissedRecheck);
    await expect(notice).toHaveCount(0);

    // A newer release may notify again; Refresh uses an actual page reload.
    serverRelease = "local-notice-regression-following";
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(notice).toBeVisible();
    await Promise.all([
      page.waitForEvent("load"),
      notice.getByRole("button", { name: "Refresh", exact: true }).click(),
    ]);
    await expect(notice).toBeVisible();
    expect(errors).toEqual([]);
  });
}
