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
