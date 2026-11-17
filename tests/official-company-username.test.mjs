import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { ZodError } from "zod";
import { pool, HttpError } from "../apps/api/dist/db.js";
import {
  claimUsername,
  ensureUsername,
  profileRoutes,
  usernameSchema,
} from "../apps/api/dist/profiles.js";

// Exercise the actual profile routes with synthetic sessions and an in-memory
// query stub. No database connection or production session is used by this test.
test("the official Colabb username is limited to its configured company", async (t) => {
  const officialId = randomUUID();
  const otherId = randomUUID();
  const originalOfficialId = process.env.COLABB_OFFICIAL_COMPANY_ID;
  const originalVerification = process.env.REQUIRE_EMAIL_VERIFICATION;
  process.env.COLABB_OFFICIAL_COMPANY_ID = officialId;
  process.env.REQUIRE_EMAIL_VERIFICATION = "true";
  const queries = [];
  let taken = false;
  const query = async (sql, values = []) => {
    queries.push({ sql, values });
    const rows = sql.startsWith("SELECT 1 FROM companies")
      ? taken
        ? [{ present: 1 }]
        : []
      : sql.startsWith("SELECT type,services")
        ? [
            {
              type: "Service provider",
              services: [],
              service_areas: [],
              website: "",
              employee_count: "",
            },
          ]
        : [];
    return { rows, rowCount: rows.length };
  };
  const db = { query, release() {} };
  t.mock.method(pool, "query", query);
  t.mock.method(pool, "connect", async () => db);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const companyId = req.get("test-company");
    if (companyId)
      req.auth = {
        companyId,
        userId: randomUUID(),
        role: req.get("test-role") || "owner",
        emailVerified: req.get("test-verified") !== "false",
      };
    next();
  });
  app.use(profileRoutes());
  app.use((error, _req, res, _next) => {
    res
      .status(error instanceof ZodError ? 400 : error.status || 500)
      .json({ message: error.message });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, companyId, body, method = "GET", headers = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(companyId ? { "test-company": companyId } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  const profile = {
    name: "Colabb",
    username: "colabb",
    tagline: "The working network for solar",
    description: "",
    type: "Service provider",
    location: "",
    services: [],
    service_areas: [],
    website: "",
    employee_count: "",
    established: null,
  };

  try {
    await t.test(
      "general validation, imports, and unauthenticated claims remain strict",
      async () => {
        assert.equal(usernameSchema.safeParse("colabb").success, false);
        assert.equal(usernameSchema.safeParse("sunhub").success, false);
        queries.length = 0;
        await assert.rejects(claimUsername(db, officialId, "colabb"), ZodError);
        await assert.rejects(
          claimUsername(db, otherId, "colabb", officialId),
          ZodError,
        );
        await assert.rejects(
          claimUsername(db, officialId, "colabb", otherId),
          ZodError,
        );
        await assert.rejects(
          claimUsername(db, officialId, "admin", officialId),
          ZodError,
        );
        assert.equal(
          queries.length,
          0,
          "invalid claims must not reach storage",
        );
      },
    );
    await t.test(
      "availability follows the authenticated company and fails closed without valid configuration",
      async () => {
        assert.deepEqual(await call("/usernames/ColAbb", officialId), {
          status: 200,
          data: { username: "colabb", available: true },
        });
        assert.equal((await call("/usernames/colabb", otherId)).status, 400);
        assert.equal((await call("/usernames/colabb")).status, 400);
        for (const config of [undefined, "", "not-a-company-id", otherId]) {
          if (config === undefined)
            delete process.env.COLABB_OFFICIAL_COMPANY_ID;
          else process.env.COLABB_OFFICIAL_COMPANY_ID = config;
          assert.equal(
            (await call("/usernames/colabb", officialId)).status,
            400,
          );
          await assert.rejects(
            claimUsername(db, officialId, "colabb", officialId),
            ZodError,
          );
        }
        process.env.COLABB_OFFICIAL_COMPANY_ID = officialId;
      },
    );
    await t.test(
      "the username setter retains owner, verification, and tenant checks",
      async () => {
        queries.length = 0;
        assert.deepEqual(
          await call(
            "/companies/current/username",
            officialId,
            { username: " ColAbb " },
            "PUT",
          ),
          { status: 200, data: { username: "colabb" } },
        );
        assert.ok(
          queries.some(
            (q) =>
              q.sql.startsWith("UPDATE companies SET username") &&
              q.values[0] === "colabb" &&
              q.values[1] === officialId,
          ),
        );
        assert.equal(
          (
            await call(
              "/companies/current/username",
              otherId,
              { username: "colabb", companyId: officialId },
              "PUT",
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              "/companies/current/username",
              officialId,
              { username: "colabb" },
              "PUT",
              { "test-role": "member" },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call(
              "/companies/current/username",
              officialId,
              { username: "colabb" },
              "PUT",
              { "test-verified": "false" },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call(
              "/companies/current/username",
              undefined,
              { username: "colabb" },
              "PUT",
            )
          ).status,
          401,
        );
        for (const reserved of ["sunhub", "admin", "support", "network"])
          assert.equal(
            (
              await call(
                "/companies/current/username",
                officialId,
                { username: reserved },
                "PUT",
              )
            ).status,
            400,
          );
      },
    );
    await t.test(
      "profile editing accepts only the same official company and preserves active-company protection",
      async () => {
        assert.equal(
          (
            await call(
              "/companies/current/profile",
              officialId,
              { ...profile, expectedCompanyId: officialId },
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await call(
              "/companies/current/profile",
              otherId,
              { ...profile, expectedCompanyId: officialId },
              "PATCH",
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              "/companies/current/profile",
              officialId,
              { ...profile, expectedCompanyId: otherId },
              "PATCH",
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await call(
              "/companies/current/profile",
              officialId,
              { ...profile, username: "support" },
              "PATCH",
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              "/companies/current/profile",
              otherId,
              {
                ...profile,
                name: "Another company",
                username: "another-company",
              },
              "PATCH",
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "existing owners and username history still prevent assignment",
      async () => {
        taken = true;
        queries.length = 0;
        assert.deepEqual(await call("/usernames/colabb", officialId), {
          status: 200,
          data: { username: "colabb", available: false },
        });
        assert.equal(
          (
            await call(
              "/companies/current/username",
              officialId,
              { username: "colabb" },
              "PUT",
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await call(
              "/companies/current/profile",
              officialId,
              profile,
              "PATCH",
            )
          ).status,
          409,
        );
        await assert.rejects(
          claimUsername(db, officialId, "colabb", officialId),
          (error) => error instanceof HttpError && error.status === 409,
        );
        assert.ok(
          queries.some(
            (q) =>
              q.sql.includes("company_username_history") &&
              q.sql.includes("slug=$1"),
          ),
        );
        assert.ok(!queries.some((q) => q.sql.startsWith("UPDATE companies")));
        taken = false;
      },
    );
    await t.test(
      "automatic naming never takes the reserved brand even for the official company",
      async () => {
        for (const companyId of [officialId, otherId]) {
          queries.length = 0;
          assert.equal(
            await ensureUsername(db, companyId, "Colabb"),
            "colabb-company",
          );
          assert.ok(
            !queries.some(
              (q) =>
                q.sql.startsWith("UPDATE companies SET username") &&
                q.values[0] === "colabb",
            ),
          );
        }
      },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (originalOfficialId === undefined)
      delete process.env.COLABB_OFFICIAL_COMPANY_ID;
    else process.env.COLABB_OFFICIAL_COMPANY_ID = originalOfficialId;
    if (originalVerification === undefined)
      delete process.env.REQUIRE_EMAIL_VERIFICATION;
    else process.env.REQUIRE_EMAIL_VERIFICATION = originalVerification;
    t.mock.restoreAll();
    await pool.end();
  }
});
