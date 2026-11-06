import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadMasterCompanySnapshot,
  planMasterCompanyImport,
} from "../apps/api/dist/master-company-import.js";

test("Master Companies snapshot contains only reviewed public listing fields", async () => {
  const records = await loadMasterCompanySnapshot(process.cwd());
  assert.equal(records.length, 3330);
  const allowed = [
    "name",
    "domain",
    "type",
    "location",
    "website",
    "description",
    "tagline",
    "services",
    "serviceAreas",
    "audiences",
    "phone",
    "logoUrl",
    "employeeCount",
    "established",
    "suggestedUsername",
    "sourceCheckedAt",
  ];
  for (const record of records) {
    assert.deepEqual(Object.keys(record), allowed);
    assert.ok(record.name && record.description && record.tagline);
    assert.ok(record.website.startsWith("http"));
  }
});

test("Master Companies import preserves existing profiles and avoids usernames in use", async () => {
  const records = await loadMasterCompanySnapshot(process.cwd());
  const selected = records.slice(0, 3);
  const { additions, skipped } = planMasterCompanyImport(
    selected,
    [
      {
        id: "existing",
        name_key: "fluor",
        slug: "fluor",
        username: "fluor",
        website: "https://www.fluor.com/",
      },
    ],
    ["graybar.com"],
    ["sunrun"],
  );
  assert.equal(skipped.existingName, 1);
  assert.equal(skipped.existingDomain, 1);
  assert.equal(additions.length, 1);
  assert.equal(additions[0].name, "Sunrun");
  assert.equal(additions[0].username, "sunrun-2");
});
