import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// The helper has no browser dependencies. Exercise its public result directly.
const source = await readFile(
  new URL("../apps/web/src/match-fit.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { matchFit } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

function fixture() {
  return {
    match: {
      company: {
        id: "provider",
        name: "Example Solar",
        slug: "example-solar",
        logo_url: "",
        location: "Cleveland, OH",
        claimed: true,
      },
      eligible: true,
      reasons: [
        "Solar installation",
        "Serves the job location",
        "commercial experience",
      ],
      followUp: ["Availability", "Project size and capacity"],
      offerings: [
        {
          offering: {
            kind: "service",
            title: "Solar installation",
            detail: "Installation services",
            sectors: ["commercial"],
            systemTypes: ["rooftop"],
            delivery: "turnkey",
          },
          sources: [],
          needsConfirmation: [],
          preferredCredentials: [],
          availability: "unknown",
          earliestStart: null,
        },
      ],
    },
    data: {
      configured: true,
      job: {
        id: "job",
        title: "Commercial installation",
        location: "Cleveland, OH",
        status: "open",
        system_size_kw: 250,
        people_needed: 6,
      },
      preferences: {
        kind: "service",
        categoryId: "solar-installation",
        countryCode: "US",
        stateCode: "OH",
        sector: "commercial",
        systemType: "rooftop",
        delivery: "turnkey",
        preferredCredentials: [],
        preferAvailable: true,
      },
    },
  };
}
const fact = (result, key) => result.facts.find((item) => item.key === key);

test("eligible service and area fit does not turn unknown availability, capacity or crew into a promise", () => {
  const { match, data } = fixture();
  const result = matchFit(match, data);
  assert.equal(result.heading, "Service & area match");
  assert.equal(result.gaps.length, 0);
  for (const key of [
    "work",
    "service_area",
    "project_sector",
    "system_type",
    "delivery_method",
  ])
    assert.equal(fact(result, key).state, "matched", key);
  for (const key of ["availability", "capacity", "crew"])
    assert.equal(fact(result, key).state, "check", key);
  assert.equal(fact(result, "capacity").value, "Confirm 250 kW capacity");
  assert.doesNotMatch(result.summary, /all|available|ready/i);
});

test("pending company explains its specific hard gaps rather than only calling it another company", () => {
  const { match, data } = fixture();
  match.eligible = false;
  match.offerings[0].needsConfirmation = ["service_area", "project_sector"];
  match.offerings[0].offering.sectors = [];
  const result = matchFit(match, data);
  assert.equal(result.heading, "Check job fit");
  assert.equal(
    result.summary,
    "Confirm their service area and commercial experience.",
  );
  assert.deepEqual(
    result.gaps.map((gap) => gap.key),
    ["service_area", "project_sector"],
  );
  assert.equal(fact(result, "service_area").state, "check");
  assert.equal(fact(result, "project_sector").state, "check");
});

test("basing a business locally is not substituted for its service area", () => {
  const { match, data } = fixture();
  match.eligible = false;
  match.reasons.push("Based in the job’s state or province");
  match.offerings[0].needsConfirmation = ["service_area"];
  assert.equal(fact(matchFit(match, data), "service_area").state, "check");
});

test("a known later start remains a check, even when the company accepts work", () => {
  const { match, data } = fixture();
  data.preferences.preferredStart = "2027-01-15";
  match.offerings[0].availability = "accepting";
  match.offerings[0].earliestStart = "2027-02-01";
  const result = matchFit(match, data);
  assert.equal(fact(result, "availability").state, "check");
  assert.match(fact(result, "availability").detail, /later/);
  assert.equal(
    result.gaps.length,
    0,
    "a preferred start is not automatically a hard requirement",
  );
});

test("limited availability and confirmed start are explicit instead of appearing fully available", () => {
  const { match, data } = fixture();
  data.preferences.preferredStart = "2027-01-15";
  match.offerings[0].availability = "limited";
  match.offerings[0].earliestStart = "2027-01-12";
  const availability = fact(matchFit(match, data), "availability");
  assert.equal(availability.value, "Limited availability");
  assert.equal(availability.state, "matched");
  assert.match(availability.detail, /Jan 12, 2027/);
});

test("unavailable companies remain distinct from missing availability", () => {
  const { match, data } = fixture();
  match.eligible = false;
  match.offerings[0].availability = "unavailable";
  match.offerings[0].needsConfirmation = ["not_accepting_work"];
  const result = matchFit(match, data);
  assert.equal(fact(result, "availability").state, "unavailable");
  assert.deepEqual(
    result.gaps.map((gap) => gap.key),
    ["availability"],
  );
  assert.match(result.summary, /not accepting new work/);
});

test("preferred certifications match exact title and scope, preserving listed versus verified", () => {
  const { match, data } = fixture();
  data.preferences.preferredCredentials = [
    { title: "NABCEP", scope: "personnel" },
    { title: "Enphase", scope: "company" },
  ];
  match.offerings[0].preferredCredentials = [
    { title: "NABCEP", scope: "company", basis: "company" },
    { title: " enphase ", scope: "company", basis: "company" },
  ];
  let result = matchFit(match, data);
  assert.equal(fact(result, "preferred_credentials").value, "1 of 2 listed");
  assert.equal(fact(result, "preferred_credentials").state, "check");
  assert.equal(result.gaps.length, 0);
  assert.match(
    fact(result, "preferred_credentials").detail,
    /NABCEP \(personnel\)/,
  );
  match.offerings[0].preferredCredentials.push({
    title: "NABCEP",
    scope: "personnel",
    basis: "company",
  });
  result = matchFit(match, data);
  assert.equal(fact(result, "preferred_credentials").state, "matched");
  assert.doesNotMatch(
    JSON.stringify(fact(result, "preferred_credentials")),
    /verified/i,
  );
});

test("hard unknown delivery is identified without guessing from business names or descriptions", () => {
  const { match, data } = fixture();
  match.eligible = false;
  match.offerings[0].offering.delivery = "unknown";
  match.offerings[0].needsConfirmation = ["delivery_method"];
  const result = matchFit(match, data);
  assert.equal(fact(result, "delivery_method").state, "check");
  assert.equal(result.summary, "Confirm their work approach.");
});

test("optional job inputs do not create filler requirement rows and product matches do not claim crew availability", () => {
  const { match, data } = fixture();
  data.preferences = {
    kind: "product",
    categoryId: "equipment-supply",
    countryCode: "US",
    stateCode: "OH",
    preferredCredentials: [],
    preferAvailable: false,
  };
  data.job.system_size_kw = null;
  data.job.people_needed = 0;
  match.offerings[0].offering.kind = "product";
  const result = matchFit(match, data);
  assert.deepEqual(
    result.facts.map((item) => item.key),
    ["work", "service_area"],
  );
  assert.equal(fact(result, "work").label, "Product");
});

test("missing structural confirmation data is not shown as known service area", () => {
  const { match, data } = fixture();
  delete match.offerings[0].needsConfirmation;
  assert.equal(fact(matchFit(match, data), "service_area").state, "check");
});
