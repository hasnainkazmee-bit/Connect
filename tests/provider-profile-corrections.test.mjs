import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
  await readFile("data/provider-enrichment/ohio-pilot-2026-11-12.json", "utf8"),
);
test("sourced profile corrections preserve unknown coverage and cannot activate job matching", async () => {
  const batch = structuredClone(pilot);
  batch.batchId = "profile-correction-" + randomUUID();
  batch.records = batch.records.slice(0, 1);
  const r = batch.records[0];
  r.companyId = randomUUID();
  r.preserveServiceAreas = true;
  r.research.reviewMethod = "source-check-v2";
  r.research.coverage = [];
  r.profile.serviceAreas = structuredClone(r.expectedProfile.serviceAreas);
  r.research.projectTypes = r.profile.projectTypes.map((label) => ({
    label,
    sourceIds: r.research.summarySourceIds,
  }));
  const p = r.expectedProfile;
  try {
    await pool.query(
      `INSERT INTO companies(id,slug,name,website,listing_status,description,tagline,services,service_areas)
    VALUES($1::uuid,$1::text,$2,$3,'unclaimed',$4,$5,$6,$7)`,
      [
        r.companyId,
        r.companyName,
        r.website,
        p.description,
        p.tagline,
        p.services,
        p.serviceAreas,
      ],
    );
    await pool.query(
      `INSERT INTO provider_profiles(company_id,availability,license_details) VALUES($1,'Owner schedule','Owner licence')`,
      [r.companyId],
    );
    assert.equal(enrichmentBatch.safeParse(batch).success, true);
    for (const change of [
      (x) => x.profile.serviceAreas.push("Nationwide"),
      (x) => x.profile.services.push("Unsupported service"),
      (x) => x.profile.projectTypes.push("Unsupported project"),
      (x) => (x.research.projectTypes[0].sourceIds = ["unknown-source"]),
      (x) => {
        delete x.research.projectTypes;
      },
      (x) => {
        x.profile.type = "Contractor";
        x.expectedProfile.type = "Installer";
      },
    ]) {
      const b = structuredClone(batch);
      change(b.records[0]);
      assert.equal(enrichmentBatch.safeParse(b).success, false);
    }
    assert.equal((await importProviderEnrichment(batch))[0].status, "ready");
    assert.equal(
      (
        await pool.query("SELECT description FROM companies WHERE id=$1", [
          r.companyId,
        ])
      ).rows[0].description,
      p.description,
    );
    assert.equal(
      (await importProviderEnrichment(batch, true))[0].status,
      "applied",
    );
    const c = (
      await pool.query(
        "SELECT description,services,service_areas FROM companies WHERE id=$1",
        [r.companyId],
      )
    ).rows[0];
    assert.equal(c.description, r.profile.description);
    assert.deepEqual(c.services, r.profile.services);
    assert.deepEqual(c.service_areas, p.serviceAreas);
    const profile = (
      await pool.query("SELECT * FROM provider_profiles WHERE company_id=$1", [
        r.companyId,
      ])
    ).rows[0];
    assert.deepEqual(profile.project_types, r.profile.projectTypes);
    assert.equal(profile.availability, "Owner schedule");
    assert.equal(profile.license_details, "Owner licence");
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
    assert.equal(
      (await importProviderEnrichment(batch, true))[0].status,
      "unchanged",
    );
  } finally {
    await pool.query("DELETE FROM companies WHERE id=$1", [r.companyId]);
    await pool.end();
  }
});
