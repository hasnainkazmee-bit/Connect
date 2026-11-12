import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pool } from "../apps/api/dist/db.js";
import {
  enrichmentBatch,
  importProviderEnrichment,
} from "../apps/api/dist/provider-enrichment.js";
if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Use an isolated test database");
const pilot = JSON.parse(
  await readFile(
    new URL(
      "../data/provider-enrichment/ohio-pilot-2026-11-12.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
test("additive publication preserves company facts and cannot activate job matching", async () => {
  const batch = structuredClone(pilot);
  batch.batchId = "source-publish-test-" + randomUUID();
  batch.records = batch.records.slice(0, 1);
  const r = batch.records[0];
  r.companyId = randomUUID();
  r.preserveProfile = true;
  r.profile = structuredClone(r.expectedProfile);
  r.research.reviewMethod = "source-check-v1";
  r.research.coverage = [];
  r.research.services.forEach((s) => (s.delivery = "unknown"));
  const b = r.expectedProfile;
  try {
    await pool.query(
      `INSERT INTO companies(id,slug,name,website,listing_status,description,tagline,services,service_areas) VALUES($1::uuid,$1::text,$2,$3,'unclaimed',$4,$5,$6,$7)`,
      [
        r.companyId,
        r.companyName,
        r.website,
        b.description,
        b.tagline,
        b.services,
        b.serviceAreas,
      ],
    );
    const before = (
      await pool.query(
        "SELECT to_jsonb(c) value FROM companies c WHERE id=$1",
        [r.companyId],
      )
    ).rows[0].value;
    assert.equal((await importProviderEnrichment(batch))[0].status, "ready");
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM provider_capabilities WHERE company_id=$1",
          [r.companyId],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (await importProviderEnrichment(batch, true))[0].status,
      "applied",
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT to_jsonb(c) value FROM companies c WHERE id=$1",
          [r.companyId],
        )
      ).rows[0].value,
      before,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT state FROM provider_matching_profiles WHERE company_id=$1",
          [r.companyId],
        )
      ).rows[0].state,
      "source_checked",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM provider_current_offerings WHERE company_id=$1",
          [r.companyId],
        )
      ).rowCount,
      0,
    );
    assert.ok(
      (
        await pool.query(
          "SELECT 1 FROM provider_offerings WHERE company_id=$1",
          [r.companyId],
        )
      ).rowCount > 0,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM provider_service_availability WHERE company_id=$1",
          [r.companyId],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (await importProviderEnrichment(batch, true))[0].status,
      "unchanged",
    );
    const bad = structuredClone(batch);
    bad.records[0].profile.description = "Overwrite";
    assert.equal(enrichmentBatch.safeParse(bad).success, false);
    delete bad.records[0].preserveProfile;
    assert.equal(enrichmentBatch.safeParse(bad).success, false);
    const product = structuredClone(batch);
    product.records[0].research.services = [];
    assert.equal(enrichmentBatch.safeParse(product).success, true);
  } finally {
    await pool.query("DELETE FROM companies WHERE id=$1", [r.companyId]);
    await pool.end();
  }
});
