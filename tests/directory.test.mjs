import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { spawnSync } from "node:child_process";
import { directoryCatalog } from "../apps/api/dist/directory-catalog.js";
const base = process.env.API_TEST_URL || "http://localhost:4101";
if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test"))
  throw new Error("Use an isolated test database.");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
function client() {
  let cookie = "";
  return async (path, body, method = body === undefined ? "GET" : "POST") => {
    const res = await fetch(base + "/api" + path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers
      .getSetCookie()
      .find((v) => v.startsWith("connect_session="));
    if (set) cookie = set.split(";")[0];
    return { status: res.status, data: await res.json() };
  };
}
test("public directory, ownership claims and shared company identity", async (t) => {
  const suffix = randomUUID().slice(0, 8),
    companyIds = [],
    userIds = [];
  const fixture = async (name, areas, location = "Austin, TX") => {
    const username = "listing-" + randomUUID().slice(0, 12);
    const c = (
      await db.query(
        "INSERT INTO companies(name,slug,username,location,services,service_areas,audiences,listing_status,website,description) VALUES($1,$2,$2,$3,'{Installation}',$4,'{Residential,Commercial}','unclaimed','https://official.example.test','A public solar company profile with accurate service areas.') RETURNING *",
        [name, username, location, areas],
      )
    ).rows[0];
    companyIds.push(c.id);
    await db.query(
      "INSERT INTO company_claim_domains(company_id,domain,source_url) VALUES($1,$2,'https://official.example.test')",
      [c.id, suffix + ".example.test"],
    );
    return c;
  };
  const register = async (email, type = "company", companyName) => {
    const call = client(),
      r = await call("/auth/register", {
        name: "Directory Tester",
        email,
        password: "DirectoryChecks123!",
        accountType: type,
        companyName,
      });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    userIds.push(r.data.user.id);
    if (r.data.activeCompanyId) companyIds.push(r.data.activeCompanyId);
    return { call, user: r.data.user };
  };
  const anon = client(),
    c = await fixture("Sólár Directory " + suffix, ["Austin, TX"]),
    elsewhere = await fixture("Elsewhere " + suffix, ["Colorado"]);
  try {
    await t.test(
      "search follows service coverage, supports state aliases and unaccented company names",
      async () => {
        for (const area of ["Austin", "Austin, TX", "austin-tx", "TX"]) {
          const r = await anon(
            "/companies?type=Installer&area=" + encodeURIComponent(area),
          );
          assert.equal(r.status, 200, JSON.stringify(r.data));
          assert.ok(
            r.data.companies.some((v) => v.id === c.id),
            area,
          );
          assert.ok(!r.data.companies.some((v) => v.id === elsewhere.id), area);
        }
        assert.equal(
          (
            await anon(
              "/companies?q=" + encodeURIComponent("solar directory " + suffix),
            )
          ).data.companies[0].id,
          c.id,
        );
        assert.equal(
          (await anon("/companies?q=" + suffix + "&area=Atlantis")).data.total,
          0,
        );
        assert.equal(
          (await anon("/companies?q=" + suffix + "&audience=Utility-scale"))
            .data.total,
          0,
        );
        assert.equal(
          (
            await anon(
              "/directory/matches?q=" +
                encodeURIComponent("Solar Directory " + suffix),
            )
          ).data.companies[0].id,
          c.id,
        );
        assert.equal(
          (await anon("/companies/" + c.username)).data.company.listing_status,
          "unclaimed",
        );
      },
    );
    const wrong = await register("outsider-" + suffix + "@example.test"),
      owner = await register("owner@" + suffix + ".example.test"),
      peer = await register("peer@" + suffix + ".example.test"),
      individual = await register(
        "person@" + suffix + ".example.test",
        "individual",
      ),
      sender = await register(
        "sender-" + suffix + "@example.test",
        "company",
        "Sender " + suffix,
      );
    await t.test(
      "login alone, wrong domains and individual accounts cannot claim a listing",
      async () => {
        const body = { method: "work_email", role: "Owner" };
        assert.equal(
          (await anon("/companies/" + c.id + "/claim", body)).status,
          401,
        );
        assert.equal(
          (await owner.call("/companies/" + c.id + "/claim", body)).status,
          403,
        );
        await db.query(
          "UPDATE users SET email_verified_at=now() WHERE id=ANY($1::uuid[])",
          [userIds],
        );
        assert.equal(
          (await wrong.call("/companies/" + c.id + "/claim", body)).status,
          403,
        );
        assert.equal(
          (await individual.call("/companies/" + c.id + "/claim", body)).status,
          403,
        );
        assert.equal(
          (
            await owner.call(
              "/companies/current/profile",
              { name: "Takeover" },
              "PATCH",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await db.query("SELECT 1 FROM memberships WHERE company_id=$1", [
              c.id,
            ])
          ).rowCount,
          0,
        );
      },
    );
    await t.test(
      "unclaimed companies cannot receive unattended company or individual message requests",
      async () => {
        assert.equal(
          (
            await sender.call("/requests", {
              companyId: c.id,
              kind: "message",
              note: "Hello",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await individual.call("/personal-inbox", {
              companyId: c.id,
              body: "Hello there",
              clientId: randomUUID(),
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "signup and company creation detect an existing listing instead of duplicating it",
      async () => {
        const matchName = "SOLAR DIRECTORY " + suffix;
        assert.equal(
          (await wrong.call("/companies", { name: matchName })).status,
          409,
        );
        assert.equal(
          (
            await wrong.call("/onboarding/company", {
              name: matchName,
              type: "Installer",
              location: "Austin",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await anon("/auth/register", {
              name: "Duplicate",
              email: "duplicate-" + suffix + "@example.test",
              password: "DirectoryChecks123!",
              companyName: matchName,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await db.query("SELECT 1 FROM users WHERE email=$1", [
              "duplicate-" + suffix + "@example.test",
            ])
          ).rowCount,
          0,
        );
      },
    );
    await t.test(
      "manual requests are private, idempotent and do not grant access",
      async () => {
        const body = {
          method: "manual",
          role: "Operations manager",
          evidence:
            "Please confirm my role through our official business contact listed on the company website.",
        };
        const a = await wrong.call("/companies/" + c.id + "/claim", body),
          b = await wrong.call("/companies/" + c.id + "/claim", body);
        assert.equal(a.status, 201);
        assert.equal(a.data.status, "pending");
        assert.equal(a.data.id, b.data.id);
        assert.equal(
          (await anon("/companies/" + c.id + "/claim")).data.claim,
          null,
        );
        assert.equal(
          (await owner.call("/companies/" + c.id + "/claim")).data.claim,
          null,
        );
        assert.equal((await wrong.call("/session")).data.companies.length, 0);
      },
    );
    await t.test(
      "concurrent verified claims produce one owner while retaining the profile, reviews and followers",
      async () => {
        await db.query(
          "INSERT INTO individual_follows(user_id,company_id) VALUES($1,$2)",
          [individual.user.id, c.id],
        );
        await db.query(
          "INSERT INTO company_reviews(company_id,user_id,rating,title,body,experience_date) VALUES($1,$2,4,'A helpful team','Our project experience with this company was very positive.',current_date)",
          [c.id, individual.user.id],
        );
        const body = { method: "work_email", role: "Owner" };
        const results = await Promise.all([
          owner.call("/companies/" + c.id + "/claim", body),
          peer.call("/companies/" + c.id + "/claim", body),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
        const manager = results[0].status === 201 ? owner : peer;
        const profile = (await anon("/companies/" + c.username)).data;
        assert.equal(profile.company.id, c.id);
        assert.equal(profile.company.username, c.username);
        assert.equal(profile.company.listing_status, "managed");
        assert.ok(profile.company.ownership_verified_at);
        assert.equal(profile.rating.count, 1);
        assert.equal(
          (
            await db.query("SELECT * FROM memberships WHERE company_id=$1", [
              c.id,
            ])
          ).rowCount,
          1,
        );
        assert.equal(
          (
            await db.query(
              "SELECT * FROM individual_follows WHERE company_id=$1",
              [c.id],
            )
          ).rowCount,
          1,
        );
        assert.equal(
          (await wrong.call("/companies/" + c.id + "/claim")).data.claim.status,
          "superseded",
        );
        const session = (await manager.call("/session")).data;
        assert.equal(session.activeCompanyId, c.id);
        assert.ok(session.user.onboarding_completed_at);
        const update = await manager.call(
          "/companies/current/profile",
          {
            ...profile.company,
            employee_count: "1–10",
            established: null,
            tagline: "Updated by the real company team",
            audiences: ["Commercial"],
            phone: "+1 512 555 0100",
          },
          "PATCH",
        );
        assert.equal(update.status, 200, JSON.stringify(update.data));
        const listing = (
          await anon("/companies?q=" + suffix + "&audience=Commercial")
        ).data.companies.find((v) => v.id === c.id);
        assert.equal(listing.tagline, "Updated by the real company team");
        assert.equal(listing.rating_average, 4);
        assert.equal(
          (
            await sender.call("/requests", {
              companyId: c.id,
              kind: "message",
              note: "Hello from our company",
            })
          ).status,
          201,
        );
      },
    );
    await t.test(
      "manual claims grant access only after an operator decision",
      async () => {
        const manualCompany = await fixture("Manual Review " + suffix, [
          "Maine",
        ]);
        const body = {
          method: "manual",
          role: "Owner",
          evidence:
            "Confirm my authority through the official company contact listed on our website.",
        };
        const rejected = await peer.call(
          "/companies/" + elsewhere.id + "/claim",
          body,
        );
        const cli = (action, id, note) =>
          spawnSync(
            process.execPath,
            [
              "apps/api/dist/review-claims.js",
              action,
              id,
              "test_operator",
              note,
            ],
            { env: process.env, encoding: "utf8" },
          );
        let result = cli(
          "reject",
          rejected.data.id,
          "Unable to verify this role with the official company contact.",
        );
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
          (await peer.call("/companies/" + elsewhere.id + "/claim")).data.claim
            .status,
          "rejected",
        );
        assert.equal(
          (
            await db.query("SELECT 1 FROM memberships WHERE company_id=$1", [
              elsewhere.id,
            ])
          ).rowCount,
          0,
        );
        const pending = await wrong.call(
          "/companies/" + manualCompany.id + "/claim",
          body,
        );
        assert.equal(pending.data.status, "pending");
        result = cli(
          "approve",
          pending.data.id,
          "Confirmed authority through an independently sourced business contact.",
        );
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
          (await wrong.call("/companies/" + manualCompany.id + "/claim")).data
            .claim.status,
          "approved",
        );
        assert.ok(
          (await wrong.call("/session")).data.companies.some(
            (c) => c.id === manualCompany.id,
          ),
        );
      },
    );
    await t.test(
      "public HTML contains escaped company information, canonical URLs and accurate metadata without JavaScript",
      async () => {
        await db.query("UPDATE companies SET description=$1 WHERE id=$2", [
          'Solar panels <script>alert("x")</script> safely described.',
          c.id,
        ]);
        const res = await fetch(base + "/" + c.username);
        assert.equal(res.status, 200);
        const html = await res.text();
        assert.match(html, /application\/ld\+json/);
        assert.ok(html.includes('rel="canonical"'));
        assert.ok(html.includes(c.name));
        assert.ok(html.includes("&lt;script&gt;"));
        assert.ok(!html.includes('<script>alert("x")</script>'));
        assert.match(html, /Customer reviews/);
        const publication = (
          await db.query(
            "INSERT INTO posts(company_id,author_id,kind,title,body,status,published_at) VALUES($1,$2,'article','A company story','A public article <script> is displayed as text.','published',now()) RETURNING id",
            [c.id, owner.user.id],
          )
        ).rows[0];
        const story = await fetch(base + "/posts/" + publication.id);
        assert.equal(story.status, 200);
        const storyHtml = await story.text();
        assert.match(storyHtml, /A company story/);
        assert.match(storyHtml, /&lt;script&gt;/);
        assert.ok(!storyHtml.includes("noindex"));
        await db.query("UPDATE posts SET status='draft' WHERE id=$1", [
          publication.id,
        ]);
        const draft = await fetch(base + "/posts/" + publication.id);
        assert.equal(draft.status, 404);
        assert.ok(!(await draft.text()).includes("A company story"));
        assert.equal(
          (await fetch(base + "/company/" + c.id, { redirect: "manual" }))
            .status,
          301,
        );
        assert.equal((await fetch(base + "/no-company-" + suffix)).status, 404);
        assert.equal(
          (await fetch(base + "/directory/installers/not-a-place")).status,
          404,
        );
        assert.equal(
          (await fetch(base + "/assets/not-a-real-file.js")).status,
          404,
        );
        assert.match(
          await (await fetch(base + "/robots.txt")).text(),
          /Sitemap:/,
        );
        assert.ok(
          (await (await fetch(base + "/sitemap.xml")).text()).includes(
            c.username,
          ),
        );
      },
    );
    await t.test(
      "curated import creates 12 unclaimed profiles with real assets and is safe to repeat",
      async () => {
        const run = () =>
          spawnSync(process.execPath, ["apps/api/dist/import-directory.js"], {
            env: process.env,
            encoding: "utf8",
          });
        let r = run();
        assert.equal(r.status, 0, r.stderr);
        r = run();
        assert.equal(r.status, 0, r.stderr);
        for (const item of directoryCatalog) {
          const c = (await anon("/companies/" + item.username)).data.company;
          assert.equal(c.listing_status, "unclaimed");
          assert.equal(c.source_url, item.source);
          assert.equal(c.cover_url, "");
          assert.equal(
            (
              await db.query("SELECT 1 FROM memberships WHERE company_id=$1", [
                c.id,
              ])
            ).rowCount,
            0,
          );
          const logo = await fetch(base + c.logo_url);
          assert.equal(logo.status, 200, item.name);
          assert.ok(logo.headers.get("content-type").startsWith("image/"));
        }
        const before = (
          await db.query(
            "SELECT count(*) FROM companies WHERE source_checked_at IS NOT NULL",
          )
        ).rows[0].count;
        assert.equal(Number(before), 12);
      },
    );
  } finally {
    await db.query(
      "DELETE FROM notifications WHERE company_id=ANY($1::uuid[]) OR related_company_id=ANY($1::uuid[])",
      [companyIds],
    );
    await db.query(
      "DELETE FROM connection_requests WHERE from_id=ANY($1::uuid[]) OR to_id=ANY($1::uuid[])",
      [companyIds],
    );
    await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [
      companyIds,
    ]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
    await db.end();
  }
});
