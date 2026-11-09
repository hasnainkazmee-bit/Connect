import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const base = process.env.API_TEST_URL || "http://localhost:4101";
const token = process.env.CONNECT_SUNHUB_SYNC_TOKEN;
if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test"))
  throw new Error("Use an isolated test database.");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function snapshot(headers = {}, query = "") {
  const response = await fetch(
    `${base}/api/integrations/sunhub/companies${query}`,
    { headers },
  );
  return { status: response.status, body: await response.json() };
}

async function findCompany(id) {
  let cursor = "";
  for (let page = 0; page < 100; page++) {
    const result = await snapshot(
      { Authorization: `Bearer ${token}` },
      `?limit=200${cursor ? `&after=${cursor}` : ""}`,
    );
    assert.equal(result.status, 200);
    const row = result.body.companies.find((item) => item.companyId === id);
    if (row) return row;
    cursor = result.body.nextCursor;
    if (!cursor) break;
  }
  assert.fail("Fixture company missing from integration snapshot.");
}

test("Sunhub claim feed is private, paged and distinguishes claim progress", async () => {
  const id = randomUUID();
  const userId = randomUUID();
  const suffix = id.slice(0, 8);
  const username = `integration-${suffix}`;
  try {
    await db.query(
      "INSERT INTO companies(id,slug,username,name,website,listing_status) VALUES($1,$2,$2,$3,$4,'unclaimed')",
      [id, username, `Integration ${suffix}`, `https://${suffix}.example.test`],
    );
    await db.query(
      "INSERT INTO company_claim_domains(company_id,domain,source_url) VALUES($1,$2,$3)",
      [id, `${suffix}.example.test`, `https://${suffix}.example.test`],
    );
    assert.equal((await snapshot()).status, 401);
    assert.equal(
      (await snapshot({ Authorization: "Bearer wrong-test-token" })).status,
      401,
    );
    assert.equal(
      (await snapshot({ Authorization: `Bearer ${token}` }, "?limit=201"))
        .status,
      400,
    );
    const unclaimed = await findCompany(id);
    assert.equal(unclaimed.claimStatus, "unclaimed");
    assert.equal(unclaimed.claimantEmail, null);
    assert.deepEqual(unclaimed.domains, [`${suffix}.example.test`]);
    assert.equal(
      unclaimed.claimUrl,
      `${process.env.APP_ORIGIN}/claim/${username}`,
    );
    assert.ok(!("password_hash" in unclaimed));

    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,'test-only')",
      [userId, `person-${suffix}@${suffix}.example.test`, "Claim Tester"],
    );
    await db.query(
      "INSERT INTO company_claims(company_id,user_id,method,status) VALUES($1,$2,'work_email','pending')",
      [id, userId],
    );
    const pending = await findCompany(id);
    assert.equal(pending.claimStatus, "pending");
    assert.ok(pending.claimRequestedAt);
    assert.equal(
      pending.claimantEmail,
      `person-${suffix}@${suffix}.example.test`,
    );

    await db.query(
      "UPDATE company_claims SET status='approved',reviewed_at=now() WHERE company_id=$1",
      [id],
    );
    await db.query(
      "UPDATE companies SET listing_status='managed',ownership_verified_at=now() WHERE id=$1",
      [id],
    );
    const claimed = await findCompany(id);
    assert.equal(claimed.claimStatus, "claimed");
    assert.ok(claimed.claimedAt);
    assert.equal(claimed.claimRequestedAt, null);
  } finally {
    await db.query("DELETE FROM companies WHERE id=$1", [id]);
    await db.query("DELETE FROM users WHERE id=$1", [userId]);
    await db.end();
  }
});
