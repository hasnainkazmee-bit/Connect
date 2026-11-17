import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  companyTypes,
  companyTypeValues,
} from "../apps/api/dist/shared/company-types.js";

if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test"))
  throw new Error("Use an isolated test database.");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const base = (process.env.API_TEST_URL || "http://localhost:4101") + "/api";
function client() {
  let cookie = "";
  return async (path, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const session = response.headers
      .getSetCookie()
      .find((v) => v.startsWith("connect_session="));
    if (session) cookie = session.split(";")[0];
    return { status: response.status, data: await response.json() };
  };
}

test("business types cover the solar ecosystem without inferring installation work", async (t) => {
  const suffix = randomUUID().slice(0, 8);
  const companies = [];
  const users = [];
  const a = client();
  const register = async (call, label, extra = {}) => {
    const response = await call("/auth/register", {
      name: "Business Type Tester",
      email: `business-types-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}@example.test`,
      password: "BusinessTypesTest123!",
      companyName: `Business Types ${label} ${suffix}`,
      ...extra,
    });
    if (response.status === 201) {
      users.push(response.data.user.id);
      companies.push(response.data.activeCompanyId);
    }
    return response;
  };
  const profile = (company, type = company.type) => ({
    name: company.name,
    type,
    tagline: "Working across the solar industry",
    description: "",
    location: "Cleveland, OH",
    services: [],
    service_areas: [],
    website: "",
    employee_count: "",
    established: null,
  });
  try {
    const registration = await register(a, "Legacy");
    assert.equal(registration.status, 201, JSON.stringify(registration.data));
    const initial = registration.data.companies.find(
      (c) => c.id === registration.data.activeCompanyId,
    );

    await t.test(
      "name-only signup remains unclassified and unrelated edits preserve it",
      async () => {
        assert.equal(initial.type, "");
        assert.equal(
          (await a("/companies/current/profile", profile(initial), "PATCH"))
            .status,
          200,
        );
        assert.equal(
          (await a("/companies/current", profile(initial), "PATCH")).status,
          200,
        );
        const created = await a("/companies", {
          name: `Business Types Name Only ${suffix}`,
        });
        assert.equal(created.status, 201);
        companies.push(created.data.id);
        assert.equal(created.data.type, "");
        const connection = await db.connect();
        try {
          await connection.query("BEGIN");
          const row = (
            await connection.query(
              "INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING type",
              [`Default check ${suffix}`, `business-default-${suffix}`],
            )
          ).rows[0];
          assert.equal(
            row.type,
            "",
            "the database must not default to Installer",
          );
        } finally {
          await connection.query("ROLLBACK");
          connection.release();
        }
      },
    );

    await t.test(
      "every catalog type persists and is discoverable by its exact filter",
      async () => {
        assert.equal(companyTypes.length, 15);
        assert.equal(new Set(companyTypeValues).size, companyTypes.length);
        for (const type of companyTypeValues) {
          const created = await a("/companies", {
            name: `Business Types ${type} ${suffix}`,
            type,
          });
          assert.equal(created.status, 201, JSON.stringify(created.data));
          companies.push(created.data.id);
          assert.equal(created.data.type, type);
          const found = await a(
            `/companies?q=${suffix}&type=${encodeURIComponent(type)}`,
          );
          assert.equal(found.status, 200);
          assert.ok(found.data.companies.some((c) => c.id === created.data.id));
          assert.ok(found.data.companies.every((c) => c.type === type));
          const publicProfile = await a(`/companies/${created.data.id}`);
          assert.equal(publicProfile.data.company.type, type);
        }
      },
    );

    await t.test(
      "all profile and onboarding writers accept the new categories",
      async () => {
        const current = (await a("/session")).data.companies.find(
          (c) => c.id === companies.at(-1),
        );
        for (const type of companyTypeValues.slice(7)) {
          assert.equal(
            (
              await a(
                "/companies/current/profile",
                profile(current, type),
                "PATCH",
              )
            ).status,
            200,
          );
          assert.equal(
            (await a("/companies/current", profile(current, type), "PATCH"))
              .status,
            200,
          );
          const onboarded = await a("/onboarding/company", {
            name: current.name,
            type,
            location: "Cleveland, OH",
          });
          assert.equal(onboarded.status, 200, JSON.stringify(onboarded.data));
          assert.equal(
            onboarded.data.companies.find((c) => c.id === current.id).type,
            type,
          );
        }
        const typedSignup = await register(client(), "Technology Signup", {
          type: "Technology provider",
        });
        assert.equal(typedSignup.status, 201, JSON.stringify(typedSignup.data));
        assert.equal(typedSignup.data.companies[0].type, "Technology provider");
      },
    );

    await t.test(
      "an explicit blank or unknown choice is rejected across creation and editing",
      async () => {
        const session = (await a("/session")).data;
        const current = session.companies.find(
          (c) => c.id === session.activeCompanyId,
        );
        for (const type of ["", "Installer-ish", "technology provider", 123]) {
          assert.equal(
            (await a("/companies", { name: `Invalid Type ${suffix}`, type }))
              .status,
            400,
          );
          assert.equal(
            (
              await a(
                "/companies/current/profile",
                profile(current, type),
                "PATCH",
              )
            ).status,
            400,
          );
          assert.equal(
            (await a("/companies/current", profile(current, type), "PATCH"))
              .status,
            400,
          );
          assert.equal(
            (
              await a("/onboarding/company", {
                name: current.name,
                type,
                location: "Cleveland, OH",
              })
            ).status,
            400,
          );
          assert.equal(
            (await register(client(), `Invalid ${String(type)}`, { type }))
              .status,
            400,
          );
        }
        assert.equal(
          (
            await a("/onboarding/company", {
              name: current.name,
              location: "Cleveland, OH",
            })
          ).status,
          400,
        );
      },
    );

    await t.test(
      "legacy classifications survive unrelated edits but cannot be assigned to another value",
      async () => {
        const session = (await a("/session")).data;
        const current = session.companies.find(
          (c) => c.id === session.activeCompanyId,
        );
        await db.query(
          "UPDATE companies SET type='Legacy advisory business' WHERE id=$1",
          [current.id],
        );
        assert.equal(
          (
            await a(
              "/companies/current/profile",
              profile(current, "Legacy advisory business"),
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await a(
              "/companies/current",
              profile(current, "Legacy advisory business"),
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await a(
              "/companies/current/profile",
              profile(current, "Different legacy business"),
              "PATCH",
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await a(
              "/companies/current/profile",
              profile(current, "Technology provider"),
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await a(
              "/companies/current/profile",
              profile(current, "Legacy advisory business"),
              "PATCH",
            )
          ).status,
          400,
        );
      },
    );
  } finally {
    await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [
      companies,
    ]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    await db.end();
  }
});
