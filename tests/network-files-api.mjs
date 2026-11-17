// Run against the isolated full API + Rust gateway; never production.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import pg from "pg";
const database = new URL(
  process.env.DATABASE_URL ||
    "postgres://sunhub:sunhub_local@127.0.0.1:5438/colabb_network_ui_v2_test",
);
assert.ok(
  ["localhost", "127.0.0.1"].includes(database.hostname) &&
    database.pathname.endsWith("_test"),
  "Use a local test database",
);
const db = new pg.Pool({ connectionString: database.href });
const base = process.env.API_TEST_URL || "http://localhost:4410";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Local test services only");
const prefix = "Network " + randomUUID().slice(0, 8),
  password = "ColabbNetworkLocalTest123!";
let checks = 0;
async function call(path, actor, method = "GET", body, expected) {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(actor ? { cookie: actor.cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (expected)
    assert.equal(
      r.status,
      expected,
      `${method} ${path}: ${JSON.stringify(data)}`,
    );
  else
    assert.ok(r.ok, `${method} ${path} ${r.status}: ${JSON.stringify(data)}`);
  checks++;
  return data;
}
async function account(name) {
  const email = `network-${randomUUID()}@example.test`;
  const r = await fetch(base + "/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      companyName: prefix + " " + name,
      email,
      password,
    }),
  });
  assert.equal(r.status, 201);
  const body = await r.json();
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const a = {
    name,
    email,
    password,
    cookie,
    user: body.user.id,
    company: body.activeCompanyId,
  };
  await call("/api/onboarding/complete", a, "POST", { followIds: [] });
  await db.query(
    "UPDATE users SET email_verified_at=now() WHERE id=$1 AND email=$2",
    [a.user, email],
  );
  return a;
}
const n = "/api/network-v2";
const owner = await account("Host"),
  member = await account("Member"),
  outsider = await account("Other company");
const topic = {
  id: randomUUID(),
  label: "Modules",
  version: 1,
  fields: [
    {
      id: randomUUID(),
      label: "Quantity",
      type: "number",
      required: true,
      unit: "modules",
      min: 1,
      step: 1,
    },
  ],
};
const { community } = await call(n + "/communities", owner, "POST", {
  name: prefix + " Equipment",
  description:
    "An isolated equipment sourcing community for Network verification.",
  visibility: "private",
  join_policy: "approval",
  rules: [{ title: "Clear requests", body: "Include quantity and location." }],
  topics: [topic],
  require_topic: true,
});
await call(`${n}/communities/${community.id}/membership`, member, "POST", {
  action: "join",
});
await call(
  `${n}/communities/${community.id}/members/${member.user}`,
  owner,
  "POST",
  { action: "approve" },
);
const pdf = Buffer.from("%PDF-1.7\nIsolated network plan\n%%EOF");
const uploadId = randomUUID();
async function upload(
  actor,
  query,
  bytes = pdf,
  mime = "application/pdf",
  expected = 200,
) {
  const r = await fetch(
    base + n + "/files?" + new URLSearchParams({ name: "plan.pdf", ...query }),
    {
      method: "POST",
      headers: { cookie: actor.cookie, "content-type": mime },
      body: bytes,
    },
  );
  const data = await r.json();
  assert.equal(r.status, expected, JSON.stringify(data));
  checks++;
  return data;
}
const { file } = await upload(member, {
  community_id: community.id,
  upload_id: uploadId,
});
assert.equal(
  (await upload(member, { community_id: community.id, upload_id: uploadId }))
    .file.id,
  file.id,
);
checks++;
await upload(
  member,
  { community_id: community.id, upload_id: uploadId },
  Buffer.from("%PDF-different"),
  "application/pdf",
  409,
);
await upload(
  outsider,
  { community_id: community.id },
  pdf,
  "application/pdf",
  403,
);
await upload(
  owner,
  {},
  Buffer.from("<svg><script>alert(1)</script></svg>"),
  "image/svg+xml",
  400,
);
await upload(owner, {}, pdf, "image/png", 400);
await upload(owner, { name: "../../private.pdf" }, pdf, "application/pdf", 400);
assert.equal(
  (await fetch(base + file.url, { headers: { cookie: owner.cookie } })).status,
  404,
);
checks++;
const { post } = await call(n + "/posts", member, "POST", {
  client_id: randomUUID(),
  community_id: community.id,
  kind: "sourcing",
  title: "200 modules needed for a rooftop project",
  body: "Please confirm availability for 200 solar modules and delivery to Cleveland.",
  topic_id: topic.id,
  topic_version: 1,
  answers: [{ field_id: topic.fields[0].id, value: "200" }],
  file_ids: [file.id],
  media_format: "4:5",
  comments_open: true,
});
for (const a of [owner, member]) {
  const r = await fetch(base + file.url + "?preview=1", {
    headers: { cookie: a.cookie },
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(r.headers.get("content-disposition"), /^inline/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), pdf);
  checks += 5;
}
assert.equal(
  (await fetch(base + file.url, { headers: { cookie: outsider.cookie } }))
    .status,
  404,
);
checks++;
await call(`${n}/posts/${post.id}/comments`, owner, "POST", {
  client_id: randomUUID(),
  body: "Please include the module model and proposed delivery date.",
});
const before = await call("/api/notifications?scope=colabb", member);
assert.ok(
  before.notifications.some((x) => x.url.includes(post.id)),
  "Network reply is visible in global bell",
);
checks++;
await call(
  `${n}/communities/${community.id}/members/${member.user}`,
  owner,
  "POST",
  { action: "remove" },
);
assert.equal(
  (await fetch(base + file.url, { headers: { cookie: member.cookie } })).status,
  404,
);
checks++;
const after = await call("/api/notifications?scope=colabb", member);
assert.ok(
  !after.notifications.some((x) => x.url.includes(post.id)),
  "Private notification disappears on membership removal",
);
checks++;
await call(`${n}/posts/${post.id}`, member, "GET", undefined, 404);
await call(
  `${n}/communities/${community.id}/membership`,
  member,
  "POST",
  { action: "join" },
  403,
);
const invitation = await call(
  `${n}/communities/${community.id}/invitations`,
  owner,
  "POST",
  { email: member.email, role: "member" },
);
await call(
  `${n}/invitations/${invitation.invite_url.split("/").at(-1)}`,
  member,
  "POST",
  { action: "accept" },
);
const image = await fs.readFile("apps/colabb/public/assets/solar.jpg");
const { file: photo } = await upload(
  owner,
  { name: "rooftop.jpg" },
  image,
  "image/jpeg",
);
const publicPost = await call(n + "/posts", owner, "POST", {
  client_id: randomUUID(),
  kind: "post",
  title: "",
  body: "A look at the work happening on site. Our next rooftop installation is underway.",
  answers: [],
  file_ids: [photo.id],
  media_format: "4:5",
  comments_open: true,
});
if (process.env.NETWORK_UI_FIXTURES)
  await fs.writeFile(
    process.env.NETWORK_UI_FIXTURES,
    JSON.stringify(
      {
        base,
        owner,
        member,
        outsider,
        community,
        post,
        publicPost: publicPost.post,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
await db.end();
console.log(
  `Network files and global-notification integration: ${checks} checks passed.`,
);
