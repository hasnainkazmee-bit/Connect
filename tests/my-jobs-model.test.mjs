import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function moduleUrl(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  let compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  if (path.endsWith("my-jobs-model.ts")) {
    compiled = compiled.replace(
      '"./job-list-focus"',
      JSON.stringify(await moduleUrl("../apps/web/src/job-list-focus.ts")),
    );
  }
  return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}
const { myJobSummary } = await import(
  await moduleUrl("../apps/web/src/my-jobs-model.ts")
);
const COMPANY = "my-company";
const hiring = (status, extra = {}) => ({
  status,
  hiring_company_id: COMPANY,
  ...extra,
});
const providing = (status, extra = {}) => ({
  status,
  hiring_company_id: "other-company",
  ...extra,
});
const summary = (job, manage = true) => myJobSummary(job, COMPANY, manage);

test("hiring companies see the next action while providers see their own quote state", () => {
  const hirer = summary(hiring("open", { quote_count: 3 }));
  assert.equal(hirer.stage, "quotes");
  assert.equal(hirer.role, "hiring");
  assert.equal(hirer.actionLabel, "Review quotes");
  assert.equal(hirer.attention, true);
  const bidder = summary(
    providing("open", { quote_count: 3, my_quote_status: "submitted" }),
  );
  assert.equal(bidder.role, "quoting");
  assert.equal(bidder.label, "Quote sent");
  assert.equal(bidder.attention, false);
  assert.match(bidder.detail, /Waiting/);
});

test("drafts remain available to finish without creating attention or urgency", () => {
  const draft = summary(hiring("draft"));
  assert.equal(draft.stage, "drafts");
  assert.equal(draft.actionLabel, "Finish draft");
  assert.equal(draft.actionSuffix, "/edit");
  assert.equal(draft.attention, false);
  assert.equal(summary(hiring("draft"), false).actionSuffix, "");
  assert.equal(summary(providing("draft")).stage, "quotes");
});

test("only the chosen provider is asked to confirm a job", () => {
  const winner = summary(providing("awarded", { my_quote_status: "chosen" }));
  assert.equal(winner.stage, "active");
  assert.equal(winner.role, "providing");
  assert.equal(winner.actionLabel, "Confirm job");
  assert.equal(winner.attention, true);
  const hirer = summary(hiring("awarded"));
  assert.equal(hirer.stage, "active");
  assert.equal(hirer.attention, false);
  assert.match(hirer.detail, /Waiting/);
});

test("a provider waiting for final approval is not told to review their own work", () => {
  const winner = summary(providing("review", { my_quote_status: "chosen" }));
  assert.equal(winner.label, "Awaiting approval");
  assert.equal(winner.attention, false);
  const hirer = summary(hiring("review"));
  assert.equal(hirer.actionLabel, "Review work");
  assert.equal(hirer.attention, true);
  assert.ok(
    hirer.priority <
      summary(providing("awarded", { my_quote_status: "chosen" })).priority,
  );
});

test("invitations and requested changes are distinct from a submitted quote", () => {
  const invitation = summary(providing("open", { invited: true }));
  assert.equal(invitation.role, "invited");
  assert.equal(invitation.attention, true);
  assert.equal(invitation.actionLabel, "View invitation");
  const revision = summary(
    providing("open", { invited: true, my_quote_status: "changes_requested" }),
  );
  assert.equal(revision.role, "quoting");
  assert.equal(revision.actionLabel, "Revise quote");
  assert.equal(revision.attention, true);
  assert.equal(
    summary(providing("open", { invited: true, my_quote_status: "submitted" }))
      .attention,
    false,
  );
});

test("closed quote outcomes remain distinct even when the job itself is still open", () => {
  const expected = {
    declined: "Quote declined",
    withdrawn: "Quote withdrawn",
    award_declined: "Job declined",
    not_chosen: "Not chosen",
  };
  for (const [status, label] of Object.entries(expected)) {
    for (const jobStatus of [
      "open",
      "awarded",
      "in_progress",
      "review",
      "completed",
    ]) {
      const row = summary(
        providing(jobStatus, { invited: true, my_quote_status: status }),
      );
      assert.equal(row.stage, "finished");
      assert.equal(row.label, label);
      assert.equal(row.attention, false);
    }
  }
});

test("a losing bidder or unanswered invite never appears as active work for their company", () => {
  for (const status of ["awarded", "in_progress", "review"]) {
    for (const my_quote_status of [
      undefined,
      "submitted",
      "changes_requested",
    ]) {
      const row = summary(
        providing(status, { invited: true, my_quote_status }),
      );
      assert.equal(row.stage, "finished");
      assert.equal(row.label, "Not chosen");
      assert.equal(row.attention, false);
    }
  }
});

test("completed and cancelled jobs never surface stale quote or invitation actions", () => {
  for (const status of ["completed", "cancelled"]) {
    for (const job of [
      hiring(status, { quote_count: 4 }),
      providing(status, { my_quote_status: "chosen" }),
      providing(status, { my_quote_status: "changes_requested" }),
      providing(status, { invited: true }),
    ]) {
      const row = summary(job);
      assert.equal(row.stage, "finished");
      assert.equal(row.attention, false);
      assert.equal(row.actionLabel, "View job");
    }
  }
  assert.equal(
    summary(providing("completed", { my_quote_status: "chosen" })).label,
    "Completed",
  );
  assert.equal(
    summary(providing("completed", { invited: true })).label,
    "Job closed",
  );
});

test("read-only team members retain status context without manage actions", () => {
  for (const job of [
    hiring("review"),
    hiring("open", { quote_count: 2 }),
    hiring("draft"),
    providing("awarded", { my_quote_status: "chosen" }),
    providing("open", { my_quote_status: "changes_requested" }),
    providing("open", { invited: true }),
  ]) {
    const row = summary(job, false);
    assert.equal(row.attention, false);
    assert.ok(["View job", "View progress"].includes(row.actionLabel));
    assert.equal(row.actionSuffix, "");
  }
});

test("missing identity and unsupported states never manufacture management actions", () => {
  for (const companyId of [undefined, ""]) {
    for (const status of [
      "open",
      "draft",
      "awarded",
      "in_progress",
      "review",
    ]) {
      const row = myJobSummary(
        { status, quote_count: 3, invited: true },
        companyId,
        true,
      );
      assert.notEqual(row.role, "hiring");
      assert.equal(row.attention, false);
      assert.equal(row.actionSuffix, "");
    }
  }
  const unknown = summary(hiring("unknown", { quote_count: 3 }));
  assert.equal(unknown.attention, false);
  assert.equal(unknown.actionLabel, "View job");
});

test("nonpositive or invalid counts do not create a review-quotes prompt", () => {
  for (const quote_count of [undefined, null, -1, 0, 0.5, NaN, Infinity]) {
    const row = summary(hiring("open", { quote_count }));
    assert.equal(row.attention, false);
    assert.match(row.detail, /Waiting/);
  }
});
