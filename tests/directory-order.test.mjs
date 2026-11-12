import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../apps/api/dist/db.js";
import { directorySearch } from "../apps/api/dist/directory.js";

if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test"))
  throw new Error("Use an isolated test database.");

test("directory prefers companies on Connect without bypassing filters or duplicating pages", async () => {
  const marker = "connect-order-" + randomUUID();
  const ids = [],
    users = [];
  const company = async (
    name,
    {
      status = "unclaimed",
      type = "Installer",
      demo = false,
      logo = true,
    } = {},
  ) => {
    const id = randomUUID();
    ids.push(id);
    await pool.query(
      `INSERT INTO companies(id,slug,name,type,listing_status,is_demo,logo_url,description,services,service_areas)
       VALUES($1::uuid,$1::text,$2,$3,$4,$5,$6,'Solar installation and service in Ohio.',ARRAY['Installation'],ARRAY['Ohio'])`,
      [id, marker + " " + name, type, status, demo, logo ? "/logo.png" : ""],
    );
    return id;
  };
  const member = async (companyId) => {
    const id = randomUUID();
    users.push(id);
    await pool.query(
      "INSERT INTO users(id,email,name,password_hash,email_verified_at) VALUES($1,$2,'Directory ordering test','test',now())",
      [id, `directory-order-${id}@example.test`],
    );
    await pool.query(
      "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'owner')",
      [id, companyId],
    );
  };
  try {
    const joined = await company("Z Joined", {
      status: "managed",
      logo: false,
    });
    await member(joined);
    await member(joined);
    const memberless = await company("A Managed but no team", {
      status: "managed",
    });
    const unclaimedWithMember = await company("B Unclaimed with membership");
    await member(unclaimedWithMember);
    const demo = await company("C Demo", { status: "managed", demo: true });
    await member(demo);
    const joinedManufacturer = await company("Y Manufacturer", {
      status: "managed",
      type: "Manufacturer",
      logo: false,
    });
    await member(joinedManufacturer);
    const certified = await company("D Certified");
    await pool.query(
      `INSERT INTO company_credentials(company_id,category,title,scope,scope_detail,source_url,evidence_basis)
       VALUES($1,'certification','Ordering test certification','company','Test qualification','https://example.test','company')`,
      [certified],
    );
    for (let i = 0; i < 25; i++)
      await company(`E Unclaimed ${String(i).padStart(2, "0")}`);
    const first = await directorySearch({ q: marker });
    const second = await directorySearch({ q: marker, page: 2 });
    const ordered = [...first.companies, ...second.companies].map((c) => c.id);
    assert.equal(first.total, 30);
    assert.deepEqual(ordered.slice(0, 3), [
      joinedManufacturer,
      joined,
      certified,
    ]);
    assert.ok(ordered.indexOf(memberless) > ordered.indexOf(certified));
    assert.ok(
      ordered.indexOf(unclaimedWithMember) > ordered.indexOf(certified),
    );
    assert.ok(!ordered.includes(demo));
    assert.equal(ordered.length, 30);
    assert.equal(new Set(ordered).size, 30);
    const filtered = await directorySearch({ q: marker, type: "Installer" });
    assert.equal(filtered.total, 29);
    assert.equal(filtered.companies[0].id, joined);
    assert.ok(filtered.companies.every((c) => c.type === "Installer"));
    const certifiedOnly = await directorySearch({
      q: marker,
      certification: "Ordering test certification",
    });
    assert.deepEqual(
      certifiedOnly.companies.map((c) => c.id),
      [certified],
    );
  } finally {
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    await pool.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [ids]);
    await pool.end();
  }
});
