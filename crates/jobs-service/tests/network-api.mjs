// Exercise real Rust handlers and PostgreSQL constraints in an isolated local DB.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
const base = process.env.JOBS_TEST_URL || "http://127.0.0.1:4421",
  database = process.env.DATABASE_URL || "";
const dburl = new URL(database);
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname) &&
    ["localhost", "127.0.0.1"].includes(dburl.hostname) &&
    dburl.pathname.includes("test"),
  "Isolated local test database only.",
);
const db = new pg.Client({ connectionString: database });
await db.connect();
const users = [],
  companies = [],
  communities = [],
  jobs = [],
  prefix = "network-" + randomUUID().slice(0, 8);
let checks = 0;
async function account(name, company, role = "owner", options = {}) {
  const email = `${prefix}-${randomUUID()}@example.test`;
  const user = (
    await db.query(
      "INSERT INTO users(email,name,password_hash,email_verified_at,onboarding_completed_at,account_type) VALUES($1,$2,'test',CASE WHEN $3 THEN now() ELSE NULL END,now(),$4) RETURNING id",
      [
        email,
        name,
        options.verified !== false,
        options.individual ? "individual" : "company",
      ],
    )
  ).rows[0].id;
  users.push(user);
  if (!company) {
    company = (
      await db.query(
        "INSERT INTO companies(slug,name,username,listing_status,is_demo) VALUES($1,$2,$1,'managed',$3) RETURNING id",
        [prefix + "-" + randomUUID().slice(0, 8), name, !!options.demo],
      )
    ).rows[0].id;
    companies.push(company);
  }
  await db.query(
    "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,$3)",
    [user, company, role],
  );
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,company_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [createHash("sha256").update(token).digest("hex"), user, company],
  );
  return { user, company, email, name, cookie: "connect_session=" + token };
}
async function raw(path, a, method = "GET", body) {
  const r = await fetch(base + "/network-v2" + path, {
    method,
    headers: {
      ...(a ? { cookie: a.cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}
async function call(path, a, method = "GET", body, status = 200) {
  const r = await raw(path, a, method, body);
  assert.equal(
    r.status,
    status,
    `${method} ${path}: ${JSON.stringify(r.data)}`,
  );
  checks++;
  return r.data;
}
async function comm(a, visibility = "public", extra = {}) {
  const result = await call("/communities", a, "POST", {
    name: prefix + " " + visibility,
    description: "An isolated solar collaboration community.",
    visibility,
    join_policy: "open",
    rules: [],
    topics: [],
    require_topic: false,
    ...extra,
  });
  communities.push(result.community.id);
  return result.community;
}
async function post(a, extra = {}) {
  return (
    await call("/posts", a, "POST", {
      client_id: randomUUID(),
      kind: "post",
      title: "",
      body: "A useful company update about this solar project.",
      answers: [],
      file_ids: [],
      media_format: "4:5",
      comments_open: true,
      ...extra,
    })
  ).post;
}
try {
  const h = await account(prefix + " Host"),
    p = await account(prefix + " Provider"),
    other = await account(prefix + " Other");
  const teammate = await account("Provider admin", p.company, "admin"),
    member = await account("Provider member", p.company, "member");
  const unverified = await account("Unverified", p.company, "admin", {
      verified: false,
    }),
    individual = await account("Individual", p.company, "owner", {
      individual: true,
    }),
    demo = await account("Demo", undefined, "owner", { demo: true });
  await call("/bootstrap", null, "GET", undefined, 401);
  assert.equal((await call("/bootstrap", member)).viewer.can_publish, false);
  assert.equal((await call("/bootstrap", h)).viewer.can_host, true);
  checks += 2;
  for (const a of [member, unverified, individual])
    await call(
      "/posts",
      a,
      "POST",
      {
        client_id: randomUUID(),
        body: "Not a publisher",
        kind: "post",
        file_ids: [],
      },
      403,
    );
  await call(
    "/communities",
    member,
    "POST",
    { name: "Forbidden community" },
    403,
  );
  const publicCommunity = await comm(h),
    privateCommunity = await comm(h, "private");
  assert.deepEqual(publicCommunity.post_types, []);
  assert.deepEqual(privateCommunity.post_types, []);
  checks += 2;
  assert.equal(privateCommunity.join_policy, "approval");
  checks++;
  await call(
    "/communities/" + privateCommunity.id,
    demo,
    "GET",
    undefined,
    404,
  );
  let privateRead = (await call("/communities/" + privateCommunity.id, p))
    .community;
  assert.equal(privateRead.can_read, false);
  checks++;
  await call(`/communities/${privateCommunity.id}/membership`, p, "POST", {
    action: "join",
  });
  await call(
    `/posts?community_id=${privateCommunity.id}`,
    p,
    "GET",
    undefined,
    403,
  );
  await call(
    `/communities/${privateCommunity.id}/members/${p.user}`,
    h,
    "POST",
    { action: "approve" },
  );
  await call(`/communities/${publicCommunity.id}/membership`, p, "POST", {
    action: "join",
  });
  await call(`/communities/${publicCommunity.id}/membership`, member, "POST", {
    action: "join",
  });
  await call(
    `/communities/${publicCommunity.id}/membership`,
    h,
    "POST",
    { action: "leave" },
    409,
  );
  const topic = {
    id: randomUUID(),
    label: "Modules",
    fields: [
      {
        id: randomUUID(),
        label: "Quantity",
        type: "number",
        required: true,
        min: 1,
        step: 1,
        unit: "modules",
      },
      { id: randomUUID(), label: "Needed by", type: "date", required: true },
    ],
  };
  const sourcingType = {
    id: randomUUID(),
    label: "Equipment request",
    kind: "sourcing",
  };
  const questionType = {
    id: randomUUID(),
    label: "Ask the community",
    kind: "question",
  };
  let configured = (
    await call(`/communities/${privateCommunity.id}`, h, "PATCH", {
      version: privateCommunity.version,
      topics: [topic],
      post_types: [sourcingType, questionType],
      require_topic: true,
    })
  ).community;
  await call(
    `/communities/${privateCommunity.id}`,
    h,
    "PATCH",
    { version: privateCommunity.version, description: "Stale edit" },
    409,
  );
  await call(
    `/communities/${privateCommunity.id}`,
    p,
    "PATCH",
    { version: configured.version, description: "Not an admin" },
    403,
  );
  const form = {
    community_id: privateCommunity.id,
    kind: "sourcing",
    post_type_id: sourcingType.id,
    post_type_version: 1,
    title: "200 modules needed in Cleveland",
    body: "We need modules for a commercial rooftop project.",
    topic_id: topic.id,
    topic_version: 1,
    answers: [
      { field_id: topic.fields[0].id, value: "200" },
      { field_id: topic.fields[1].id, value: "2027-02-28" },
    ],
  };
  for (const value of ["0", "1.5", "NaN"])
    await call(
      "/posts",
      p,
      "POST",
      {
        ...form,
        client_id: randomUUID(),
        answers: [
          { field_id: topic.fields[0].id, value },
          { field_id: topic.fields[1].id, value: "2027-02-28" },
        ],
      },
      400,
    );
  await call(
    "/posts",
    p,
    "POST",
    {
      ...form,
      client_id: randomUUID(),
      answers: [
        { field_id: topic.fields[0].id, value: "200" },
        { field_id: topic.fields[1].id, value: "2027-02-29" },
      ],
    },
    400,
  );
  await call(
    "/posts",
    p,
    "POST",
    { ...form, client_id: randomUUID(), topic_version: 0 },
    409,
  );
  const request = {
    ...form,
    client_id: randomUUID(),
    file_ids: [],
    media_format: "4:5",
    comments_open: true,
  };
  const race = await Promise.all([
    raw("/posts", p, "POST", request),
    raw("/posts", p, "POST", request),
  ]);
  assert.deepEqual(
    race.map((r) => r.status),
    [200, 200],
  );
  assert.equal(race[0].data.post.id, race[1].data.post.id);
  checks += 2;
  let sourced = race[0].data.post;
  assert.equal(sourced.answers[0].label, "Quantity");
  checks++;
  await call(
    "/posts",
    p,
    "POST",
    { ...request, body: "Different retry payload" },
    409,
  );
  await call("/posts/" + sourced.id, other, "GET", undefined, 404);
  await call("/posts/" + sourced.id, demo, "GET", undefined, 404);
  await call(
    "/posts/" + sourced.id,
    teammate,
    "PATCH",
    {
      version: sourced.version,
      body: "Team admin cannot edit personal community discussion.",
    },
    404,
  );
  await call(
    `/communities/${privateCommunity.id}/membership`,
    teammate,
    "POST",
    { action: "join" },
  );
  await call(
    `/communities/${privateCommunity.id}/members/${teammate.user}`,
    h,
    "POST",
    { action: "approve" },
  );
  await call(
    "/posts/" + sourced.id,
    teammate,
    "PATCH",
    {
      version: sourced.version,
      body: "Team admin still cannot edit someone else.",
    },
    403,
  );
  configured = (
    await call(`/communities/${privateCommunity.id}`, h, "PATCH", {
      version: configured.version,
      topics: [
        {
          ...topic,
          label: "Solar modules",
          fields: [
            { ...topic.fields[0], label: "Module count" },
            topic.fields[1],
          ],
        },
      ],
    })
  ).community;
  sourced = (
    await call("/posts/" + sourced.id, p, "PATCH", {
      version: sourced.version,
      body: "Updated sourcing description.",
      answers: [{ field_id: topic.fields[0].id, value: "220" }],
    })
  ).post;
  assert.equal(sourced.answers[0].label, "Quantity");
  assert.equal(sourced.topic_label, "Modules");
  assert.equal(sourced.answers.length, 2);
  checks += 3;
  await call(
    "/posts/" + sourced.id,
    p,
    "PATCH",
    { version: 1, body: "Stale" },
    409,
  );
  const draftID = randomUUID();
  let draft = (
    await call("/drafts/" + draftID, p, "PUT", {
      version: 0,
      body: { ...form, body: "Private draft" },
    })
  ).draft;
  assert.equal((await call("/drafts", teammate)).items.length, 0);
  checks++;
  await call(
    "/drafts/" + draftID,
    teammate,
    "PUT",
    { version: draft.version, body: { body: "Stolen draft" } },
    403,
  );
  const dr = await Promise.all([
    raw("/drafts/" + draftID, p, "PUT", {
      version: draft.version,
      body: { ...form, body: "First" },
    }),
    raw("/drafts/" + draftID, p, "PUT", {
      version: draft.version,
      body: { ...form, body: "Second" },
    }),
  ]);
  assert.deepEqual(dr.map((r) => r.status).sort(), [200, 409]);
  checks++;
  draft = (await call("/drafts", p)).items.find((d) => d.id === draftID);
  const top = (
    await call(`/posts/${sourced.id}/comments`, h, "POST", {
      client_id: randomUUID(),
      body: "Please confirm module wattage.",
    })
  ).comment;
  const reply = (
    await call(`/posts/${sourced.id}/comments`, p, "POST", {
      client_id: randomUUID(),
      body: "We need 450 W modules.",
      parent_id: top.id,
    })
  ).comment;
  await call(
    `/posts/${sourced.id}/comments`,
    p,
    "POST",
    {
      client_id: randomUUID(),
      body: "Too deeply nested.",
      parent_id: reply.id,
    },
    400,
  );
  await call(
    "/comments/" + top.id,
    p,
    "PATCH",
    { version: top.version, body: "Not my reply" },
    403,
  );
  await call("/comments/" + top.id, h, "DELETE", { version: top.version });
  const comments = (await call(`/posts/${sourced.id}/comments`, p)).items;
  assert.equal(comments.find((c) => c.id === top.id).body, "");
  assert.ok(comments.find((c) => c.id === reply.id));
  checks += 2;
  const notification = (await call("/notifications", p)).items.find(
    (n) => n.post_id === sourced.id,
  );
  assert.ok(notification);
  checks++;
  await call("/notifications/read", other, "POST", { ids: [notification.id] });
  assert.equal(
    (
      await db.query("SELECT read_at FROM user_notifications WHERE id=$1", [
        notification.id,
      ])
    ).rows[0].read_at,
    null,
  );
  checks++;
  await call("/notifications/read", p, "POST", { ids: [notification.id] });
  assert.ok(
    (
      await db.query("SELECT read_at FROM user_notifications WHERE id=$1", [
        notification.id,
      ])
    ).rows[0].read_at,
  );
  checks++;
  await call(`/posts/${sourced.id}/state`, p, "POST", {
    action: "comments",
    value: false,
  });
  await call(
    `/posts/${sourced.id}/comments`,
    h,
    "POST",
    { client_id: randomUUID(), body: "Closed discussion" },
    403,
  );
  await call(`/posts/${sourced.id}/state`, h, "POST", {
    action: "comments",
    value: true,
  });
  await call(`/posts/${sourced.id}/state`, p, "POST", {
    action: "sourcing",
    value: "sourced",
  });
  assert.equal(
    (await call("/posts/" + sourced.id, p)).post.sourcing_status,
    "sourced",
  );
  checks++;
  const pdf = Buffer.from("%PDF-1.7\nNetwork sourcing test attachment\n%%EOF");
  const fileIds = [];
  for (let f = 0; f < 2; f++) {
    const upload = await fetch(
      base +
        `/network-v2/files?name=plan-${f}.pdf&community_id=${privateCommunity.id}&upload_id=${randomUUID()}`,
      {
        method: "POST",
        headers: { cookie: p.cookie, "content-type": "application/pdf" },
        body: pdf,
      },
    );
    assert.equal(upload.status, 200);
    fileIds.push((await upload.json()).file.id);
    checks++;
  }
  const fileSource = await post(p, {
    ...form,
    topic_version: configured.topics[0].version,
    file_ids: fileIds,
  });
  const fileJob = await call(`/posts/${fileSource.id}/job-draft`, p, "POST", {
    title: "Source modules with selected plan",
    description: "Only the chosen plan should be copied into the job draft.",
    location: "Cleveland",
    file_ids: [fileIds[0]],
  });
  jobs.push(fileJob.job_id);
  const copied = (
    await db.query("SELECT id,storage_key FROM job_files WHERE job_id=$1", [
      fileJob.job_id,
    ])
  ).rows;
  assert.equal(copied.length, 1);
  assert.ok(copied[0].storage_key.startsWith("jobs/"));
  checks += 2;
  const copiedFile = await fetch(base + "/jobs/files/" + copied[0].id, {
    headers: { cookie: p.cookie },
  });
  assert.equal(copiedFile.status, 200);
  assert.deepEqual(Buffer.from(await copiedFile.arrayBuffer()), pdf);
  checks += 2;
  await call(`/posts/${fileSource.id}`, p, "DELETE", {
    version: fileSource.version,
  });
  const independentCopy = await fetch(base + "/jobs/files/" + copied[0].id, {
    headers: { cookie: p.cookie },
  });
  assert.equal(independentCopy.status, 200);
  checks++;
  const draftJob = await call(`/posts/${sourced.id}/job-draft`, p, "POST", {
    title: "Source solar modules for Cleveland",
    description: "Please source 220 solar modules rated at 450 W.",
    location: "Cleveland, OH",
    start_window: "Within two weeks",
    file_ids: [],
  });
  jobs.push(draftJob.job_id);
  assert.equal(
    (await db.query("SELECT status FROM jobs WHERE id=$1", [draftJob.job_id]))
      .rows[0].status,
    "draft",
  );
  checks++;
  assert.equal(
    (
      await call(`/posts/${sourced.id}/job-draft`, p, "POST", {
        title: "Source solar modules for Cleveland",
        description: "Please source 220 solar modules rated at 450 W.",
        file_ids: [],
      })
    ).job_id,
    draftJob.job_id,
  );
  checks++;
  await call(
    `/posts/${sourced.id}/job-draft`,
    h,
    "POST",
    {
      title: "Not mine",
      description: "Cannot copy another person post",
      file_ids: [],
    },
    403,
  );
  await call(
    `/communities/${privateCommunity.id}/members/${p.user}`,
    h,
    "POST",
    { action: "remove" },
  );
  assert.equal(
    (await call("/drafts", p)).items.find((d) => d.id === draftID).can_publish,
    false,
  );
  assert.equal(
    (await call("/notifications", p)).items.some(
      (n) => n.post_id === sourced.id,
    ),
    false,
  );
  checks += 2;
  await call("/posts/" + sourced.id, p, "GET", undefined, 404);
  await call(
    `/communities/${privateCommunity.id}/membership`,
    p,
    "POST",
    { action: "join" },
    403,
  );
  const inv = await call(
    `/communities/${privateCommunity.id}/invitations`,
    h,
    "POST",
    { email: p.email, role: "member" },
  );
  let token = inv.invite_url.split("/").at(-1);
  const preview = await call("/invitations/" + token, other);
  assert.equal(preview.email_matches, false);
  assert.equal(preview.invitation.email, "");
  checks += 2;
  await call("/invitations/" + token, other, "POST", { action: "accept" }, 403);
  await db.query(
    "UPDATE network_invitations SET expires_at=now()-interval '1 second' WHERE id=$1",
    [inv.invitation.id],
  );
  await call("/invitations/" + token, p, "POST", { action: "accept" }, 409);
  const renewed = await call(
    `/communities/${privateCommunity.id}/invitations/${inv.invitation.id}`,
    h,
    "POST",
    { action: "renew" },
  );
  await call("/invitations/" + token, p, "GET", undefined, 404);
  token = renewed.invite_url.split("/").at(-1);
  await call("/invitations/" + token, p, "POST", { action: "accept" });
  await call("/invitations/" + token, p, "POST", { action: "accept" }, 409);
  assert.equal((await call("/posts/" + sourced.id, p)).post.id, sourced.id);
  checks++;
  const companyPost = await post(p);
  await call("/posts/" + companyPost.id, teammate, "PATCH", {
    version: companyPost.version,
    body: "An updated official company post.",
  });
  await call(
    "/posts/" + companyPost.id,
    member,
    "PATCH",
    { version: 2, body: "Not a publisher." },
    403,
  );
  await call(`/posts/${companyPost.id}/state`, h, "POST", {
    action: "save",
    value: true,
  });
  assert.ok(
    (await call("/posts?saved=true", h)).items.some(
      (p) => p.id === companyPost.id,
    ),
  );
  checks++;
  await call(`/posts/${companyPost.id}/state`, h, "POST", {
    action: "hide",
    value: true,
  });
  assert.equal(
    (await call("/posts", h)).items.some((p) => p.id === companyPost.id),
    false,
  );
  assert.equal(
    (await call("/posts", other)).items.some((p) => p.id === companyPost.id),
    true,
  );
  checks += 2;
  await call(`/posts/${companyPost.id}/state`, h, "POST", {
    action: "hide",
    value: false,
  });
  await call(`/companies/${p.company}/follow`, h, "POST", { following: true });
  await call("/notification-preferences", h, "PUT", {
    replies: true,
    mentions: true,
    community_posts: true,
    company_posts: false,
  });
  const silent = await post(p);
  assert.equal(
    (await call("/notifications", h)).items.some(
      (n) => n.post_id === silent.id,
    ),
    false,
  );
  checks++;
  await call("/notification-preferences", h, "PUT", {
    replies: true,
    mentions: true,
    community_posts: true,
    company_posts: true,
  });
  const notified = await post(p);
  assert.equal(
    (await call("/notifications", h)).items.some(
      (n) => n.post_id === notified.id,
    ),
    true,
  );
  checks++;
  const companyMention = await post(p, {
    body: `Working with @${h.name} on the next project.`,
    mention_company_ids: [h.company],
  });
  assert.deepEqual(companyMention.mentions, [
    { id: h.company, kind: "company", name: h.name },
  ]);
  checks++;
  assert.ok(
    (await call("/notifications", h)).items.some(
      (n) => n.post_id === companyMention.id && n.type === "network_mention",
    ),
  );
  checks++;
  const userMention = await post(p, {
    body: `Thanks @${h.name} for the detailed scope.`,
    mention_user_ids: [h.user],
  });
  assert.equal(userMention.mentions[0].kind, "user");
  checks++;
  const hiddenMention = await post(p, {
    community_id: privateCommunity.id,
    kind: "question",
    post_type_id: questionType.id,
    post_type_version: 1,
    title: "Private mention access check",
    body: `Question for @${other.name}`,
    topic_id: topic.id,
    topic_version: configured.topics[0].version,
    answers: form.answers,
    mention_user_ids: [other.user],
  });
  assert.equal(hiddenMention.mentions.length, 0);
  assert.equal(
    (await call("/notifications", other)).items.some(
      (n) => n.post_id === hiddenMention.id,
    ),
    false,
  );
  checks += 2;
  let mentionedEdit = (
    await call("/posts/" + companyMention.id, p, "PATCH", {
      version: companyMention.version,
      body: `Working with @${h.name} and @${other.name}.`,
      mention_company_ids: [h.company, other.company],
    })
  ).post;
  assert.equal(mentionedEdit.mentions.length, 2);
  checks++;
  const mentionCount = (
    await db.query(
      "SELECT count(*)::int AS n FROM user_notifications WHERE user_id=$1 AND source_id=$2 AND type='network_mention'",
      [other.user, companyMention.id],
    )
  ).rows[0].n;
  await call("/posts/" + companyMention.id, p, "PATCH", {
    version: mentionedEdit.version,
    body: `A revised note about @${h.name} and @${other.name}.`,
    mention_company_ids: [h.company, other.company],
  });
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM user_notifications WHERE user_id=$1 AND source_id=$2 AND type='network_mention'",
        [other.user, companyMention.id],
      )
    ).rows[0].n,
    mentionCount,
  );
  checks++;
  const suggest = (await call("/bootstrap", h)).suggested_companies;
  assert.equal(
    suggest.some((c) => c.id === h.company || c.id === p.company),
    false,
  );
  checks++;
  assert.equal(
    (await call("/companies?suggested=true", h)).items.some(
      (c) => c.id === p.company,
    ),
    false,
  );
  checks++;
  await call(`/posts/${companyPost.id}/report`, h, "POST", {
    reason: "Misleading details",
    details: "Please review this company post.",
  });
  await call("/admin/reports", h, "GET", undefined, 403);
  await db.query("INSERT INTO network_administrators(user_id) VALUES($1)", [
    other.user,
  ]);
  const companyReport = (await call("/admin/reports", other)).items.find(
    (r) => r.post_id === companyPost.id,
  );
  assert.ok(companyReport);
  checks++;
  await call(
    `/reports/${companyReport.id}/resolve`,
    h,
    "POST",
    { decision: "remove", reason: "Unauthorized moderator" },
    403,
  );
  await call(`/reports/${companyReport.id}/resolve`, other, "POST", {
    decision: "keep",
    reason: "The post follows the guidelines.",
  });
  await call(
    `/reports/${companyReport.id}/resolve`,
    other,
    "POST",
    { decision: "remove", reason: "Second decision prohibited." },
    409,
  );
  await call(`/posts/${sourced.id}/report`, p, "POST", {
    reason: "Incorrect details",
    details: "This sourcing request needs review.",
  });
  const report = (
    await call(`/communities/${privateCommunity.id}/reports`, h)
  ).items.find((r) => r.post_id === sourced.id);
  await call(
    `/reports/${report.id}/resolve`,
    teammate,
    "POST",
    { decision: "remove", reason: "Not a community moderator" },
    403,
  );
  await call(`/reports/${report.id}/resolve`, h, "POST", {
    decision: "remove",
    reason: "This request violates the posted community rules.",
  });
  await call("/posts/" + sourced.id, p, "GET", undefined, 404);
  assert.equal(
    (
      await call(
        `/communities/${privateCommunity.id}/reports?status=resolved`,
        h,
      )
    ).items.find((r) => r.id === report.id).status,
    "removed",
  );
  checks++;
  const publicPost = await post(member, {
    community_id: publicCommunity.id,
    title: "Public community discussion",
    kind: "post",
  });
  await call(`/posts/${publicPost.id}/state`, h, "POST", {
    action: "pin",
    value: true,
  });
  assert.equal(
    (await call("/communities/" + publicCommunity.id, other)).community
      .pinned_posts[0].id,
    publicPost.id,
  );
  checks++;
  await call(
    `/posts/${publicPost.id}/state`,
    member,
    "POST",
    { action: "pin", value: false },
    403,
  );
  assert.equal(
    (await call("/posts/" + publicPost.id, other)).post.can_comment,
    false,
  );
  checks++;
  await call(
    `/posts/${publicPost.id}/comments`,
    other,
    "POST",
    { client_id: randomUUID(), body: "Cannot comment before joining." },
    403,
  );
  const comm2 = await comm(h);
  await call(
    `/communities/${publicCommunity.id}/members/${p.user}`,
    h,
    "POST",
    { action: "role", role: "admin" },
  );
  await call(`/communities/${publicCommunity.id}/membership`, h, "POST", {
    action: "leave",
  });
  await call(
    `/communities/${publicCommunity.id}/membership`,
    p,
    "POST",
    { action: "leave" },
    409,
  );
  const pagination = [];
  for (let i = 0; i < 4; i++)
    pagination.push(await post(p, { body: prefix + " pagination " + i }));
  const first = await call("/posts?limit=2&q=" + prefix, p);
  const second = await call(
    "/posts?limit=2&q=" + prefix + "&cursor=" + first.next_cursor,
    p,
  );
  assert.equal(first.items.length, 2);
  assert.equal(second.items.length, 2);
  assert.equal(
    new Set([...first.items, ...second.items].map((p) => p.id)).size,
    4,
  );
  checks += 3;
  const manyDrafts = [];
  for (let i = 0; i < 21; i++) {
    const id = randomUUID();
    manyDrafts.push(id);
    await call("/drafts/" + id, h, "PUT", {
      version: 0,
      body: { body: `Older persisted draft ${i}`, file_ids: [] },
    });
  }
  const draftPage = await call("/drafts", h);
  assert.equal(draftPage.items.length, 20);
  assert.equal(
    draftPage.items.some((d) => d.id === manyDrafts[0]),
    false,
  );
  checks += 2;
  const oldDraft = (await call("/drafts/" + manyDrafts[0], h)).draft;
  assert.equal(oldDraft.id, manyDrafts[0]);
  assert.equal(oldDraft.body.body, "Older persisted draft 0");
  assert.deepEqual(oldDraft.files, []);
  checks += 3;
  assert.equal(
    (await call("/drafts?cursor=" + draftPage.next_cursor, h)).items[0].id,
    manyDrafts[0],
  );
  checks++;
  await call("/drafts/" + manyDrafts[0], p, "GET", undefined, 404);
  await call("/drafts/" + randomUUID(), h, "GET", undefined, 404);
  const demoPost = await post(demo);
  await call("/posts/" + demoPost.id, p, "GET", undefined, 404);
  assert.equal(
    (await call("/posts", demo)).items.some((p) => p.id === companyPost.id),
    false,
  );
  checks++;
  // Community hosts choose types; the client cannot turn built-in formats into choices.
  let typedCommunity = await comm(h);
  const customType = {
    id: randomUUID(),
    label: "Looking for surplus modules",
    kind: "sourcing",
  };
  await call(`/communities/${typedCommunity.id}/membership`, p, "POST", {
    action: "join",
  });
  await call(
    `/communities/${typedCommunity.id}`,
    p,
    "PATCH",
    { version: typedCommunity.version, post_types: [customType] },
    403,
  );
  for (const post_types of [
    [
      customType,
      { ...customType, id: randomUUID(), label: "LOOKING FOR SURPLUS MODULES" },
    ],
    [customType, { ...customType, label: "Another name" }],
    [{ ...customType, kind: "unrecognized" }],
    Array.from({ length: 21 }, (_, i) => ({
      id: randomUUID(),
      label: `Type ${i}`,
      kind: "post",
    })),
  ])
    await call(
      `/communities/${typedCommunity.id}`,
      h,
      "PATCH",
      { version: typedCommunity.version, post_types },
      400,
    );
  typedCommunity = (
    await call(`/communities/${typedCommunity.id}`, h, "PATCH", {
      version: typedCommunity.version,
      post_types: [customType],
    })
  ).community;
  assert.deepEqual(typedCommunity.post_types, [{ ...customType, version: 1 }]);
  checks++;
  const typedInput = {
    community_id: typedCommunity.id,
    title: "Modules for a rooftop installation",
    body: "Please share specifications and quantity.",
    post_type_id: customType.id,
    post_type_version: 1,
  };
  let typedPost = (
    await call("/posts", p, "POST", { client_id: randomUUID(), ...typedInput })
  ).post;
  assert.equal(typedPost.kind, "sourcing");
  assert.equal(typedPost.post_type_label, customType.label);
  assert.equal(typedPost.post_type_version, 1);
  assert.equal(
    (await call(`/posts?community_id=${typedCommunity.id}`, p)).items[0]
      .post_type_label,
    customType.label,
  );
  checks += 4;
  await call(
    "/posts",
    p,
    "POST",
    { client_id: randomUUID(), ...typedInput, kind: "available" },
    400,
  );
  await call(
    "/posts",
    p,
    "POST",
    {
      client_id: randomUUID(),
      ...typedInput,
      post_type_id: null,
      kind: "sourcing",
    },
    400,
  );
  await call(
    "/posts",
    p,
    "POST",
    { client_id: randomUUID(), ...typedInput, community_id: null },
    400,
  );
  await call(
    "/posts",
    p,
    "POST",
    {
      client_id: randomUUID(),
      ...typedInput,
      community_id: publicCommunity.id,
    },
    409,
  );
  await call(
    "/posts",
    p,
    "POST",
    { client_id: randomUUID(), ...typedInput, post_type_version: 0 },
    409,
  );
  const typedDraftID = randomUUID();
  const typedDraft = (
    await call(`/drafts/${typedDraftID}`, p, "PUT", {
      version: 0,
      body: typedInput,
    })
  ).draft;
  assert.equal(
    (await call(`/drafts/${typedDraftID}`, p)).draft.body.post_type_id,
    customType.id,
  );
  checks++;
  typedCommunity = (
    await call(`/communities/${typedCommunity.id}`, h, "PATCH", {
      version: typedCommunity.version,
      post_types: [{ ...customType, label: "Request solar modules" }],
    })
  ).community;
  assert.equal(typedCommunity.post_types[0].version, 2);
  assert.equal(
    (await call(`/posts/${typedPost.id}`, p)).post.post_type_label,
    customType.label,
  );
  checks += 2;
  await call(
    "/posts",
    p,
    "POST",
    {
      client_id: randomUUID(),
      ...typedDraft.body,
      draft_id: typedDraftID,
      draft_version: typedDraft.version,
    },
    409,
  );
  assert.equal(
    (await call(`/drafts/${typedDraftID}`, p)).draft.version,
    typedDraft.version,
  );
  checks++;
  const renamedPost = (
    await call("/posts", p, "POST", {
      client_id: randomUUID(),
      ...typedInput,
      post_type_version: 2,
    })
  ).post;
  assert.equal(renamedPost.post_type_label, "Request solar modules");
  checks++;
  typedCommunity = (
    await call(`/communities/${typedCommunity.id}`, h, "PATCH", {
      version: typedCommunity.version,
      post_types: [],
    })
  ).community;
  await call(
    "/posts",
    p,
    "POST",
    { client_id: randomUUID(), ...typedInput, post_type_version: 2 },
    409,
  );
  typedPost = (
    await call(`/posts/${typedPost.id}`, p, "PATCH", {
      version: typedPost.version,
      body: "Updated quantity while retaining the original type.",
    })
  ).post;
  assert.equal(typedPost.post_type_label, customType.label);
  assert.equal(typedPost.post_type_id, customType.id);
  assert.equal(typedPost.kind, "sourcing");
  checks += 3;
  await call(
    `/posts/${typedPost.id}`,
    p,
    "PATCH",
    { version: typedPost.version, post_type_id: null },
    400,
  );
  await call(
    `/posts/${typedPost.id}`,
    p,
    "PATCH",
    { version: typedPost.version, kind: "post" },
    400,
  );
  const ordinaryPost = await post(p, {
    community_id: typedCommunity.id,
    title: "An ordinary discussion",
  });
  assert.equal(ordinaryPost.kind, "post");
  assert.equal(ordinaryPost.post_type_id, null);
  assert.equal(ordinaryPost.post_type_label, "");
  checks += 3;
  // Historical built-in types remain editable after the host removes all choices.
  await db.query(
    "UPDATE network_posts SET kind='question',post_type_label='Question' WHERE id=$1",
    [ordinaryPost.id],
  );
  const historicalPost = (
    await call(`/posts/${ordinaryPost.id}`, p, "PATCH", {
      version: ordinaryPost.version,
      body: "A useful correction to this historical discussion.",
    })
  ).post;
  assert.equal(historicalPost.kind, "question");
  assert.equal(historicalPost.post_type_label, "Question");
  checks += 2;
  // Existing delegated community administrators can configure types, just like topics.
  await call(`/communities/${typedCommunity.id}/members/${p.user}`, h, "POST", {
    action: "role",
    role: "admin",
  });
  typedCommunity = (
    await call(`/communities/${typedCommunity.id}`, p, "PATCH", {
      version: typedCommunity.version,
      post_types: [
        { id: randomUUID(), label: "Technical help", kind: "question" },
      ],
    })
  ).community;
  assert.equal(typedCommunity.post_types[0].label, "Technical help");
  checks++;
  console.log(
    `Network API: ${checks} checks passed (real auth, membership, drafts, typed forms, post/comment lifecycle, reports, invites, notifications, sourcing).`,
  );
} finally {
  // Only rows owned by isolated fixture companies/users are removed.
  await db.query("BEGIN");
  try {
    await db.query(
      "DELETE FROM network_moderation_log WHERE actor_id=ANY($1::uuid[]) OR post_id IN (SELECT id FROM network_posts WHERE company_id=ANY($2::uuid[]))",
      [users, companies],
    );
    await db.query(
      "DELETE FROM network_reports WHERE reporter_id=ANY($1::uuid[]) OR post_id IN (SELECT id FROM network_posts WHERE company_id=ANY($2::uuid[]))",
      [users, companies],
    );
    await db.query(
      "DELETE FROM network_posts WHERE company_id=ANY($1::uuid[])",
      [companies],
    );
    await db.query(
      "DELETE FROM network_drafts WHERE company_id=ANY($1::uuid[])",
      [companies],
    );
    await db.query(
      "UPDATE network_communities SET cover_file_id=NULL WHERE owner_company_id=ANY($1::uuid[])",
      [companies],
    );
    await db.query(
      "DELETE FROM network_files WHERE company_id=ANY($1::uuid[])",
      [companies],
    );
    await db.query(
      "DELETE FROM network_communities WHERE owner_company_id=ANY($1::uuid[])",
      [companies],
    );
    await db.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])", [jobs]);
    await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [
      companies,
    ]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    console.error("Fixture cleanup failed:", e.message);
  }
  await db.end();
}
