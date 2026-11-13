import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../apps/web/src/job-history-model.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { buildJobHistory } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const at = (minute) => `2026-11-13T16:${String(minute).padStart(2, "0")}:00Z`;
const detail = (extra = {}) => ({
  job: {
    id: "job",
    created_at: at(0),
    updated_at: at(59),
    status: "completed",
    work_checklist: [
      {
        id: "task",
        title: "Install modules",
        submissionId: "proof-latest",
        status: "approved",
      },
    ],
  },
  hiringCompany: { id: "hirer", name: "Sunhub" },
  selected: {
    id: "quote",
    provider_company_id: "provider",
    company: { id: "provider", name: "Test Solar" },
  },
  updates: [],
  files: [],
  ...extra,
});
const event = (id, kind, minute, extra = {}) => ({
  id,
  kind,
  body: "",
  created_at: at(minute),
  provider_company_id: "provider",
  company_id: "provider",
  company_name: "Test Solar",
  actor_name: "Provider Owner",
  ...extra,
});
const hirer = {
  company_id: "hirer",
  company_name: "Sunhub",
  actor_name: "Hiring Owner",
};
const history = (events, versions = []) => ({
  quote: { id: "quote" },
  events,
  versions,
});
const file = (id, extra = {}) => ({
  id,
  original_name: `${id}.pdf`,
  mime_type: "application/pdf",
  size_bytes: 100,
  ...extra,
});
const update = (id, body, minute, extra = {}) => ({
  id,
  kind: "progress",
  body,
  created_at: at(minute),
  company_id: "provider",
  company_name: "Test Solar",
  provider_company_id: "provider",
  ...extra,
});

test("the project story uses recorded actions, actors and dates, oldest first", () => {
  const entries = buildJobHistory(
    detail(),
    history([
      event("accepted", "work_accepted", 10, hirer),
      event("confirmed", "award_accepted", 4),
      event("sent", "quote_submitted", 1),
      event("chosen", "company_chosen", 3, hirer),
      event("completion", "work_submitted", 9),
    ]),
  );
  assert.deepEqual(
    entries.map((entry) => entry.title),
    [
      "Job created",
      "Quote received",
      "Company chosen",
      "Company confirmed the job",
      "Work sent for final review",
      "Job completed",
    ],
  );
  assert.equal(entries.at(-1).at, at(10));
  assert.equal(entries.at(-1).actor, "Hiring Owner · Sunhub");
  assert.equal(entries[3].actor, "Provider Owner · Test Solar");
  assert.ok(
    !entries.some((entry) => entry.at === at(59)),
    "updated_at is not a completion date",
  );
});

test("events and updates represent one action with the correct evidence attached", () => {
  const proof = update(
    "proof-latest",
    "Proof submitted: Install modules\n\nEvidence note.",
    5,
  );
  const entries = buildJobHistory(
    detail({
      updates: [proof, proof],
      files: [
        file("proof-doc", { update_id: proof.id }),
        file("unrelated", { update_id: "other" }),
      ],
    }),
    history([
      event("proof-event", "progress", 5, {
        update_id: proof.id,
        body: proof.body,
      }),
      event("proof-event", "progress", 5, {
        update_id: proof.id,
        body: proof.body,
      }),
    ]),
  );
  const proofs = entries.filter((entry) => entry.kind === "task_proof");
  assert.equal(proofs.length, 1);
  assert.equal(proofs[0].taskId, "task");
  assert.equal(proofs[0].taskTitle, "Install modules");
  assert.equal(proofs[0].body, proof.body);
  assert.deepEqual(
    proofs[0].files.map((item) => item.id),
    ["proof-doc"],
  );
});

test("a returned task preserves original proof, change request, resubmission and approval", () => {
  const entries = buildJobHistory(
    detail(),
    history([
      event("original", "progress", 1, {
        update_id: "old-proof",
        body: "Proof submitted: Install modules\n\nOriginal PDF.",
      }),
      event("changes", "progress", 2, {
        ...hirer,
        update_id: "changes-update",
        body: "Task changes requested: Install modules\n\nAdd close-up photos.",
      }),
      event("new", "progress", 3, {
        update_id: "proof-latest",
        body: "Proof submitted: Install modules\n\nAdded photos.",
      }),
      event("approved", "progress", 4, {
        ...hirer,
        update_id: "approval-update",
        body: "Task approved: Install modules",
      }),
    ]),
  );
  assert.deepEqual(
    entries.slice(1).map((entry) => [entry.title, entry.tone]),
    [
      ["Task proof submitted", "blue"],
      ["Task changes requested", "orange"],
      ["Task proof resubmitted", "blue"],
      ["Task approved", "green"],
    ],
  );
  assert.match(entries[2].body, /Add close-up photos/);
  assert.ok(entries.slice(1).every((entry) => entry.taskId === "task"));
});

