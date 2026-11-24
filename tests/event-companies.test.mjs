import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../apps/api/dist/db.js";
import {
  eventCompanyBatch,
  importEventCompanies,
} from "../apps/api/dist/event-company-import.js";
import { profileExtras } from "../apps/api/dist/profiles.js";
import sharp from "sharp";
import { companyLogoImage } from "../apps/api/dist/company-logo-image.js";

test("reversed event-company marks remain readable without recoloring their artwork", async () => {
  const white = Buffer.from(
    '<svg width="100" height="50"><rect x="10" y="10" width="80" height="30" fill="white"/></svg>',
  );
  const result = await companyLogoImage(white, true);
  const { data, info } = await sharp(result)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 100);
  assert.equal(data[3], 255);
  assert.ok(data[0] < 60 && data[1] < 70 && data[2] < 80);
  const center = (25 * info.width + 50) * 4;
  assert.ok(
    data[center] > 240 && data[center + 1] > 240 && data[center + 2] > 240,
  );
  const dark = Buffer.from(
    '<svg width="100" height="50"><rect x="10" y="10" width="80" height="30" fill="#182e39"/></svg>',
  );
  const unchanged = await sharp(await companyLogoImage(dark, true))
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.equal(unchanged[3], 0);
});

if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Use an isolated test database.");

test("event imports preserve company ownership, enforce identity and keep contact sources private", async (t) => {
  const id = randomUUID(),
    suffix = id.slice(0, 8),
    key = "event-" + suffix,
    domain = "event-" + suffix + ".test";
  const batch = {
    version: 1,
    batchId: key,
    checkedAt: new Date().toISOString(),
    event: {
      key,
      name: "Test RE+",
      year: 2026,
      website: "https://re-plus.com/",
      logoPath: "/brand/events/replus.png",
    },
    sourceUrl: "https://docs.google.com/spreadsheets/d/private-test",
    records: [
      {
        action: "existing",
        companyId: id,
        expectedName: "Existing " + suffix,
        domain,
        participation: "exhibitor",
        sourceReference: "Rows 2 and 3",
        identityNote:
          "Exact name and official website match the exhibitor record.",
      },
    ],
  };
  await pool.query(
    "INSERT INTO companies(id,name,slug,website,listing_status,description) VALUES($1,$2,$3,$4,'managed','Owner-written overview')",
    [id, batch.records[0].expectedName, key, "https://" + domain],
  );
  const newDomain = "new-" + domain;
  const added = {
    action: "create",
    domain: newDomain,
    participation: "exhibitor",
    sourceReference: "Row 4",
    identityNote:
      "Official website identifies the exhibitor and its product range.",
    profile: {
      name: "New " + suffix,
      domain: newDomain,
      type: "Manufacturer",
      location: "",
      website: "https://" + newDomain,
      description:
        "This equipment manufacturer produces mounting hardware for rooftop solar systems. Its product range includes rails, roof attachments and module clamps for installers, with published installation instructions and design support.",
      tagline: "Rooftop solar mounting equipment",
      services: ["Solar mounting rails", "Roof attachments", "Module clamps"],
      serviceAreas: [],
      audiences: [],
      phone: "",
      logoUrl: "",
      employeeCount: "",
      established: null,
      suggestedUsername: "new-" + suffix,
      sourceCheckedAt: new Date().toISOString().slice(0, 10),
    },
    trades: ["Equipment"],
    projectTypes: ["Rooftop solar"],
    evidence: [
      {
        url: "https://" + newDomain + "/products",
        note: "The official products page lists rails, roof attachments and module clamps for rooftop solar.",
      },
    ],
  };
  batch.records.push(added);
  try {
    await t.test("dry run creates no company or event", async () => {
      assert.equal((await importEventCompanies(batch)).created, 1);
      assert.equal(
        (await pool.query("SELECT 1 FROM industry_events WHERE key=$1", [key]))
          .rowCount,
        0,
      );
      assert.equal(
        (
          await pool.query("SELECT 1 FROM companies WHERE website=$1", [
            added.profile.website,
          ])
        ).rowCount,
        0,
      );
    });
    await t.test(
      "rejects stale identity and prevents partial application",
      async () => {
        const b = structuredClone(batch);
        b.records[0].expectedName = "Wrong identity";
        await assert.rejects(importEventCompanies(b, true), /identity changed/);
        assert.equal(
          (
            await pool.query("SELECT 1 FROM industry_events WHERE key=$1", [
              key,
            ])
          ).rowCount,
          0,
        );
      },
    );
    await t.test(
      "rejects duplicate, future, thin or unsupported-source records",
      () => {
        for (const mutate of [
          (b) => b.records.push(b.records[0]),
          (b) => (b.checkedAt = "2099-01-01T00:00:00Z"),
          (b) => (b.records[1].profile.description = "Thin profile"),
          (b) => (b.records[1].evidence[0].url = "https://unrelated.test"),
          (b) => (b.records[1].profile.serviceAreas = ["Nationwide"]),
        ]) {
          const b = structuredClone(batch);
          mutate(b);
          assert.equal(eventCompanyBatch.safeParse(b).success, false);
        }
      },
    );
    await t.test(
      "applies once; public output exposes no sheet, notes or contact information",
      async () => {
        const result = await importEventCompanies(batch, true);
        assert.equal(result.created, 1);
        assert.equal(result.participations, 2);
        assert.equal(
          (await importEventCompanies(batch, true)).mode,
          "already-applied",
        );
        const c = (
          await pool.query(
            "SELECT description,listing_status FROM companies WHERE id=$1",
            [id],
          )
        ).rows[0];
        assert.equal(c.description, "Owner-written overview");
        assert.equal(c.listing_status, "managed");
        const extras = await profileExtras(id);
        assert.deepEqual(extras.events[0], {
          key,
          name: "Test RE+",
          year: 2026,
          website: "https://re-plus.com/",
          logo_path: "/brand/events/replus.png",
          participation: "exhibitor",
        });
        assert.equal(
          JSON.stringify(extras.events).includes("private-test"),
          false,
        );
        const b = structuredClone(batch);
        b.records[0].identityNote += " Modified";
        await assert.rejects(
          importEventCompanies(b, true),
          /different content/,
        );
        const duplicated = { ...batch, batchId: key + "-duplicate" };
        await assert.rejects(
          importEventCompanies(duplicated, true),
          /already exists/,
        );
        const newId = result.companies.find(
          (c) => c.action === "create",
        ).companyId;
        assert.equal(
          (
            await pool.query("SELECT 1 FROM memberships WHERE company_id=$1", [
              newId,
            ])
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT listing_status FROM companies WHERE id=$1",
              [newId],
            )
          ).rows[0].listing_status,
          "unclaimed",
        );
      },
    );
  } finally {
    await pool.query("DELETE FROM companies WHERE id=$1 OR website=$2", [
      id,
      added.profile.website,
    ]);
    await pool.query("DELETE FROM industry_events WHERE key=$1", [key]);
    await pool.query("DELETE FROM company_event_imports WHERE batch_id=$1", [
      key,
    ]);
  }
});
test.after(() => pool.end());
