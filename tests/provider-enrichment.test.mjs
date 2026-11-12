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
  throw new Error("Use an isolated test database.");
const pilot = JSON.parse(
  await readFile(
    new URL(
      "../data/provider-enrichment/ohio-pilot-2026-11-12.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("provider research preserves evidence, company control, scoped coverage and import boundaries", async (t) => {
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const memberId = randomUUID();
  const batch = structuredClone(pilot);
  batch.batchId = "provider-enrichment-test-" + randomUUID();
  batch.records = batch.records
    .slice(0, 2)
    .map((r, i) => ({ ...r, companyId: ids[i] }));
  for (const r of batch.records) {
    const p = r.expectedProfile;
    await pool.query(
      `INSERT INTO companies(id,slug,username,name,website,listing_status,description,tagline,services,service_areas,location)
      VALUES($1,$2,$2,$3,$4,'unclaimed',$5,$6,$7,$8,'Ohio')`,
      [
        r.companyId,
        "provider-test-" + r.companyId.slice(0, 8),
        r.companyName,
        r.website,
        p.description,
        p.tagline,
        p.services,
        p.serviceAreas,
      ],
    );
  }
  await pool.query(
    "INSERT INTO companies(id,slug,name,description) VALUES($1::uuid,$1::text,'Unrelated fixture','Keep me unchanged')",
    [ids[2]],
  );
  await pool.query(
    "INSERT INTO provider_profiles(company_id,availability,crew_size,license_details) VALUES($1,'Owner schedule','Do not infer crews','Keep license')",
    [ids[0]],
  );
  try {
    await t.test(
      "reviewed Ohio pilot validates; unsupported, unlinked and fabricated data fail",
      () => {
        assert.equal(enrichmentBatch.safeParse(pilot).success, true);
        for (const mutate of [
          (b) => {
            b.records[0].research.availability = "available";
          },
          (b) => {
            b.records[0].research.earliestStart = "2026-11-15";
          },
          (b) => {
            b.records[0].research.sources[0].url =
              "https://unrelated.test/services";
          },
          (b) => {
            b.records[0].research.services[0].sourceIds = ["missing-source"];
          },
          (b) => {
            b.records[0].research.coverage[0].serviceIds = ["unknown-service"];
          },
          (b) => {
            b.records[0].profile.services.push("Unsupported crew supply");
          },
          (b) => {
            b.records[0].profile.serviceAreas.push("Nationwide");
          },
          (b) => {
            b.records[0].research.checkedAt = "2099-01-01T00:00:00Z";
          },
          (b) => {
            b.records.push(b.records[0]);
          },
        ]) {
          const bad = structuredClone(batch);
          mutate(bad);
          assert.equal(enrichmentBatch.safeParse(bad).success, false);
        }
        const raiden = pilot.records.find(
          (r) => r.companyName === "Raiden Electric",
        ).research;
        assert.equal(
          raiden.services.find((s) => s.id === "maintenance-staff").delivery,
          "contract-staff",
        );
        assert.equal(raiden.laborOnly, "unknown");
        const apa = pilot.records.find(
          (r) => r.companyName === "APA Solar",
        ).research;
        assert.ok(
          apa.coverage.every((a) => !a.serviceIds.includes("racking-install")),
          "National supply is not installation territory",
        );
        const exel = pilot.records.find(
          (r) => r.companyName === "Exel Solar",
        ).research;
        assert.ok(exel.products.every((p) => p.role === "distributes"));
      },
    );
    await t.test(
      "dry run writes neither company fields nor research",
      async () => {
        const rows = await importProviderEnrichment(batch);
        assert.ok(rows.every((r) => r.status === "ready"));
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM provider_capabilities WHERE company_id=ANY($1::uuid[])",
              [ids],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await pool.query("SELECT description FROM companies WHERE id=$1", [
              ids[0],
            ])
          ).rows[0].description,
          batch.records[0].expectedProfile.description,
        );
      },
    );
    await t.test("identity mismatch blocks the whole batch", async () => {
      const bad = structuredClone(batch);
      bad.records[1].companyName = "Different company";
      await assert.rejects(
        importProviderEnrichment(bad, true),
        /Nothing applied.*identity mismatch/,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM provider_enrichment_audit WHERE batch_id=$1",
            [batch.batchId],
          )
        ).rows[0].n,
        0,
      );
    });
    await t.test(
      "claimed profiles and edits after research are protected",
      async () => {
        await pool.query(
          "UPDATE companies SET listing_status='managed' WHERE id=$1",
          [ids[1]],
        );
        await assert.rejects(
          importProviderEnrichment(batch, true),
          /company-managed profile/,
        );
        await pool.query(
          "UPDATE companies SET listing_status='unclaimed',tagline='A newer edit' WHERE id=$1",
          [ids[1]],
        );
        await assert.rejects(
          importProviderEnrichment(batch, true),
          /profile changed/,
        );
        await pool.query("UPDATE companies SET tagline=$2 WHERE id=$1", [
          ids[1],
          batch.records[1].expectedProfile.tagline,
        ]);
        await pool.query(
          "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Enrichment test member','unused-test-hash')",
          [memberId, memberId + "@example.test"],
        );
        await pool.query(
          "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'owner')",
          [memberId, ids[1]],
        );
        await assert.rejects(
          importProviderEnrichment(batch, true),
          /company-managed profile/,
        );
        await pool.query("DELETE FROM users WHERE id=$1", [memberId]);
      },
    );
    await t.test(
      "apply is bounded and audited without fabricating scheduling or credentials",
      async () => {
        const rows = await importProviderEnrichment(batch, true);
        assert.ok(rows.every((r) => r.status === "applied"));
        const p = (
          await pool.query(
            "SELECT * FROM provider_profiles WHERE company_id=$1",
            [ids[0]],
          )
        ).rows[0];
        assert.equal(p.availability, "Owner schedule");
        assert.equal(p.crew_size, "Do not infer crews");
        assert.equal(p.license_details, "Keep license");
        const untouched = (
          await pool.query("SELECT description FROM companies WHERE id=$1", [
            ids[2],
          ])
        ).rows[0];
        assert.equal(untouched.description, "Keep me unchanged");
        const audit = (
          await pool.query(
            "SELECT before_profile FROM provider_enrichment_audit WHERE company_id=$1 AND batch_id=$2",
            [ids[0], batch.batchId],
          )
        ).rows[0];
        assert.equal(
          audit.before_profile.company.description,
          batch.records[0].expectedProfile.description,
        );
        assert.equal(
          audit.before_profile.provider.availability,
          "Owner schedule",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM company_credentials WHERE company_id=ANY($1::uuid[])",
              [ids],
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await t.test(
      "repeating the same batch cannot overwrite a subsequent owner edit",
      async () => {
        await pool.query(
          "UPDATE companies SET description='New owner description',listing_status='managed' WHERE id=$1",
          [ids[0]],
        );
        assert.ok(
          (await importProviderEnrichment(batch, true)).every(
            (r) => r.status === "unchanged",
          ),
        );
        assert.equal(
          (
            await pool.query("SELECT description FROM companies WHERE id=$1", [
              ids[0],
            ])
          ).rows[0].description,
          "New owner description",
        );
        const changed = structuredClone(batch);
        changed.records[1].profile.tagline = "Changed batch content";
        await assert.rejects(
          importProviderEnrichment(changed, true),
          /batch ID already used/,
        );
        const older = structuredClone(batch);
        older.batchId += "-old";
        older.records = [older.records[1]];
        older.records[0].expectedProfile = structuredClone(
          older.records[0].profile,
        );
        older.records[0].research.checkedAt = "2020-01-01T00:00:00Z";
        await assert.rejects(
          importProviderEnrichment(older, true),
          /research is not newer/,
        );
      },
    );
  } finally {
    await pool.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [ids]);
    await pool.query("DELETE FROM users WHERE id=$1", [memberId]);
    await pool.end();
  }
});
