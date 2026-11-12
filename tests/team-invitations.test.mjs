import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const base = process.env.API_TEST_URL || "http://localhost:4220";
const database = new URL(process.env.DATABASE_URL);
assert.match(database.pathname, /_test$/);
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));

function client() {
  let cookie = "";
  return async (path, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const session = response.headers.get("set-cookie");
    if (session) cookie = session.split(";")[0];
    return { status: response.status, data: await response.json() };
  };
}

test("employee job titles survive invitations without changing access permissions", async (t) => {
  const db = new pg.Pool({ connectionString: database.href });
  const suffix = randomUUID().slice(0, 8);
  const users = [],
    companies = [];
  const owner = client(),
    admin = client(),
    member = client(),
    outsider = client(),
    legacy = client(),
    person = client(),
    unverified = client();
  async function register(
    api,
    name,
    { company = false, individual = false, verified = true } = {},
  ) {
    const result = await api("/auth/register", {
      name,
      email: `${name.toLowerCase()}-${suffix}@team-test.example.test`,
      password: "Connect team test 2026!",
      accountType: individual ? "individual" : "company",
      ...(company ? { companyName: `Team ${name} ${suffix}` } : {}),
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    users.push(result.data.user.id);
    if (result.data.activeCompanyId)
      companies.push(result.data.activeCompanyId);
    if (verified)
      await db.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
        result.data.user.id,
      ]);
    return result.data;
  }
  try {
    const O = await register(owner, "Owner", { company: true });
    const A = await register(admin, "Admin");
    const M = await register(member, "Member");
    const X = await register(outsider, "Outsider", { company: true });
    const L = await register(legacy, "Legacy");
    const I = await register(person, "Individual", { individual: true });
    const U = await register(unverified, "Unverified", { verified: false });
    let handle;

    await t.test(
      "optional titles are trimmed, bounded, and visible only to the invited person",
      async () => {
        const bad = await owner("/team/invites", {
          email: M.user.email,
          jobTitle: "x".repeat(121),
        });
        assert.equal(bad.status, 400);
        const invitation = await owner("/team/invites", {
          email: `  ${M.user.email.toUpperCase()}  `,
          role: "member",
          jobTitle: "  Lead Electrician  ",
        });
        assert.equal(invitation.status, 201, JSON.stringify(invitation.data));
        handle = new URL(invitation.data.url).pathname.split("/").at(-1);
        const pending = await owner("/team/invites");
        assert.equal(
          pending.data.find((item) => item.email === M.user.email).job_title,
          "Lead Electrician",
        );
        const welcome = await member("/join/" + handle);
        assert.equal(welcome.data.invitation.job_title, "Lead Electrician");
        assert.equal(welcome.data.invitation.role, "member");
        assert.equal((await outsider("/join/" + handle)).data.invitation, null);
        assert.equal((await client()("/join/" + handle)).data.invitation, null);
        assert.equal(
          (await outsider("/join/" + handle + "/accept", {})).status,
          404,
        );
        assert.equal(
          (await member("/join/" + handle + "/accept", {})).status,
          200,
        );
        const joined = (await owner("/team")).data.find(
          (item) => item.id === M.user.id,
        );
        assert.equal(joined.title, "Lead Electrician");
        assert.equal(joined.role, "member");
        assert.equal(
          (await member("/join/" + handle + "/accept", {})).status,
          404,
        );
      },
    );

    await t.test("job titles never grant administrative access", async () => {
      assert.equal(
        (
          await member("/team/invites", {
            email: A.user.email,
            jobTitle: "Administrator",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await owner("/team/invites", {
            email: A.user.email,
            role: "admin",
            jobTitle: "Operations Manager",
          })
        ).status,
        201,
      );
      assert.equal(
        (await admin("/join/" + handle + "/accept", {})).status,
        200,
      );
      assert.equal(
        (
          await admin("/team/invites", {
            email: L.user.email,
            role: "admin",
            jobTitle: "Director",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await admin("/team/invites", {
            email: L.user.email,
            role: "member",
            jobTitle: "Administrator",
          })
        ).status,
        201,
      );
      const pending = (await owner("/team/invites")).data.find(
        (item) => item.email === L.user.email,
      );
      assert.equal(pending.role, "member");
      assert.equal(pending.job_title, "Administrator");
      assert.equal(
        (await owner("/team/invites/" + pending.id, undefined, "DELETE"))
          .status,
        200,
      );
      assert.equal(
        (await legacy("/join/" + handle + "/accept", {})).status,
        404,
      );
      assert.equal(
        (
          await owner("/team/invites", {
            email: I.user.email,
            jobTitle: "Project Manager",
          })
        ).status,
        400,
      );
    });

    await t.test(
      "the intended verified company email is required for both invitation formats",
      async () => {
        assert.equal(
          (
            await owner("/team/invites", {
              email: U.user.email,
              jobTitle: "Estimator",
            })
          ).status,
          201,
        );
        assert.equal(
          (await unverified("/join/" + handle + "/accept", {})).status,
          403,
        );
        const token = randomBytes(32).toString("hex");
        await db.query(
          "INSERT INTO team_invites(token_hash,company_id,email,role,job_title,expires_at) VALUES($1,$2,$3,'member',$4,now()+interval '1 day')",
          [
            createHash("sha256").update(token).digest("hex"),
            O.activeCompanyId,
            U.user.email,
            "Field Supervisor",
          ],
        );
        assert.equal(
          (await unverified("/team/invites/" + token + "/accept", {})).status,
          403,
        );
        assert.equal(
          (await outsider("/team/invites/" + token + "/accept", {})).status,
          403,
        );
        await db.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
          U.user.id,
        ]);
        const preview = await unverified("/team/invites/preview/" + token);
        assert.equal(preview.data.job_title, "Field Supervisor");
        assert.equal(preview.data.emailMatches, true);
        assert.equal(
          (await unverified("/team/invites/" + token + "/accept", {})).status,
          200,
        );
        const joined = (await owner("/team")).data.find(
          (item) => item.id === U.user.id,
        );
        assert.equal(joined.title, "Field Supervisor");
        assert.equal(joined.role, "member");
      },
    );

    await t.test(
      "replacement invitations replace the title and preserve optional-title compatibility",
      async () => {
        await owner("/team/invites", {
          email: L.user.email,
          role: "member",
          jobTitle: "Installer",
        });
        await owner("/team/invites", {
          email: L.user.email,
          role: "member",
          jobTitle: "Crew Lead",
        });
        const active = (await owner("/team/invites")).data.filter(
          (item) => item.email === L.user.email,
        );
        assert.equal(active.length, 1);
        assert.equal(active[0].job_title, "Crew Lead");
        await owner("/team/invites", { email: L.user.email });
        assert.equal(
          (await legacy("/join/" + handle)).data.invitation.job_title,
          "",
        );
        assert.equal(
          (await legacy("/join/" + handle + "/accept", {})).status,
          200,
        );
        assert.equal(
          (await owner("/team")).data.find((item) => item.id === L.user.id)
            .title,
          "",
        );
      },
    );

    await t.test(
      "member title editing is bounded, company scoped, and independent of access",
      async () => {
        assert.equal(
          (
            await admin(
              "/team/" + M.user.id + "/profile",
              { title: "  Site Manager  " },
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal(
          (await owner("/team")).data.find((item) => item.id === M.user.id)
            .title,
          "Site Manager",
        );
        assert.equal(
          (
            await admin(
              "/team/" + X.user.id + "/profile",
              { title: "Wrong company" },
              "PATCH",
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await member(
              "/team/" + A.user.id + "/profile",
              { title: "Wrong person" },
              "PATCH",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await member(
              "/team/" + M.user.id + "/profile",
              { title: "Administrator", role: "owner" },
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal(
          (await owner("/team")).data.find((item) => item.id === M.user.id)
            .role,
          "member",
        );
        assert.equal(
          (
            await owner(
              "/team/" + M.user.id + "/profile",
              { title: "x".repeat(121) },
              "PATCH",
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await member(
              "/team/" + M.user.id + "/profile",
              { title: "" },
              "PATCH",
            )
          ).status,
          200,
        );
      },
    );
  } finally {
    await db.query("DELETE FROM email_outbox WHERE recipient LIKE $1", [
      `%-${suffix}@team-test.example.test`,
    ]);
    await db.query(
      "DELETE FROM team_invites WHERE company_id=ANY($1::uuid[])",
      [companies],
    );
    await db.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [
      companies,
    ]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    await db.end();
  }
});
