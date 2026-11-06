import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../apps/api/dist/db.js";
import {
  importReviewedCredentials,
  reviewedBatch,
} from "../apps/api/dist/credential-import.js";

if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test"))
  throw new Error("Use an isolated test database.");
test("reviewed research batches enforce provenance, identity, dry runs and evidence freshness", async (t) => {
  const slug = "credential-batch-" + randomUUID().slice(0, 8);
  const company = (
    await pool.query(
      "INSERT INTO companies(name,slug,username,website) VALUES('Batch Research Fixture',$1,$1,'https://official.example.test/') RETURNING id",
      [slug],
    )
  ).rows[0];
  const now = new Date().toISOString();
  const record = {
    companyId: company.id,
    companyName: "Batch Research Fixture",
    website: "https://official.example.test/",
    key: "tesla-powerwall-installer",
    category: "qualification",
    title: "Tesla Powerwall Certified Installer",
    organization: "Tesla",
    scope: "company",
    scopeDetail: "Powerwall installation services",
    description: "Explicit company-reported installer designation.",
    sourceUrl: "https://official.example.test/about/",
    evidenceBasis: "company",
    period: "",
    validUntil: null,
    checkedAt: now,
    reviewMethod: "first_party_explicit_claim",
    evidenceNote: "Explicit installer badge on the matched official website.",
  };
  const batch = {
    version: 1,
    generatedAt: now,
    inventoryOrigin: "https://connect.sunhubapp.com",
    records: [record],
  };
  const count = async () =>
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM company_credentials WHERE company_id=$1",
          [company.id],
        )
      ).rows[0].count,
    );
  try {
    await t.test(
      "raw crawl candidates and spoofed provenance cannot be imported",
      async () => {
        assert.equal(
          reviewedBatch.safeParse({
            companyId: company.id,
            candidates: [{ topic: "NABCEP" }],
          }).success,
          false,
        );
        for (const patch of [
          { evidenceBasis: "issuer" },
          { sourceUrl: "https://unrelated.example.test/" },
          { checkedAt: "2099-01-01T00:00:00Z" },
        ])
          await assert.rejects(
            importReviewedCredentials(
              { ...batch, records: [{ ...record, ...patch }] },
              true,
            ),
          );
        await assert.rejects(
          importReviewedCredentials(
            { ...batch, records: [record, record] },
            true,
          ),
        );
        assert.equal(await count(), 0);
      },
    );
    await t.test(
      "same-name records do not bypass the exact company and website boundary",
      async () => {
        const rows = await importReviewedCredentials(
          {
            ...batch,
            records: [
              {
                ...record,
                website: "https://unrelated.example.test/",
                sourceUrl: "https://unrelated.example.test/about/",
              },
            ],
          },
          true,
        );
        assert.match(rows[0].status, /skipped/);
        assert.equal(await count(), 0);
      },
    );
    await t.test(
      "default dry run leaves storage untouched and repeat apply is idempotent",
      async () => {
        await importReviewedCredentials(batch, false);
        assert.equal(await count(), 0);
        await importReviewedCredentials(batch, true);
        await importReviewedCredentials(batch, true);
        assert.equal(await count(), 1);
      },
    );
    await t.test(
      "older research cannot overwrite a newer source check",
      async () => {
        await importReviewedCredentials(
          {
            ...batch,
            records: [
              {
                ...record,
                title: "Older description",
                checkedAt: "2020-01-01T00:00:00Z",
              },
            ],
          },
          true,
        );
        const saved = (
          await pool.query(
            "SELECT title,evidence_basis FROM company_credentials WHERE company_id=$1",
            [company.id],
          )
        ).rows[0];
        assert.equal(saved.title, record.title);
        assert.equal(saved.evidence_basis, "company");
      },
    );
  } finally {
    await pool.query("DELETE FROM companies WHERE id=$1", [company.id]);
    await pool.end();
  }
});
