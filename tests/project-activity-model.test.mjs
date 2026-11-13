import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText,
  ).toString("base64")}`;
const base = new URL("../apps/web/src/", import.meta.url);
const historyModule = moduleUrl(
  await readFile(new URL("job-history-model.ts", base), "utf8"),
);
const source = (
  await readFile(new URL("project-activity-model.ts", base), "utf8")
).replace('from "./job-history-model"', `from "${historyModule}"`);
const {
  activityTasks,
  scopedActivityDetail,
  scopedActivityHistory,
  pendingActivityCount,
  taskActivityEventId,
} = await import(moduleUrl(source));
const date = (n) => `2026-11-13T16:0${n}:00Z`;
const quote = (provider) => ({
  id: `quote-${provider}`,
  provider_company_id: provider,
  company: { id: provider, name: provider },
});
const file = (id, provider, extra = {}) => ({
  id,
  provider_company_id: provider,
  original_name: `${id}.pdf`,
  mime_type: "application/pdf",
  size_bytes: 100,
  ...extra,
});
const event = (id, provider, kind = "quote_submitted", extra = {}) => ({
  id,
  provider_company_id: provider,
  kind,
  created_at: date(1),
  body: "",
  company_name: provider,
  actor_name: provider,
  ...extra,
});
const detail = (extra = {}) => ({
  job: {
    id: "job",
    created_at: date(0),
    status: "in_progress",
    work_checklist: [
      {
        id: "task",
        title: "Inspect wiring",
        status: "submitted",
        submissionId: "proof",
        proofFiles: [file("proof", "selected")],
      },
    ],
  },
  hiringCompany: { id: "hirer", name: "Sunhub" },
  selected: quote("selected"),
  ownQuote: null,
  quotes: [quote("selected"), quote("other")],
  conversations: [
    { id: "selected", name: "Selected Solar" },
    { id: "other", name: "Other Solar" },
  ],
  permissions: { hirer: true, chosen: false, invited: false, quoted: false },
  updates: [
    {
      id: "proof",
      kind: "progress",
      provider_company_id: "selected",
      company_name: "selected",
      body: "Proof submitted: Inspect wiring",
      created_at: date(2),
    },
  ],
  files: [
    file("job-plan", null),
    file("quote-selected", "selected", { quote_id: "quote-selected" }),
    file("quote-other", "other", { quote_id: "quote-other" }),
    file("proof", "selected", { update_id: "proof" }),
  ],
  paymentStages: [{ id: "stage" }],
  agreement: { amount_cents: 10000 },
  paymentStagesNeedReview: true,
  reviews: [],
  ...extra,
});
const history = (events = [], extra = {}) => ({
  quote: null,
  events,
  versions: [],
  changes: [],
  permissions: {},
  ...extra,
});

test("a competing-provider thread cannot receive the selected provider's proof, agreement or files", () => {
  const source = detail();
  const before = JSON.stringify(source);
  const scoped = scopedActivityDetail(source, "other");
  assert.equal(scoped.selected, null);
  assert.equal(scoped.agreement, null);
  assert.deepEqual(scoped.job.work_checklist, []);
  assert.deepEqual(scoped.updates, []);
  assert.deepEqual(scoped.paymentStages, []);
  assert.deepEqual(
    scoped.files.map((file) => file.id),
    ["job-plan", "quote-other"],
  );
  assert.equal(JSON.stringify(source), before);
});

test("historical activity follows this provider even when a different provider was chosen", () => {
  const entries = scopedActivityHistory(
    detail(),
    history([
      event("selected-quote", "selected"),
      event("other-quote", "other"),
      event("other-declined", "other", "quote_declined", {
        created_at: date(3),
      }),
    ]),
    "other",
  );
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["event:other-quote", "event:other-declined"],
  );
  assert.ok(entries.every((entry) => !entry.taskId));
});

test("a selected-company task gets meaningful proof semantics and no duplicate event/update", () => {
  const entries = scopedActivityHistory(
    detail(),
    history([
      event("proof-event", "selected", "progress", {
        update_id: "proof",
        body: "Proof submitted: Inspect wiring",
        created_at: date(2),
      }),
    ]),
    "selected",
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "Task proof submitted");
  assert.equal(entries[0].taskId, "task");
  assert.deepEqual(
    entries[0].files.map((file) => file.id),
    ["proof"],
  );
});

test("quote attachment snapshots exclude files belonging to another provider", () => {
  const entries = scopedActivityHistory(
    detail(),
    history(
      [
        event("other-quote", "other", "quote_revised", {
          quote_id: "quote-other",
          quote_version: 2,
        }),
      ],
      {
        quote: { id: "quote-other" },
        versions: [
          {
            version: 2,
            files: [file("right", "other"), file("private", "selected")],
          },
        ],
      },
    ),
    "other",
  );
  assert.deepEqual(
    entries[0].files.map((file) => file.id),
    ["right"],
  );
});

test("no quote or missing history never invents selected-company milestones", () => {
  assert.deepEqual(
    scopedActivityHistory(
      detail({ quotes: [], selected: null }),
      null,
      "other",
    ),
    [],
  );
  const entries = scopedActivityHistory(
    detail({ quotes: [], selected: null }),
    history([event("real", "other", "quote_withdrawn")]),
    "other",
  );
  assert.deepEqual(
    entries.map((entry) => entry.title),
    ["Quote withdrawn"],
  );
});

test("pending counts only actions authorized for this company and thread", () => {
  const d = detail();
  assert.equal(pendingActivityCount(d, null, "selected", true), 1);
  assert.equal(pendingActivityCount(d, null, "selected", false), 0);
  assert.equal(pendingActivityCount(d, null, "other", true), 0);
  const provider = detail({
    permissions: { hirer: false, chosen: true },
    job: {
      ...d.job,
      work_checklist: [{ id: "task", status: "changes_requested" }],
    },
  });
  assert.equal(pendingActivityCount(provider, null, "selected", true), 1);
  assert.equal(pendingActivityCount(provider, null, "other", true), 0);
  assert.equal(
    pendingActivityCount(
      detail({ job: { ...d.job, status: "completed" } }),
      null,
      "selected",
      true,
    ),
    0,
  );
});

test("quote changes, confirmation, agreement changes, and final review are distinct pending actions", () => {
  const d = detail();
  const open = detail({
    job: { ...d.job, status: "open", work_checklist: [] },
    selected: null,
  });
  assert.equal(
    pendingActivityCount(
      open,
      history([], { permissions: { canDecide: true } }),
      "other",
      true,
    ),
    1,
  );
  assert.equal(
    pendingActivityCount(
      open,
      history([], {
        quote: { status: "changes_requested" },
        permissions: { canRevise: true },
      }),
      "other",
      true,
    ),
    1,
  );
  assert.equal(
    pendingActivityCount(
      open,
      history([], {
        quote: { status: "submitted" },
        permissions: { canRevise: true },
      }),
      "other",
      true,
    ),
    0,
  );
  const review = detail({
    job: { ...d.job, status: "review", work_checklist: [] },
  });
  assert.equal(
    pendingActivityCount(
      review,
      history([], { changes: [{ status: "pending", company_id: "selected" }] }),
      "selected",
      true,
    ),
    2,
  );
  assert.equal(
    pendingActivityCount(
      review,
      history([], { changes: [{ status: "pending", company_id: "hirer" }] }),
      "selected",
      true,
    ),
    1,
  );
});

test("proof attachments are defensively filtered even in the selected company's checklist", () => {
  const d = detail();
  d.job.work_checklist[0].proofFiles.push(file("foreign-proof", "other"));
  assert.deepEqual(
    activityTasks(d, "selected")[0].proofFiles.map((file) => file.id),
    ["proof"],
  );
});

test("a viewer outside the chosen job participants receives no proof or agreement", () => {
  const source = detail({
    permissions: { hirer: false, chosen: false, invited: true },
  });
  const scoped = scopedActivityDetail(source, "selected");
  assert.deepEqual(scoped.job.work_checklist, []);
  assert.deepEqual(scoped.updates, []);
  assert.equal(scoped.agreement, null);
  assert.equal(scoped.selected, null);
  assert.ok(scoped.files.every((file) => !file.update_id));
});

test("proof cards mark only the event for the current submission as read", () => {
  const d = detail();
  const h = history([
    event("old-proof-event", "selected", "progress", {
      update_id: "old-proof",
      body: "Proof submitted: Inspect wiring",
    }),
    event("current-proof-event", "selected", "progress", {
      update_id: "proof",
      body: "Proof submitted: Inspect wiring",
      created_at: date(2),
    }),
  ]);
  const entries = scopedActivityHistory(d, h, "selected");
  assert.equal(
    taskActivityEventId(d.job.work_checklist[0], entries, h),
    "current-proof-event",
  );
  assert.equal(
    taskActivityEventId(
      { ...d.job.work_checklist[0], submissionId: "missing" },
      entries,
      h,
    ),
    undefined,
  );
  assert.equal(
    taskActivityEventId(d.job.work_checklist[0], entries, null),
    undefined,
  );
});

test("changes cards require an exact recorded review time and never use synthetic updates", () => {
  const d = detail();
  const task = {
    ...d.job.work_checklist[0],
    status: "changes_requested",
    reviewedAt: date(3),
  };
  d.job.work_checklist = [task];
  const h = history([
    event("review", "selected", "progress", {
      company_name: "Sunhub",
      company_id: "hirer",
      created_at: date(3),
      body: "Task changes requested: Inspect wiring\n\nAdd a close-up photo.",
    }),
  ]);
  const entries = scopedActivityHistory(d, h, "selected");
  assert.equal(taskActivityEventId(task, entries, h), "review");
  assert.equal(
    taskActivityEventId({ ...task, reviewedAt: date(4) }, entries, h),
    undefined,
  );
  assert.equal(
    taskActivityEventId(
      task,
      entries.map((entry) => ({ ...entry, id: "update:review" })),
      h,
    ),
    undefined,
  );
});
