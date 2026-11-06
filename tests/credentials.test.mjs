import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { credentialCatalog } from "../apps/api/dist/credential-catalog.js";
if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test"))
  throw new Error("Use an isolated test database.");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const base = process.env.API_TEST_URL || "http://localhost:4101";
function client() {
  let cookie = "";
  return async (path, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const session = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("connect_session="));
    if (session) cookie = session.split(";")[0];
    return { status: response.status, data: await response.json() };
  };
}
test("sourced credentials preserve ownership, evidence and import boundaries", async (t) => {
  const a = client(),
    b = client(),
    person = client(),
    anon = client();
  const suffix = randomUUID().slice(0, 8);
  const register = async (call, name, accountType = "company") => {
    const r = await call("/auth/register", {
      name,
      email: `${name}${suffix}@example.test`,
      password: "CredentialChecks123!",
      accountType,
      companyName: `${name} ${suffix}`,
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data;
  };
  const owner = await register(a, "CredentialOwner");
  await register(b, "OtherCredentialOwner");
  await register(person, "CredentialCustomer", "individual");
  const input = {
    category: "certification",
    title: "Model safety documentation",
    organization: "Example laboratory",
    scope: "product",
    scopeDetail: "Only Example-400 modules",
    description: "Model-specific evidence",
    sourceUrl: "https://example.test/certificate",
    period: "2026",
    validUntil: "2027-12-31",
  };
  let id;
  try {
    await t.test(
      "administrator submissions cannot claim operator review",
      async () => {
        for (const body of [
          { ...input, sourceUrl: "javascript:alert(1)" },
          { ...input, sourceUrl: "http://example.test" },
          { ...input, evidenceBasis: "issuer" },
          { ...input, checkedAt: "2026-11-06" },
          { ...input, validUntil: "2027-02-30" },
        ])
          assert.equal(
            (await a("/companies/current/credentials", body)).status,
            400,
          );
        assert.equal(
          (await person("/companies/current/credentials", input)).status,
          403,
        );
        assert.equal(
          (await anon("/companies/current/credentials", input)).status,
          401,
        );
        const created = await a("/companies/current/credentials", input);
        assert.equal(created.status, 201);
        id = created.data.id;
        assert.equal(created.data.valid_until, "2027-12-31");
        assert.equal(created.data.evidence_basis, "company");
        assert.equal(created.data.checked_at, null);
      },
    );
    await t.test(
      "public profile includes scoped evidence and company isolation holds",
      async () => {
        const profile = await anon(`/companies/${owner.activeCompanyId}`);
        const row = profile.data.credentials.find((item) => item.id === id);
        assert.equal(row.scope, "product");
        assert.equal(row.scope_detail, input.scopeDetail);
        assert.equal(row.source_url, input.sourceUrl);
        assert.equal(row.valid_until, "2027-12-31");
        assert.equal(
          (await b(`/companies/current/credentials/${id}`, input, "PATCH"))
            .status,
          404,
        );
        assert.equal(
          (await b(`/companies/current/credentials/${id}`, undefined, "DELETE"))
            .status,
          404,
        );
        assert.equal(
          (
            await a(
              `/companies/current/credentials/${id}`,
              { ...input, title: "Revised model documentation" },
              "PATCH",
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "catalog importer is a dry run by default, idempotent and protects sourced records",
      async () => {
        const company = (
          await db.query(
            "INSERT INTO companies(name,slug,username,website) VALUES($1,'all-energy-solar','all-energy-solar','https://www.allenergysolar.com/') ON CONFLICT(username) DO UPDATE SET website=excluded.website RETURNING id",
            ["Import fixture " + suffix],
          )
        ).rows[0];
        const runImport = (...args) => {
          const child = spawnSync(
            process.execPath,
            ["apps/api/dist/import-credentials.js", ...args],
            { env: process.env, encoding: "utf8" },
          );
          assert.equal(child.status, 0, child.stderr);
          return child.stdout;
        };
        const count = async () =>
          Number(
            (
              await db.query(
                "SELECT count(*) FROM company_credentials WHERE company_id=$1",
                [company.id],
              )
            ).rows[0].count,
          );
        const before = await count();
        runImport();
        assert.equal(await count(), before);
        runImport("--apply");
        const after = await count();
        assert.ok(after >= 2);
        runImport("--apply");
        assert.equal(await count(), after);
        const sourced = (
          await db.query(
            "SELECT * FROM company_credentials WHERE company_id=$1 AND catalog_key IS NOT NULL LIMIT 1",
            [company.id],
          )
        ).rows[0];
        await db.query(
          "UPDATE company_credentials SET title='Newer reviewed evidence',checked_at=now() WHERE id=$1",
          [sourced.id],
        );
        runImport("--apply");
        assert.equal(
          (
            await db.query(
              "SELECT title FROM company_credentials WHERE id=$1",
              [sourced.id],
            )
          ).rows[0].title,
          "Newer reviewed evidence",
        );
        // An operator-sourced record remains protected even for this company's owner.
        await db.query(
          "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING",
          [owner.user.id, company.id],
        );
        assert.equal(
          (await a("/session/company", { companyId: company.id })).status,
          200,
        );
        assert.equal(
          (
            await a(
              `/companies/current/credentials/${sourced.id}`,
              input,
              "PATCH",
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await a(
              `/companies/current/credentials/${sourced.id}`,
              undefined,
              "DELETE",
            )
          ).status,
          404,
        );
        await db.query(
          "UPDATE companies SET website='https://unrelated.example.test' WHERE id=$1",
          [company.id],
        );
        assert.match(runImport("--apply"), /missing or mismatched company/);
        assert.equal(await count(), after);
        await db.query(
          "UPDATE companies SET website='https://www.allenergysolar.com/' WHERE id=$1",
          [company.id],
        );
        await db.query(
          "DELETE FROM memberships WHERE user_id=$1 AND company_id=$2",
          [owner.user.id, company.id],
        );
        await a("/session/company", { companyId: owner.activeCompanyId });
        assert.equal(
          new Set(credentialCatalog.map((c) => c.company + ":" + c.key)).size,
          credentialCatalog.length,
        );
      },
    );
    await t.test("owner can delete their own record", async () => {
      assert.equal(
        (await a(`/companies/current/credentials/${id}`, undefined, "DELETE"))
          .status,
        200,
      );
      assert.equal(
        (await a(`/companies/current/credentials/${id}`, undefined, "DELETE"))
          .status,
        404,
      );
    });
  } finally {
    await db.end();
  }
});
