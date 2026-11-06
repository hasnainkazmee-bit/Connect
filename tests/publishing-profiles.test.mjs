import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import fs from "node:fs/promises";
const base = process.env.API_TEST_URL || "http://localhost:4101";
function client() {
  let cookie = "";
  return async (path, body, method = body === undefined ? "GET" : "POST") => {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return {
      status: r.status,
      data: r.headers.get("content-type")?.includes("json")
        ? await r.json()
        : await r.arrayBuffer(),
    };
  };
}
test("publishing, company profiles, customer accounts, and employee access", async (t) => {
  const a = client(),
    b = client(),
    person = client(),
    employee = client(),
    anon = client(),
    suffix = randomUUID().slice(0, 8),
    password = "ConnectIntegration123!";
  const register = async (c, name, type = "company", companyName) => {
    const r = await c("/auth/register", {
      name,
      email: name.toLowerCase() + suffix + "@example.test",
      password,
      accountType: type,
      companyName,
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data;
  };
  const A = await register(a, "Publisher", "company", "Publisher " + suffix),
    B = await register(b, "Other", "company", "Other " + suffix),
    I = await register(person, "Customer", "individual"),
    E = await register(employee, "Employee");
  let draft, media, thread, invite;
  const patch = async (data) => {
    const r = await a(
      "/publications/" + draft.id,
      {
        kind: "press_release",
        title: "A better rooftop story",
        subtitle: "Lessons from the field",
        body: "This is an announcement about our latest solar installation.",
        status: "draft",
        version: draft.version,
        ...data,
      },
      "PATCH",
    );
    if (r.status === 200) draft = r.data;
    return r;
  };
  await t.test(
    "usernames are case-insensitive, reserved, unique, and keep old links",
    async () => {
      for (const username of ["WWW", "join", "INVITE", "directory"])
        assert.equal(
          (await a("/companies/current/username", { username }, "PUT")).status,
          400,
        );
      assert.equal(
        (
          await a(
            "/companies/current/username",
            { username: "solar-" + suffix },
            "PUT",
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await b(
            "/companies/current/username",
            { username: "SOLAR-" + suffix },
            "PUT",
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await a(
            "/companies/current/username",
            { username: "new-" + suffix },
            "PUT",
          )
        ).status,
        200,
      );
      assert.equal(
        (await anon("/companies/SOLAR-" + suffix.toUpperCase())).data.company
          .id,
        A.activeCompanyId,
      );
      assert.equal(
        (
          await b(
            "/companies/current/username",
            { username: "solar-" + suffix },
            "PUT",
          )
        ).status,
        409,
      );
    },
  );
  await t.test("simultaneous username claims have one winner", async () => {
    const name = "unique-" + suffix;
    const attempts = await Promise.all([
      a("/companies/current/username", { username: name }, "PUT"),
      b("/companies/current/username", { username: name.toUpperCase() }, "PUT"),
    ]);
    assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 409]);
    await a(
      "/companies/current/username",
      { username: "new-" + suffix },
      "PUT",
    );
  });
  await t.test(
    "expired invitations reject access and previous secret links still work",
    async () => {
      assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith("_test"));
      const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      try {
        const member = client(),
          legacy = client();
        const M = await register(member, "Expired"),
          L = await register(legacy, "Legacy");
        const invite = await a("/team/invites", { email: M.user.email });
        const handle = invite.data.url.split("/").at(-1);
        await db.query(
          "UPDATE team_invites SET expires_at=now()-interval '1 second' WHERE company_id=$1 AND email=$2",
          [A.activeCompanyId, M.user.email],
        );
        assert.equal((await member("/join/" + handle)).data.invitation, null);
        assert.equal(
          (await member("/join/" + handle + "/accept", {})).status,
          404,
        );
        const token = randomBytes(32).toString("hex");
        await db.query(
          "INSERT INTO team_invites(token_hash,company_id,email,role,expires_at) VALUES($1,$2,$3,'member',now()+interval '1 day')",
          [
            createHash("sha256").update(token).digest("hex"),
            A.activeCompanyId,
            L.user.email,
          ],
        );
        assert.equal(
          (await anon("/team/invites/preview/" + token)).status,
          200,
        );
        const results = await Promise.all([
          legacy("/team/invites/" + token + "/accept", {}),
          legacy("/team/invites/" + token + "/accept", {}),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 404]);
        assert.ok(
          results.find((r) => r.status === 200).data.user
            .onboarding_completed_at,
        );
      } finally {
        await db.end();
      }
    },
  );
  await t.test(
    "drafts and attachments stay private; editing detects conflicting versions",
    async () => {
      const r = await a("/publications", { kind: "press_release" });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      draft = r.data;
      assert.equal((await patch({})).status, 200);
      assert.equal((await anon("/posts/" + draft.id)).status, 404);
      assert.equal((await b("/posts/" + draft.id)).status, 404);
      assert.equal(
        (await anon("/feed?companyId=" + A.activeCompanyId)).data.posts.length,
        0,
      );
      const f = new FormData();
      f.set(
        "file",
        new Blob([await fs.readFile("apps/web/public/assets/solar.jpg")], {
          type: "image/jpeg",
        }),
        "project.jpg",
      );
      const uploaded = await a("/publications/" + draft.id + "/media", f);
      assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
      media = uploaded.data;
      assert.equal((await anon("/post-media/" + media.id)).status, 404);
      assert.equal((await a("/post-media/" + media.id)).status, 200);
      assert.equal((await patch({ version: 1 })).status, 409);
      assert.equal(
        (
          await b(
            "/publications/" + draft.id,
            {
              kind: "post",
              body: "Intrusion",
              status: "published",
              version: draft.version,
            },
            "PATCH",
          )
        ).status,
        404,
      );
    },
  );
  await t.test(
    "rich documents validate links, media ownership, and publish with format filters",
    async () => {
      assert.equal(
        (
          await patch({
            document: { type: "doc", content: [{ type: "script", text: "x" }] },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await patch({
            document: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "bad",
                      marks: [
                        {
                          type: "link",
                          attrs: { href: "javascript:alert(1)" },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await patch({
            document: {
              type: "doc",
              content: [
                {
                  type: "image",
                  attrs: { src: "/api/post-media/" + randomUUID() },
                },
              ],
            },
          })
        ).status,
        400,
      );
      const document = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "What we learned" }],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "A thoughtful project starts with an excellent plan.",
                marks: [{ type: "bold" }],
              },
            ],
          },
          { type: "image", attrs: { src: media.url, alt: "Solar rooftop" } },
        ],
      };
      assert.equal(
        (await patch({ document, status: "published", coverMediaId: media.id }))
          .status,
        200,
      );
      const published = await anon("/posts/" + draft.id);
      assert.equal(published.data.kind, "press_release");
      assert.equal(
        published.data.document.content[1].content[0].marks[0].type,
        "bold",
      );
      assert.equal((await anon("/post-media/" + media.id)).status, 200);
      assert.equal(
        (
          await anon(
            "/feed?companyId=" + A.activeCompanyId + "&kind=press_release",
          )
        ).data.posts.length,
        1,
      );
      assert.equal(
        (await anon("/feed?companyId=" + A.activeCompanyId + "&kind=post")).data
          .posts.length,
        0,
      );
      assert.equal(
        (
          await a(
            "/publications/" + draft.id + "/media/" + media.id,
            undefined,
            "DELETE",
          )
        ).status,
        409,
      );
    },
  );
  await t.test(
    "retired formats remain readable and editable while new old-client writing becomes a press release",
    async () => {
      assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith("_test"));
      const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      try {
        for (const kind of ["article", "case_study"]) {
          const created = await a("/publications", { kind });
          assert.equal(created.status, 201);
          assert.equal(created.data.kind, "press_release");
          const published = await a(
            "/publications/" + created.data.id,
            {
              kind,
              title: "Legacy client company news",
              body: "Our solar team has completed another community installation.",
              status: "published",
              version: created.data.version,
            },
            "PATCH",
          );
          assert.equal(published.status, 200);
          assert.equal(published.data.kind, "press_release");
          // Recreate a historical record; no migration rewrites its format or URL.
          await db.query("UPDATE posts SET kind=$1 WHERE id=$2", [
            kind,
            created.data.id,
          ]);
          const edited = await a(
            "/publications/" + created.data.id,
            {
              kind,
              title: "Historical update, corrected",
              body: "Our company corrected the date of its community installation.",
              status: "published",
              version: published.data.version,
            },
            "PATCH",
          );
          assert.equal(edited.status, 200);
          assert.equal(edited.data.kind, kind);
          assert.equal(
            (await anon("/posts/" + created.data.id)).data.kind,
            kind,
          );
          assert.ok(
            (
              await anon("/feed?companyId=" + A.activeCompanyId + "&kind=post")
            ).data.posts.some((p) => p.id === created.data.id),
          );
          assert.ok(
            (
              await anon(
                "/feed?companyId=" + A.activeCompanyId + "&kind=" + kind,
              )
            ).data.posts.some((p) => p.id === created.data.id),
          );
        }
      } finally {
        await db.end();
      }
    },
  );
  await t.test(
    "posts separate captions from attachments and failed format changes remain private",
    async () => {
      const generic = (await a("/publications", { kind: "press_release" }))
        .data;
      const photo = new FormData();
      photo.set(
        "file",
        new Blob([await fs.readFile("apps/web/public/assets/solar.jpg")]),
        "project.jpg",
      );
      const attachment = await a(
        "/publications/" + generic.id + "/media",
        photo,
      );
      assert.equal(attachment.status, 201);
      const document = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "A new community solar project" },
              { type: "hardBreak" },
              {
                type: "text",
                text: "Our team completed the first installation today.",
              },
            ],
          },
          {
            type: "image",
            attrs: {
              src: attachment.data.url,
              alt: "Completed rooftop",
              title: "Our first completed rooftop.",
            },
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "More progress next week.",
                marks: [{ type: "bold" }],
              },
            ],
          },
        ],
      };
      const saved = await a(
        "/publications/" + generic.id,
        {
          kind: "press_release",
          title: "",
          subtitle: "",
          document,
          status: "draft",
          version: generic.version,
        },
        "PATCH",
      );
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      assert.match(saved.data.body, /project\nOur team/);
      assert.equal((await anon("/posts/" + generic.id)).status, 404);
      const foreignImage = await a(
        "/publications/" + generic.id,
        {
          kind: "post",
          document: {
            ...document,
            content: [
              ...document.content,
              {
                type: "blockquote",
                content: [
                  {
                    type: "image",
                    attrs: { src: "/api/post-media/" + randomUUID() },
                  },
                ],
              },
            ],
          },
          status: "draft",
          version: saved.data.version,
        },
        "PATCH",
      );
      assert.equal(
        foreignImage.status,
        400,
        "Post normalization must still validate image ownership",
      );
      assert.equal(
        (await a("/posts/" + generic.id)).data.version,
        saved.data.version,
      );
      const postDraft = await a(
        "/publications/" + generic.id,
        {
          kind: "post",
          document,
          status: "draft",
          version: saved.data.version,
        },
        "PATCH",
      );
      assert.equal(postDraft.status, 200, JSON.stringify(postDraft.data));
      assert.equal(postDraft.data.document.content.length, 3);
      assert.equal(
        (await a("/posts/" + generic.id)).data.media[0].id,
        attachment.data.id,
      );
      const update = await a(
        "/publications/" + generic.id,
        {
          kind: "post",
          title: "",
          subtitle: "",
          document,
          status: "published",
          version: postDraft.data.version,
        },
        "PATCH",
      );
      assert.equal(update.status, 200, JSON.stringify(update.data));
      const visible = (await anon("/posts/" + generic.id)).data;
      assert.equal(visible.kind, "post");
      assert.equal(visible.document.content.length, 3);
      assert.equal(visible.media[0].id, attachment.data.id);
      assert.match(visible.body, /project\nOur team/);
      assert.match(
        visible.body,
        /today\.\nOur first completed rooftop\.\nMore progress next week\./,
      );
      assert.deepEqual(visible.document.content[2].content[0].marks, [
        { type: "bold" },
      ]);
      assert.equal(
        (await anon("/post-media/" + attachment.data.id)).status,
        200,
      );

      const longDraft = (await a("/publications", { kind: "press_release" }))
        .data;
      const longDocument = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Our next chapter" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "x".repeat(4001) }],
          },
        ],
      };
      const longSaved = await a(
        "/publications/" + longDraft.id,
        {
          kind: "press_release",
          document: longDocument,
          status: "draft",
          version: longDraft.version,
        },
        "PATCH",
      );
      assert.equal(longSaved.status, 200);
      const invalidChoice = await a(
        "/publications/" + longDraft.id,
        {
          kind: "post",
          document: longDocument,
          status: "published",
          version: longSaved.data.version,
        },
        "PATCH",
      );
      assert.equal(invalidChoice.status, 400);
      assert.equal((await anon("/posts/" + longDraft.id)).status, 404);
      const preserved = (await a("/posts/" + longDraft.id)).data;
      assert.equal(preserved.status, "draft");
      assert.equal(preserved.version, longSaved.data.version);
      assert.deepEqual(preserved.document, longSaved.data.document);
      const release = await a(
        "/publications/" + longDraft.id,
        {
          kind: "press_release",
          title: "Our next chapter",
          document: longDocument,
          status: "published",
          version: preserved.version,
        },
        "PATCH",
      );
      assert.equal(release.status, 200, JSON.stringify(release.data));
    },
  );
  await t.test(
    "post media limits match the quick composer and release images preserve descriptions",
    async () => {
      const quick = (await a("/publications", {})).data;
      assert.equal(quick.kind, "post", "New publications default to a post");
      const upload = async (id, name = "solar.jpg", bytes) => {
        const form = new FormData();
        form.set(
          "file",
          new Blob([
            bytes || (await fs.readFile("apps/web/public/assets/solar.jpg")),
          ]),
          name,
        );
        return a("/publications/" + id + "/media", form);
      };
      for (let i = 0; i < 3; i++)
        assert.equal((await upload(quick.id)).status, 201);
      const finalSlots = await Promise.all([
        upload(quick.id),
        upload(quick.id),
      ]);
      assert.deepEqual(finalSlots.map((r) => r.status).sort(), [201, 400]);
      assert.equal((await upload(quick.id)).status, 400);
      assert.equal(
        (await upload(quick.id, "brief.pdf", Buffer.from("%PDF-1.4\n%%EOF")))
          .status,
        400,
      );
      const tooLong = await a(
        "/publications/" + quick.id,
        {
          kind: "post",
          body: "x".repeat(4001),
          status: "published",
          version: quick.version,
        },
        "PATCH",
      );
      assert.equal(tooLong.status, 400);
      assert.match(tooLong.data.error, /press release/i);
      assert.equal(
        (
          await a(
            "/publications/" + draft.id + "/media/" + media.id,
            { alt: "Engineers inspecting the finished rooftop array" },
            "PATCH",
          )
        ).status,
        200,
      );
      assert.equal(
        (await anon("/posts/" + draft.id)).data.media.find(
          (m) => m.id === media.id,
        ).alt,
        "Engineers inspecting the finished rooftop array",
      );
    },
  );
  await t.test(
    "individuals follow, but cannot publish, create companies, or become employees",
    async () => {
      assert.equal(I.user.account_type, "individual");
      assert.equal(I.activeCompanyId, null);
      assert.equal(
        (await person("/publications", { kind: "post" })).status,
        403,
      );
      assert.equal(
        (
          await person("/onboarding/company", {
            name: "Hidden company",
            type: "Installer",
            location: "Austin",
          })
        ).status,
        403,
      );
      assert.equal(
        (await person("/companies", { name: "Hidden company" })).status,
        403,
      );
      assert.equal(
        (
          await person("/social/companies/" + A.activeCompanyId + "/follow", {
            following: true,
          })
        ).status,
        200,
      );
      assert.equal(
        (await person("/feed?scope=following")).data.posts.some(
          (p) => p.id === draft.id,
        ),
        true,
      );
      assert.equal(
        (await person("/social/companies/" + A.activeCompanyId)).data.following,
        true,
      );
      assert.equal(
        (await a("/team/invites", { email: I.user.email, role: "admin" }))
          .status,
        400,
      );
      const pending = await a("/team/invites", {
        email: "future" + suffix + "@example.test",
        role: "member",
      });
      const future = client();
      await future("/auth/register", {
        name: "Future person",
        email: "future" + suffix + "@example.test",
        password,
        accountType: "individual",
      });
      assert.equal(
        (
          await future(
            "/join/" + pending.data.url.split("/").at(-1) + "/accept",
            {},
          )
        ).status,
        403,
      );
    },
  );
  await t.test(
    "one customer review updates the aggregate; own-company reviews are forbidden",
    async () => {
      const review = {
        rating: 5,
        title: "Thoughtful and reliable",
        body: "The team completed our rooftop installation on schedule.",
        experienceDate: "2026-01-12",
        customerExperience: true,
      };
      assert.equal(
        (
          await person(
            "/companies/" + A.activeCompanyId + "/reviews/mine",
            review,
            "PUT",
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await person(
            "/companies/" + A.activeCompanyId + "/reviews/mine",
            { ...review, rating: 4 },
            "PUT",
          )
        ).status,
        200,
      );
      const r = (await anon("/companies/" + A.activeCompanyId + "/reviews"))
        .data;
      assert.equal(r.rating.count, 1);
      assert.equal(r.rating.average, 4);
      assert.equal(r.rating.distribution.find((d) => d.rating === 4).count, 1);
      assert.equal(
        (
          await a(
            "/companies/" + A.activeCompanyId + "/reviews/mine",
            review,
            "PUT",
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await b("/reviews/" + r.reviews[0].id + "/reply", {
            body: "Impersonation",
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await a("/reviews/" + r.reviews[0].id + "/reply", {
            body: "Thank you for sharing your experience.",
          })
        ).status,
        200,
      );
    },
  );
  await t.test("portfolio and achievements use company ownership", async () => {
    const r = await a("/companies/current/portfolio", {
      name: "Community rooftop",
      description: "A detailed project",
      location: "Austin",
      size: "200 kW",
      completedYear: 2026,
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(
      (
        await b(
          "/companies/current/portfolio/" + r.data.id,
          undefined,
          "DELETE",
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await a("/companies/current/achievements", {
          title: "Installation excellence",
          issuer: "Industry association",
          year: 2026,
        })
      ).status,
      201,
    );
    const profile = (await anon("/companies/" + A.activeCompanyId)).data;
    assert.equal(profile.projects.length, 1);
    assert.equal(profile.achievements.length, 1);
    assert.equal(profile.rating.average, 4);
  });
  await t.test(
    "employee invitations can be replaced/revoked and permissions remain scoped",
    async () => {
      invite = (
        await a("/team/invites", { email: E.user.email, role: "member" })
      ).data;
      const handle = invite.url.split("/").at(-1);
      assert.equal(handle, "new-" + suffix);
      assert.ok(invite.url.endsWith("/join/" + handle));
      const publicPreview = (await anon("/join/" + handle)).data;
      assert.equal(publicPreview.company.name, A.companies[0].name);
      assert.equal(publicPreview.invitation, null);
      assert.equal(publicPreview.member, false);
      assert.ok(!JSON.stringify(publicPreview).includes(E.user.email));
      assert.equal((await b("/join/" + handle + "/accept", {})).status, 404);
      const old = (await a("/team/invites")).data.find(
        (i) => i.email === E.user.email,
      );
      assert.equal(
        (await b("/team/invites/" + old.id, undefined, "DELETE")).status,
        404,
      );
      assert.equal(
        (await a("/team/invites/" + old.id, undefined, "DELETE")).status,
        200,
      );
      assert.equal(
        (await employee("/join/" + handle + "/accept", {})).status,
        404,
      );
      const fresh = (
        await a("/team/invites", { email: E.user.email, role: "admin" })
      ).data;
      assert.equal(fresh.url, invite.url);
      await a("/team/invites", { email: E.user.email, role: "member" });
      assert.equal(
        (await employee("/join/" + handle)).data.invitation.role,
        "member",
      );
      const joined = await employee("/join/" + handle + "/accept", {});
      assert.equal(joined.status, 200, JSON.stringify(joined.data));
      assert.ok(joined.data.user.onboarding_completed_at);
      assert.equal(
        (await employee("/join/" + handle + "/accept", {})).status,
        404,
      );
      assert.equal((await employee("/join/" + handle)).data.member, true);
      assert.equal(
        (await employee("/publications", { kind: "post" })).status,
        403,
      );
      assert.equal(
        (
          await employee(
            "/team/" + A.user.id + "/role",
            { role: "member" },
            "PATCH",
          )
        ).status,
        403,
      );
      assert.equal(
        (await a("/team/" + E.user.id + "/role", { role: "admin" }, "PATCH"))
          .status,
        200,
      );
      assert.equal(
        (await employee("/publications", { kind: "post" })).status,
        201,
      );
      assert.equal(
        (await employee("/team/" + A.user.id, undefined, "DELETE")).status,
        403,
      );
    },
  );
  await t.test(
    "individual messaging waits for consent, isolates history, and never creates a company connection",
    async () => {
      const clientId = randomUUID();
      const r = await person("/personal-inbox", {
        companyId: A.activeCompanyId,
        body: "Can you help with a rooftop project?",
        clientId,
      });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      thread = r.data;
      assert.equal(
        (
          await person("/personal-inbox/" + thread.id + "/messages", {
            body: "Too early",
            clientId: randomUUID(),
          })
        ).status,
        403,
      );
      assert.equal((await b("/personal-inbox/" + thread.id)).status, 404);
      assert.equal(
        (
          await person("/personal-inbox/" + thread.id + "/respond", {
            accept: true,
          })
        ).status,
        403,
      );
      assert.equal((await a("/personal-inbox")).data.requests, 1);
      assert.equal(
        (
          await employee("/personal-inbox/" + thread.id + "/respond", {
            accept: true,
          })
        ).status,
        200,
      );
      const message = {
        body: "We would be happy to talk about your project.",
        clientId: randomUUID(),
      };
      assert.equal(
        (await employee("/personal-inbox/" + thread.id + "/messages", message))
          .status,
        201,
      );
      assert.equal(
        (await employee("/personal-inbox/" + thread.id + "/messages", message))
          .status,
        201,
      );
      assert.equal(
        (await person("/personal-inbox/" + thread.id)).data.messages.length,
        2,
      );
      assert.equal((await a("/network")).data.connections.length, 0);
      assert.equal(
        (await a("/team/" + E.user.id, undefined, "DELETE")).status,
        200,
      );
      assert.equal(
        (await employee("/personal-inbox/" + thread.id)).status,
        404,
      );
    },
  );
});
