import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = process.env.API_TEST_URL || "http://localhost:4101";
function client() {
  let cookie = "";
  return async (path, body, options = {}) => {
    const response = await fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      ...options,
      headers: {
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...options.headers,
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const type = response.headers.get("content-type");
    return {
      status: response.status,
      data: type?.includes("application/json")
        ? await response.json()
        : await response.text(),
      headers: response.headers,
    };
  };
}

import fs from "node:fs/promises";
import pg from "pg";

test("company social feed, media, follows and permissions", async (t) => {
  const a = client(),
    b = client(),
    anon = client(),
    member = client(),
    suffix = randomUUID().slice(0, 8),
    password = "SocialPassword123!";
  const A = (
    await a("/auth/register", {
      name: "Social Alice",
      email: "alice-social-" + suffix + "@example.test",
      password,
      companyName: "Solar A " + suffix,
    })
  ).data;
  const B = (
    await b("/auth/register", {
      name: "Social Bob",
      email: "bob-social-" + suffix + "@example.test",
      password,
      companyName: "Solar B " + suffix,
    })
  ).data;
  const M = (
    await member("/auth/register", {
      name: "Social Member",
      email: "member-social-" + suffix + "@example.test",
      password,
    })
  ).data;
  const photo = await fs.readFile("apps/web/public/assets/solar.jpg"),
    video = await fs.readFile("tests/fixtures/clip.webm");
  const form = (body = "", files = []) => {
    const f = new FormData();
    f.set("body", body);
    for (const [name, mime, bytes] of files)
      f.append("files", new Blob([bytes], { type: mime }), name);
    return f;
  };
  let P, V;
  await t.test("public reads and authenticated publishing", async () => {
    assert.equal((await anon("/feed")).status, 200);
    assert.equal((await anon("/posts", form("Unauthorized"))).status, 401);
    assert.equal((await anon("/feed?scope=following")).status, 401);
  });
  await t.test(
    "photo posts persist with real attribution and alt text",
    async () => {
      const f = form("A new commercial rooftop", [
        ["rooftop.jpg", "image/jpeg", photo],
      ]);
      f.set("alts", JSON.stringify(["Solar installation in sunlight"]));
      const r = await a("/posts", f);
      assert.equal(r.status, 201);
      P = r.data;
      assert.equal(P.company_id, A.activeCompanyId);
      assert.equal(P.author_name, "Social Alice");
      assert.equal(P.is_demo, false);
      assert.equal(P.media[0].alt, "Solar installation in sunlight");
      assert.equal((await anon("/posts/" + P.id)).data.body, P.body);
      assert.equal((await anon("/post-media/" + P.media[0].id)).status, 200);
    },
  );
  await t.test(
    "empty, disguised and mixed attachments are rejected",
    async () => {
      assert.equal((await a("/posts", form())).status, 400);
      assert.equal(
        (
          await a(
            "/posts",
            form("Bad", [
              ["evil.png", "image/png", "<script>alert(1)</script>"],
            ]),
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await a(
            "/posts",
            form("Mixed", [
              ["photo.jpg", "image/jpeg", photo],
              ["brief.pdf", "application/pdf", "%PDF-1.7\n%%EOF"],
            ]),
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await a(
            "/posts",
            form(
              "Too many",
              Array.from({ length: 5 }, (_, i) => [
                i + ".jpg",
                "image/jpeg",
                photo,
              ]),
            ),
          )
        ).status,
        400,
      );
    },
  );
  await t.test("real video upload supports byte-range playback", async () => {
    const r = await a(
      "/posts",
      form("A quick site update", [["clip.webm", "video/webm", video]]),
    );
    assert.equal(r.status, 201);
    V = r.data;
    assert.equal(V.media[0].mime, "video/webm");
    const media = await anon("/post-media/" + V.media[0].id, undefined, {
      headers: { Range: "bytes=0-99" },
    });
    assert.equal(media.status, 206);
    assert.match(media.headers.get("content-range"), /^bytes 0-99\//);
    assert.equal(media.headers.get("content-type"), "video/webm");
  });
  await t.test("PDF posts download and are not rendered as HTML", async () => {
    const r = await a(
      "/posts",
      form("Project brief", [
        [
          "brief.pdf",
          "application/pdf",
          "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF",
        ],
      ]),
    );
    assert.equal(r.status, 201);
    const file = await anon("/post-media/" + r.data.media[0].id);
    assert.match(file.headers.get("content-disposition"), /^attachment;/);
  });
  await t.test(
    "follow is unilateral and idempotent without opening messaging",
    async () => {
      for (let i = 0; i < 2; i++)
        assert.equal(
          (
            await b("/social/companies/" + A.activeCompanyId + "/follow", {
              following: true,
            })
          ).status,
          200,
        );
      assert.equal(
        (await b("/social/companies/" + A.activeCompanyId)).data.followers,
        1,
      );
      assert.equal((await b("/network")).data.connections.length, 0);
      assert.equal(
        (await b("/feed?scope=following")).data.posts.filter(
          (p) => p.company_id === A.activeCompanyId,
        ).length,
        3,
      );
      assert.equal(
        (
          await a("/social/companies/" + A.activeCompanyId + "/follow", {
            following: true,
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "company likes are idempotent and comments retain author attribution",
    async () => {
      for (let i = 0; i < 2; i++)
        assert.equal(
          (await b("/posts/" + P.id + "/like", { liked: true })).data
            .like_count,
          1,
        );
      assert.equal(
        (await b("/posts/" + P.id + "/like", { liked: false })).data.like_count,
        0,
      );
      assert.equal(
        (
          await b("/posts/" + P.id + "/comments", {
            body: "Great work from the installation team.",
          })
        ).status,
        201,
      );
      const comments = (await anon("/posts/" + P.id + "/comments")).data
        .comments;
      assert.equal(comments[0].author_name, "Social Bob");
      assert.equal(comments[0].company.id, B.activeCompanyId);
      assert.equal(
        (await b("/posts/" + P.id, undefined, { method: "DELETE" })).status,
        404,
      );
    },
  );
  await t.test(
    "ordinary teammates cannot publish or follow as the company",
    async () => {
      const invitation = (
        await a("/team/invites", { email: M.user.email, role: "member" })
      ).data;
      const token = invitation.url.split("/").at(-1);
      assert.equal(
        (await member("/join/" + token + "/accept", {})).status,
        200,
      );
      assert.equal(
        (await member("/posts", form("Not an administrator"))).status,
        403,
      );
      assert.equal(
        (
          await member("/social/companies/" + B.activeCompanyId + "/follow", {
            following: true,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await member("/posts/" + P.id + "/comments", {
            body: "Our team is proud of this project.",
          })
        ).status,
        201,
      );
      const theirs = (
        await member("/posts/" + P.id + "/comments")
      ).data.comments.find((c) => c.author_name === "Social Bob");
      assert.equal(
        (
          await member("/posts/" + P.id + "/comments/" + theirs.id, undefined, {
            method: "DELETE",
          })
        ).status,
        404,
      );
    },
  );
  await t.test(
    "emoji reactions toggle, disclose actors and preserve legacy celebrates",
    async () => {
      const url = "/posts/" + P.id + "/reactions";
      assert.equal(
        (await anon(url, { emoji: "☀️", reacted: true })).status,
        401,
      );
      for (const invalid of ["solar", "🎉🎉", "👍text", "", "1"]) {
        assert.equal(
          (await b(url, { emoji: invalid, reacted: true })).status,
          400,
        );
      }
      for (const symbol of ["☀️", "👩🏽‍🔧", "🇵🇰", "❤️", "🫠"]) {
        for (let repeat = 0; repeat < 2; repeat++)
          assert.equal(
            (await b(url, { emoji: symbol, reacted: true })).status,
            200,
          );
      }
      let post = (await a("/posts/" + P.id)).data;
      assert.equal(post.reaction_count, 5);
      assert.equal(post.reactions.length, 5);
      assert.ok(post.reactions.every((r) => r.count === 1 && !r.reacted));
      assert.ok(
        (await b("/posts/" + P.id)).data.reactions.every((r) => r.reacted),
      );
      await a(url, { emoji: "☀️", reacted: true });
      const who = (await b(url + "?emoji=" + encodeURIComponent("☀️"))).data;
      assert.equal(who.reactions.length, 2);
      assert.deepEqual(
        new Set(who.reactions.map((r) => r.company.id)),
        new Set([A.activeCompanyId, B.activeCompanyId]),
      );
      assert.ok(who.reactions.every((r) => r.user.name && !r.user.email));
      assert.equal(
        (await b(url, { emoji: "☀️", reacted: false })).data.reaction_count,
        5,
      );
      await b("/posts/" + P.id + "/like", { liked: true });
      post = (await b("/posts/" + P.id)).data;
      assert.equal(post.liked, true);
      assert.equal(post.reactions.find((r) => r.emoji === "🎉").reacted, true);
      assert.equal(
        (await b(url, { emoji: "🎉", reacted: false })).data.liked,
        false,
      );
      await b(url, { emoji: "🎉", reacted: true });
      assert.equal(
        (
          await b("/posts/" + P.id + "/like", { liked: false })
        ).data.reactions.some((r) => r.emoji === "🎉"),
        false,
      );
    },
  );
  await t.test(
    "who reacted pages are stable and company identities do not leak private account data",
    async () => {
      const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      try {
        const symbols = [
          "😀",
          "😃",
          "😄",
          "😁",
          "😆",
          "😅",
          "😂",
          "🤣",
          "🥲",
          "🥹",
          "😊",
          "😇",
          "🙂",
          "🙃",
          "😉",
          "😌",
          "😍",
          "🥰",
          "😘",
          "😗",
          "😙",
          "😚",
          "😋",
          "😛",
          "😝",
          "😜",
          "🤪",
          "🤨",
          "🧐",
          "🤓",
          "😎",
          "🥸",
        ];
        await db.query(
          "INSERT INTO post_reactions(post_id,company_id,author_id,emoji) SELECT $1,$2,$3,unnest($4::text[])",
          [V.id, A.activeCompanyId, A.user.id, symbols],
        );
      } finally {
        await db.end();
      }
      const first = (await anon("/posts/" + V.id + "/reactions")).data;
      const second = (
        await anon("/posts/" + V.id + "/reactions?after=" + first.nextCursor)
      ).data;
      assert.equal(first.reactions.length, 30);
      assert.equal(second.reactions.length, 2);
      assert.equal(
        new Set([...first.reactions, ...second.reactions].map((r) => r.id))
          .size,
        32,
      );
      assert.equal(second.nextCursor, null);
      assert.deepEqual(Object.keys(first.reactions[0].user).sort(), [
        "id",
        "name",
      ]);
      assert.equal(
        (await anon("/posts/" + V.id + "/reactions?after=oops")).status,
        400,
      );
    },
  );
  await t.test(
    "threaded replies preserve context, permissions, pagination and deleted parents",
    async () => {
      const url = "/posts/" + P.id + "/comments";
      const root = (
        await b(url, { body: "Can you share the project specifications?" })
      ).data.created_comment;
      assert.equal(root.parent_id, null);
      assert.equal(root.can_delete, true);
      const reply = (
        await a(url, {
          body: "The site uses rooftop modules.",
          parentId: root.id,
        })
      ).data.created_comment;
      assert.equal(reply.parent_id, root.id);
      assert.equal(reply.reply_to_id, root.id);
      const reply2 = (await b(url, { body: "Thank you!", parentId: reply.id }))
        .data.created_comment;
      assert.equal(reply2.parent_id, root.id);
      assert.equal(reply2.reply_to_id, reply.id);
      assert.equal(reply2.reply_to_name, "Social Alice");
      assert.equal(
        (
          await a("/posts/" + V.id + "/comments", {
            body: "Wrong post",
            parentId: root.id,
          })
        ).status,
        404,
      );
      assert.equal(
        (await a("/posts/" + V.id + "/comments/" + root.id + "/replies"))
          .status,
        404,
      );
      assert.equal((await a(url + "/" + reply.id + "/replies")).status, 404);
      assert.equal(
        (await member(url + "/" + root.id, undefined, { method: "DELETE" }))
          .status,
        404,
      );
      let roots = (await anon(url)).data.comments;
      assert.equal(roots.find((c) => c.id === root.id).reply_count, 2);
      assert.ok(roots.every((c) => !c.parent_id && !c.can_delete));
      const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      try {
        await db.query(
          "INSERT INTO post_comments(post_id,company_id,author_id,body,parent_id,reply_to_id) SELECT $1,$2,$3,'Reply fixture '||n,$4,$4 FROM generate_series(1,23) n",
          [P.id, A.activeCompanyId, A.user.id, root.id],
        );
      } finally {
        await db.end();
      }
      const first = (await a(url + "/" + root.id + "/replies")).data;
      const second = (
        await a(url + "/" + root.id + "/replies?after=" + first.nextCursor)
      ).data;
      assert.equal(first.comments.length, 20);
      assert.equal(second.comments.length, 5);
      assert.equal(second.nextCursor, null);
      assert.equal(
        new Set([...first.comments, ...second.comments].map((c) => c.id)).size,
        25,
      );
      assert.equal(first.comments[0].id, reply.id);
      const before = (await a("/posts/" + P.id)).data.comment_count;
      assert.equal(
        (await a(url + "/" + root.id, undefined, { method: "DELETE" })).status,
        200,
      );
      roots = (await a(url)).data.comments;
      const tombstone = roots.find((c) => c.id === root.id);
      assert.ok(tombstone.deleted_at);
      assert.equal(tombstone.body, "");
      assert.equal(tombstone.can_delete, false);
      assert.equal(tombstone.reply_count, 25);
      assert.equal((await a("/posts/" + P.id)).data.comment_count, before - 1);
      assert.equal(
        (await b(url, { body: "Too late", parentId: root.id })).status,
        404,
      );
      assert.equal(
        (await a(url + "/" + root.id + "/replies")).data.comments[0]
          .reply_to_name,
        null,
      );
      // Replies remain useful even after their original parent was removed.
      assert.equal(
        (await b(url, { body: "Following up", parentId: reply.id })).status,
        201,
      );
      assert.equal(
        (await a(url + "/" + reply.id, undefined, { method: "DELETE" })).status,
        200,
      );
      assert.ok(
        !(await a(url + "/" + root.id + "/replies")).data.comments.some(
          (c) => c.id === reply.id,
        ),
      );
    },
  );
  await t.test(
    "blocking removes follows and hides posts for the signed-in company",
    async () => {
      assert.equal(
        (await a("/relationships/" + B.activeCompanyId, { action: "block" }))
          .status,
        200,
      );
      assert.equal(
        (await b("/social/companies/" + A.activeCompanyId)).data.following,
        false,
      );
      assert.equal((await b("/posts/" + P.id)).status, 404);
      const visibleReactions = (await a("/posts/" + P.id + "/reactions")).data
        .reactions;
      assert.ok(
        visibleReactions.every((r) => r.company.id !== B.activeCompanyId),
      );
      assert.equal(
        (await a("/posts/" + P.id)).data.reaction_count,
        visibleReactions.length,
      );
      assert.equal((await b("/post-media/" + P.media[0].id)).status, 404);
      assert.equal(
        (
          await b("/social/companies/" + A.activeCompanyId + "/follow", {
            following: true,
          })
        ).status,
        403,
      );
      assert.equal((await b("/feed?scope=following")).data.posts.length, 0);
      assert.equal(
        (await a("/relationships/" + B.activeCompanyId, { action: "unblock" }))
          .status,
        200,
      );
      assert.equal(
        (await b("/social/companies/" + A.activeCompanyId)).data.following,
        false,
      );
    },
  );
  await t.test("feed cursor yields stable non-overlapping pages", async () => {
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await db.query(
        "INSERT INTO posts(company_id,author_id,body) SELECT $1,$2,'Pagination fixture '||n FROM generate_series(1,23) n",
        [B.activeCompanyId, B.user.id],
      );
    } finally {
      await db.end();
    }
    const first = (await anon("/feed?companyId=" + B.activeCompanyId)).data;
    assert.equal(first.posts.length, 20);
    assert.ok(first.nextCursor);
    const second = (
      await anon(
        "/feed?companyId=" + B.activeCompanyId + "&before=" + first.nextCursor,
      )
    ).data;
    assert.equal(second.posts.length, 3);
    assert.equal(second.nextCursor, null);
    assert.equal(
      new Set([...first.posts, ...second.posts].map((p) => p.id)).size,
      23,
    );
  });
  await t.test(
    "owner deletion removes media and post interactions",
    async () => {
      assert.equal(
        (await a("/posts/" + P.id, undefined, { method: "DELETE" })).status,
        200,
      );
      assert.equal((await anon("/posts/" + P.id)).status, 404);
      assert.equal((await anon("/post-media/" + P.media[0].id)).status, 404);
      assert.equal((await anon("/posts/" + P.id + "/comments")).status, 404);
    },
  );
});
