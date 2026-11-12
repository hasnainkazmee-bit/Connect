import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pool, tx } from "../apps/api/dist/db.js";
import { importProviderEnrichment } from "../apps/api/dist/provider-enrichment.js";
import {
  importProviderDiscovery,
  discoveryRecord,
  projectProviderResearch,
} from "../apps/api/dist/provider-matching.js";
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
test("reviewed facts are scoped, discoverable and protected from unreviewed imports", async (t) => {
  const id = randomUUID(),
    other = randomUUID(),
    demo = randomUUID();
  const b = structuredClone(pilot);
  b.batchId = "matching-test-" + randomUUID();
  b.records = b.records.filter((r) => r.companyName === "APA Solar");
  const r = b.records[0];
  r.companyId = id;
  await pool.query(
    `INSERT INTO companies(id,slug,name,website,listing_status,description,tagline,services,service_areas)
 VALUES($1::uuid,$1::text,$2,$3,'unclaimed',$4,$5,$6,$7)`,
    [
      id,
      r.companyName,
      r.website,
      r.expectedProfile.description,
      r.expectedProfile.tagline,
      r.expectedProfile.services,
      r.expectedProfile.serviceAreas,
    ],
  );
  await pool.query(
    `INSERT INTO companies(id,slug,name,website,is_demo) VALUES($1::uuid,$1::text,'Unreviewed Solar','https://unreviewed.test',false),($2::uuid,$2::text,'Demo Solar','',true)`,
    [other, demo],
  );
  try {
    await t.test(
      "reviewed Texas corrections include sourced types and explicit regional boundaries",
      async () => {
        const b = JSON.parse(
          await readFile(
            new URL(
              "../data/provider-enrichment/texas-reviewed-2026-11-12.json",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        const { enrichmentBatch } =
          await import("../apps/api/dist/provider-enrichment.js");
        assert.equal(enrichmentBatch.safeParse(b).success, true);
        const supplier = b.records.find(
          (r) => r.companyName === "Caltrik Solar",
        );
        assert.equal(supplier.profile.type, "Distributor");
        assert.equal(supplier.research.coverage[0].stateCodes.length, 48);
        assert.ok(!supplier.research.coverage[0].stateCodes.includes("AK"));
        assert.ok(
          !supplier.research.services.some(
            (s) => s.category === "solar-installation",
          ),
        );
        const invalid = structuredClone(b);
        delete invalid.records[0].research.businessType;
        assert.equal(enrichmentBatch.safeParse(invalid).success, false);
      },
    );

    test("every new company is enrolled, demos kept separate", async () => {
      const states = (
        await pool.query(
          "SELECT company_id,state FROM provider_matching_profiles WHERE company_id=ANY($1::uuid[])",
          [[id, other, demo]],
        )
      ).rows;
      assert.equal(states.length, 3);
      assert.equal(
        states.find((s) => s.company_id === demo).state,
        "excluded_demo",
      );
      assert.equal(
        states.find((s) => s.company_id === other).state,
        "unresearched",
      );
    });
    await t.test(
      "a reviewed import projects exact offering-scoped coverage",
      async () => {
        await importProviderEnrichment(b, true);
        const offerings = (
          await pool.query(
            "SELECT * FROM provider_current_offerings WHERE company_id=$1",
            [id],
          )
        ).rows;
        assert.equal(
          offerings.length,
          r.research.services.length + r.research.products.length,
        );
        const install = (
          await pool.query(
            `SELECT a.* FROM provider_coverage_offerings co JOIN provider_coverage_areas a USING(company_id) WHERE co.company_id=$1 AND co.area_id=a.id AND co.offering_id='service:racking-install'`,
            [id],
          )
        ).rows;
        assert.equal(
          install.length,
          0,
          "national shipping must not give nationwide installation",
        );
        assert.ok(
          (
            await pool.query(
              `SELECT 1 FROM provider_coverage_offerings WHERE company_id=$1 AND offering_id LIKE 'product:%'`,
              [id],
            )
          ).rowCount > 0,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM provider_service_availability WHERE company_id=$1",
              [id],
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await t.test(
      "edited profiles, expired research and demos cannot match",
      async () => {
        await pool.query(
          "UPDATE provider_matching_profiles SET valid_until=now()-interval '1 minute',checked_at=now()-interval '2 minutes' WHERE company_id=$1",
          [id],
        );
        assert.equal(
          (
            await pool.query(
              "SELECT 1 FROM provider_current_offerings WHERE company_id=$1",
              [id],
            )
          ).rowCount,
          0,
        );
        await pool.query(
          "UPDATE provider_matching_profiles SET valid_until=now()+interval '1 day' WHERE company_id=$1",
          [id],
        );
        await pool.query(
          "UPDATE companies SET services=ARRAY['Owner changed services'] WHERE id=$1",
          [id],
        );
        assert.equal(
          (
            await pool.query(
              "SELECT 1 FROM provider_current_offerings WHERE company_id=$1",
              [id],
            )
          ).rowCount,
          0,
        );
        await assert.rejects(
          tx((db) => projectProviderResearch(db, id, b.batchId, r.research)),
          /changed after source review/,
        );
        await pool.query("UPDATE companies SET services=$2 WHERE id=$1", [
          id,
          r.profile.services,
        ]);
        await pool.query(
          "UPDATE provider_profiles SET updated_at=now() WHERE company_id=$1",
          [id],
        );
        assert.equal(
          (
            await pool.query(
              "SELECT 1 FROM provider_current_offerings WHERE company_id=$1",
              [id],
            )
          ).rowCount,
          0,
        );
      },
    );
    const now = new Date().toISOString(),
      run = "discovery-test-" + randomUUID();
    const record = {
      companyId: other,
      companyName: "Unreviewed Solar",
      website: "https://unreviewed.test",
      checkedAt: now,
      identityStatus: "name_on_official_domain",
      status: "ready_for_review",
      pages: [
        {
          url: "https://unreviewed.test/services",
          status: "ok",
          checkedAt: now,
          contentHash: "a".repeat(64),
        },
      ],
      candidates: [
        {
          kind: "service",
          categoryId: "solar-installation",
          sourceUrl: "https://unreviewed.test/services",
          evidence: "We provide solar installation for local homeowners.",
          sectorHints: ["residential"],
          reviewStatus: "unreviewed",
        },
      ],
      coverageCandidates: [],
    };
    const inventory = {
      version: 1,
      origin: "https://connect.sunhubapp.com",
      generatedAt: now,
      companies: [
        {
          id: other,
          name: record.companyName,
          website: record.website,
          is_demo: false,
        },
      ],
    };
    await t.test(
      "candidate import is complete, idempotent and cannot publish or match",
      async () => {
        assert.equal(
          (await importProviderDiscovery(run, inventory, [record])).status,
          "ready",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT 1 FROM provider_research_runs WHERE id=$1",
              [run],
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (await importProviderDiscovery(run, inventory, [record], true))
            .status,
          "applied",
        );
        assert.equal(
          (await importProviderDiscovery(run, inventory, [record], true))
            .status,
          "unchanged",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT 1 FROM provider_current_offerings WHERE company_id=$1",
              [other],
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await pool.query("SELECT description FROM companies WHERE id=$1", [
              other,
            ])
          ).rows[0].description,
          "",
        );
        const changed = structuredClone(record);
        changed.candidates[0].evidence = "Changed evidence";
        await assert.rejects(
          importProviderDiscovery(run, inventory, [changed], true),
          /already used/,
        );
        await assert.rejects(
          importProviderDiscovery(run + "-incomplete", inventory, []),
          /every inventory company/,
        );
      },
    );
    await t.test(
      "unknown categories, changed identities and unsupported evidence reject atomically",
      async () => {
        assert.equal(
          discoveryRecord.safeParse({
            companyId: demo,
            companyName: "Demo Solar",
            website: "",
            checkedAt: now,
            identityStatus: "unknown",
            status: "excluded_demo",
            pages: [],
            candidates: [],
            coverageCandidates: [],
          }).success,
          true,
        );
        assert.equal(
          discoveryRecord.safeParse({
            companyId: other,
            companyName: "Unreviewed Solar",
            website: "malformed legacy address",
            checkedAt: now,
            identityStatus: "unknown",
            status: "unreachable",
            pages: [
              {
                url: "malformed legacy address",
                status: "fetch_failed",
                error: "Not a public HTTP(S) URL",
              },
            ],
            candidates: [],
            coverageCandidates: [],
          }).success,
          true,
        );
        const bad = structuredClone(record);
        bad.candidates[0].sourceUrl = "https://other.test/";
        assert.equal(discoveryRecord.safeParse(bad).success, false);
        bad.candidates[0].sourceUrl = record.candidates[0].sourceUrl;
        bad.candidates[0].categoryId = "made-up-service";
        await assert.rejects(
          importProviderDiscovery(run + "-invalid", inventory, [bad], true),
          /unknown taxonomy/,
        );
        bad.candidates[0].categoryId = "solar-installation";
        bad.companyName = "Changed identity";
        await assert.rejects(
          importProviderDiscovery(run + "-identity", inventory, [bad], true),
          /identity changed/,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT 1 FROM provider_research_runs WHERE id=$1",
              [run + "-invalid"],
            )
          ).rowCount,
          0,
        );
      },
    );
  } finally {
    await pool.query(
      "DELETE FROM provider_research_results WHERE company_id=ANY($1::uuid[])",
      [[id, other, demo]],
    );
    await pool.query(
      "DELETE FROM provider_research_runs WHERE id LIKE 'discovery-test-%' AND NOT EXISTS(SELECT 1 FROM provider_research_results WHERE run_id=provider_research_runs.id)",
    );
    await pool.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [
      [id, other, demo],
    ]);
  }
});
test.after(() => pool.end());