test("plain progress cannot gain task approval semantics from the wrong actor or an unknown task", () => {
  const entries = buildJobHistory(
    detail(),
    history([
      event("provider-claim", "progress", 1, {
        body: "Task approved: Install modules",
      }),
      event("unknown-task", "progress", 2, {
        ...hirer,
        body: "Task approved: An unrelated task",
      }),
      event("prefix-only", "progress", 3, {
        ...hirer,
        body: "Task approved: Install modules someday",
      }),
    ]),
  );
  assert.ok(
    entries
      .slice(1)
      .every((entry) => entry.kind === "progress" && !entry.taskId),
  );
});

test("history unavailable retains known updates but never invents quote, confirmation or acceptance", () => {
  const d = detail({
    updates: [
      update("done", "Final documents ready.", 8, { kind: "completion" }),
    ],
  });
  const before = JSON.stringify(d);
  const entries = buildJobHistory(d, null);
  assert.deepEqual(
    entries.map((entry) => entry.title),
    ["Job created", "Work sent for final review"],
  );
  assert.equal(
    JSON.stringify(d),
    before,
    "model does not mutate the source response",
  );
});

test("chosen-provider history excludes other providers and their documents", () => {
  const entries = buildJobHistory(
    detail({
      updates: [
        update("other-update", "Not this project thread.", 2, {
          provider_company_id: "competitor",
        }),
      ],
      files: [
        file("private-other", {
          update_id: "ours",
          provider_company_id: "competitor",
        }),
        file("ours-file", {
          update_id: "ours",
          provider_company_id: "provider",
        }),
      ],
    }),
    history([
      event("other-event", "quote_submitted", 1, {
        provider_company_id: "competitor",
      }),
      event("ours-event", "progress", 3, { update_id: "ours" }),
    ]),
  );
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["job:job", "event:ours-event"],
  );
  assert.deepEqual(
    entries[1].files.map((item) => item.id),
    ["ours-file"],
  );
});

test("quote revisions keep their own document snapshot instead of current-version files", () => {
  const entries = buildJobHistory(
    detail({
      files: [file("current-only", { quote_id: "quote", quote_version: 2 })],
    }),
    history(
      [
        event("quote-first", "quote_submitted", 1, {
          quote_id: "quote",
          quote_version: 1,
        }),
        event("quote-revised", "quote_revised", 2, {
          quote_id: "quote",
          quote_version: 2,
        }),
      ],
      [
        { version: 2, files: [file("revised")] },
        { version: 1, files: [file("original")] },
      ],
    ),
  );
  assert.deepEqual(
    entries[1].files.map((item) => item.id),
    ["original"],
  );
  assert.deepEqual(
    entries[2].files.map((item) => item.id),
    ["revised"],
  );
});

test("final acceptance note copied into a legacy update appears once", () => {
  const body = "Thanks for the completed work.";
  const entries = buildJobHistory(
    detail({
      updates: [update("decision-copy", body, 5, { ...hirer, kind: "system" })],
    }),
    history([event("decision", "work_accepted", 5, { ...hirer, body })]),
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[1].title, "Job completed");
  assert.equal(entries[1].body, body);
});

test("invalid timestamps are omitted and timezone offsets sort by the actual instant", () => {
  const entries = buildJobHistory(
    detail(),
    history([
      event("invalid", "work_accepted", 1, { created_at: "not-a-date" }),
      event("late", "progress", 2, { created_at: "2026-11-13T17:00:00Z" }),
      event("early", "progress", 3, {
        created_at: "2026-11-13T21:30:00+05:00",
      }),
    ]),
  );
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["job:job", "event:early", "event:late"],
  );
});

test("legacy recorded quote is not presented as a newly sent quote", () => {
  const entries = buildJobHistory(
    detail(),
    history([event("legacy", "quote_recorded", 3)]),
  );
  assert.equal(entries[1].title, "Existing quote recorded");
  assert.equal(entries[1].at, at(3));
});
