import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../apps/web/src/job-list-focus.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { jobNextStep, sortAttentionJobs } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const COMPANY = "my-company";
const ownerJob = (status, extra = {}) => ({
  status,
  hiring_company_id: COMPANY,
  ...extra,
});
const providerJob = (status, extra = {}) => ({
  status,
  hiring_company_id: "hiring-company",
  ...extra,
});

test("submitted work needs the hiring company's review", () => {
  const next = jobNextStep(ownerJob("review"), COMPANY);
  assert.equal(next.label, "Review work");
  assert.match(next.detail, /submitted/);
  assert.equal(next.priority, 1);
  assert.equal(
    jobNextStep(providerJob("review", { my_quote_status: "chosen" }), COMPANY),
    null,
  );
});

test("only the chosen provider confirms an awarded job", () => {
  const next = jobNextStep(
    providerJob("awarded", { my_quote_status: "chosen" }),
    COMPANY,
  );
  assert.equal(next.label, "Confirm job");
  assert.equal(next.priority, 2);
  for (const quoteStatus of [undefined, "submitted", "declined", "withdrawn"]) {
    assert.equal(
      jobNextStep(
        providerJob("awarded", { my_quote_status: quoteStatus }),
        COMPANY,
      ),
      null,
    );
  }
  assert.equal(
    jobNextStep(ownerJob("awarded", { my_quote_status: "chosen" }), COMPANY),
    null,
  );
});

test("only a hiring company with submitted quotes is prompted to review them", () => {
  const one = jobNextStep(ownerJob("open", { quote_count: 1 }), COMPANY);
  const several = jobNextStep(ownerJob("open", { quote_count: 3 }), COMPANY);
  assert.equal(one.label, "Review quotes");
  assert.equal(one.detail, "1 quote is ready to review.");
  assert.equal(several.detail, "3 quotes are ready to review.");
  assert.equal(one.priority, 3);
  assert.equal(
    jobNextStep(providerJob("open", { quote_count: 3 }), COMPANY),
    null,
  );
  for (const count of [undefined, null, 0, -1, NaN, Infinity, 0.5]) {
    assert.equal(
      jobNextStep(ownerJob("open", { quote_count: count }), COMPANY),
      null,
    );
  }
});

test("an invitation is actionable only before the provider has sent a quote", () => {
  const next = jobNextStep(providerJob("open", { invited: true }), COMPANY);
  assert.equal(next.label, "View invitation");
  assert.equal(next.priority, 4);
  assert.equal(
    jobNextStep(
      providerJob("open", { invited: true, my_quote_status: null }),
      COMPANY,
    )?.label,
    "View invitation",
  );
  for (const quoteStatus of [
    "submitted",
    "chosen",
    "declined",
    "withdrawn",
    "rejected",
  ]) {
    assert.equal(
      jobNextStep(
        providerJob("open", { invited: true, my_quote_status: quoteStatus }),
        COMPANY,
      ),
      null,
    );
  }
  assert.equal(jobNextStep(ownerJob("open", { invited: true }), COMPANY), null);
  assert.equal(
    jobNextStep(providerJob("open", { invited: false }), COMPANY),
    null,
  );
});

test("only the hiring company is prompted to finish its draft", () => {
  const next = jobNextStep(ownerJob("draft"), COMPANY);
  assert.equal(next.label, "Finish draft");
  assert.equal(next.priority, 5);
  assert.equal(jobNextStep(providerJob("draft"), COMPANY), null);
});

test("waiting, ongoing, finished, and closed jobs do not manufacture actions", () => {
  for (const status of ["in_progress", "completed", "cancelled", "unknown"]) {
    assert.equal(
      jobNextStep(ownerJob(status, { quote_count: 3 }), COMPANY),
      null,
    );
    assert.equal(
      jobNextStep(
        providerJob(status, { invited: true, my_quote_status: "chosen" }),
        COMPANY,
      ),
      null,
    );
    assert.equal(
      jobNextStep(providerJob(status, { invited: true }), COMPANY),
      null,
    );
  }
  assert.equal(jobNextStep(ownerJob("open"), COMPANY), null);
  assert.equal(
    jobNextStep(providerJob("open", { my_quote_status: "submitted" }), COMPANY),
    null,
  );
});

test("no company identity never accidentally makes an unowned job yours", () => {
  for (const companyId of [undefined, null, ""]) {
    for (const status of ["review", "draft", "open", "awarded"]) {
      const job = {
        status,
        quote_count: 3,
        invited: true,
        my_quote_status: "chosen",
      };
      assert.equal(jobNextStep(job, companyId), null);
      assert.equal(jobNextStep(ownerJob(status, job), companyId), null);
    }
  }
  assert.equal(jobNextStep({ status: "review" }, COMPANY), null);
  assert.equal(jobNextStep({ status: "draft" }, COMPANY), null);
});

test("attention sorting filters quiet jobs, preserves tie order and input objects", () => {
  const jobs = [
    { id: "draft", ...ownerJob("draft") },
    { id: "quotes-first", ...ownerJob("open", { quote_count: 1 }) },
    { id: "quiet", ...ownerJob("in_progress") },
    { id: "invitation", ...providerJob("open", { invited: true }) },
    { id: "review", ...ownerJob("review") },
    { id: "quotes-second", ...ownerJob("open", { quote_count: 4 }) },
    { id: "confirm", ...providerJob("awarded", { my_quote_status: "chosen" }) },
  ];
  const original = [...jobs];
  const result = sortAttentionJobs(Object.freeze(jobs), COMPANY);
  assert.deepEqual(
    result.map((job) => job.id),
    [
      "review",
      "confirm",
      "quotes-first",
      "quotes-second",
      "invitation",
      "draft",
    ],
  );
  assert.deepEqual(jobs, original);
  assert.equal(result[0], jobs[4]);
  assert.deepEqual(sortAttentionJobs(jobs), []);
  assert.deepEqual(sortAttentionJobs([], COMPANY), []);
});
