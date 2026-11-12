import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../apps/api/dist/db.js";
import { hashPassword } from "../apps/api/dist/auth.js";
const base = process.env.API_TEST_URL || "http://localhost:4101";
if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
)
  throw Error("Use an isolated test database.");
function client() {
  let cookie = "";
  return async (path, body, method = body === undefined ? "GET" : "POST") => {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers
      .getSetCookie()
      .find((v) => v.startsWith("connect_session="));
    if (set) cookie = set.split(";")[0];
    return { status: r.status, data: await r.json() };
  };
}
test("claiming leads to authorized, atomic company and work profile updates", async (t) => {
  const suffix = randomUUID().slice(0, 8),
    companyIds = [],
    userIds = [],
    password = "Profile checks 2026!";
  const hash = await hashPassword(password);
  const makeCompany = async (name) => {
    const slug = "workspace-" + randomUUID().slice(0, 8);
    const c = (
      await pool.query(
        `INSERT INTO companies(name,slug,username,listing_status,website) VALUES($1,$2,$2,'unclaimed',$3) RETURNING *`,
        [name + " " + suffix, slug, "https://" + suffix + ".example.test"],
      )
    ).rows[0];
    companyIds.push(c.id);
    await pool.query(
      `INSERT INTO company_claim_domains(company_id,domain,source_url) VALUES($1,$2,$3)`,
      [c.id, suffix + ".example.test", c.website],
    );
    return c;
  };
  const makeUser = async (email) => {
    const u = (
      await pool.query(
        `INSERT INTO users(name,email,password_hash,account_type,email_verified_at,onboarding_completed_at) VALUES('Workspace tester',$1,$2,'company',now(),now()) RETURNING id`,
        [email, hash],
      )
    ).rows[0];
    userIds.push(u.id);
    const call = client();
    assert.equal((await call("/auth/login", { email, password })).status, 200);
    return { id: u.id, call };
  };
  try {
    const c = await makeCompany("Workspace Solar"),
      taken = await makeCompany("Another Solar");
    const owner = await makeUser("owner@" + suffix + ".example.test"),
      outsider = await makeUser("outside@" + suffix + "-other.example.test"),
      member = await makeUser("member@" + suffix + ".example.test");
    await t.test(
      "verified work email can claim; unrelated email requires review",
      async () => {
        assert.equal(
          (await owner.call("/companies/" + c.id + "/claim")).data.emailMatches,
          true,
        );
        assert.equal(
          (
            await outsider.call("/companies/" + c.id + "/claim", {
              method: "work_email",
              role: "Owner",
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await outsider.call("/companies/" + c.id + "/claim", {
              method: "manual",
              role: "Office manager",
              evidence:
                "Please check the public company team page to confirm my role.",
            })
          ).data.status,
          "pending",
        );
        assert.equal(
          (await outsider.call("/companies/current/profile", {}, "PATCH"))
            .status,
          403,
        );
        const claimed = await owner.call("/companies/" + c.id + "/claim", {
          method: "work_email",
          role: "Company owner",
        });
        assert.equal(claimed.status, 201, JSON.stringify(claimed.data));
        assert.equal(claimed.data.status, "approved");
        assert.equal((await owner.call("/session")).data.activeCompanyId, c.id);
        assert.equal(
          (
            await pool.query(
              "SELECT listing_status FROM companies WHERE id=$1",
              [c.id],
            )
          ).rows[0].listing_status,
          "managed",
        );
      },
    );
    const form = {
      expectedCompanyId: c.id,
      name: c.name,
      username: c.username,
      tagline: "Electrical and solar specialists",
      description:
        "Detailed company overview explaining our residential and commercial installation and maintenance services.",
      type: "Contractor",
      location: "Austin, TX",
      services: ["Electrical services", "Solar installation"],
      service_areas: ["Central Texas"],
      audiences: ["Residential", "Commercial"],
      phone: "+1 512 555 0100",
      website: c.website,
      employee_count: "11–50",
      established: 2011,
      workDetails: {
        trades: ["Electrical", "Installation"],
        projectTypes: ["Residential solar", "Commercial solar"],
        availability: "Available in December",
        crewSize: "2 crews",
        capacity: "5 rooftops per month",
        licenseDetails: "Test license, Texas",
        insuranceDetails: "Test coverage",
      },
    };
    await t.test(
      "profile and work details save together with existing permissions",
      async () => {
        const response = await owner.call(
          "/companies/current/profile",
          form,
          "PATCH",
        );
        assert.equal(response.status, 200, JSON.stringify(response.data));
        const row = (
          await pool.query(
            "SELECT c.description,c.services,p.project_types,p.availability,p.license_details FROM companies c JOIN provider_profiles p ON p.company_id=c.id WHERE c.id=$1",
            [c.id],
          )
        ).rows[0];
        assert.equal(row.description, form.description);
        assert.deepEqual(row.services, form.services);
        assert.deepEqual(row.project_types, form.workDetails.projectTypes);
        assert.equal(row.availability, form.workDetails.availability);
        assert.equal(row.license_details, form.workDetails.licenseDetails);
        await pool.query(
          `INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'member')`,
          [member.id, c.id],
        );
        await member.call("/session/company", { companyId: c.id });
        assert.equal(
          (await member.call("/companies/current/profile", form, "PATCH"))
            .status,
          403,
        );
        assert.equal(
          (await client()("/companies/current/profile", form, "PATCH")).status,
          401,
        );
      },
    );
    await t.test(
      "company switch, invalid work details and conflicting usernames cannot partly overwrite a profile",
      async () => {
        const before = (
          await pool.query(
            "SELECT row_to_json(c) AS company,(SELECT row_to_json(p) FROM provider_profiles p WHERE p.company_id=c.id) AS work FROM companies c WHERE c.id=$1",
            [c.id],
          )
        ).rows[0];
        assert.equal(
          (
            await owner.call(
              "/companies/current/profile",
              { ...form, expectedCompanyId: taken.id },
              "PATCH",
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await owner.call(
              "/companies/current/profile",
              {
                ...form,
                name: "Unexpected rename",
                workDetails: {
                  ...form.workDetails,
                  projectTypes: Array(13).fill("Too many"),
                },
              },
              "PATCH",
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await owner.call(
              "/companies/current/profile",
              {
                ...form,
                username: taken.username,
                description: "Should never be saved",
              },
              "PATCH",
            )
          ).status,
          409,
        );
        const after = (
          await pool.query(
            "SELECT row_to_json(c) AS company,(SELECT row_to_json(p) FROM provider_profiles p WHERE p.company_id=c.id) AS work FROM companies c WHERE c.id=$1",
            [c.id],
          )
        ).rows[0];
        assert.deepEqual(after, before);
      },
    );

    await t.test(
      "structured licenses, certifications, and insurance keep ownership and dates intact",
      async () => {
        const license = {
          expectedCompanyId: c.id,
          licenseType: "Electrical contractor",
          licenseNumber: "EC-001234",
          authority: "Test licensing board",
          jurisdiction: "Texas",
          holder: c.name,
          classification: "Electrical",
          issuedOn: "2025-01-01",
          expiresOn: "2028-01-01",
          doesNotExpire: false,
          verificationUrl: "",
        };
        for (const invalid of [
          { ...license, expiresOn: "2024-12-31" },
          { ...license, doesNotExpire: true },
          { ...license, issuedOn: "2025-02-30" },
          { ...license, verificationUrl: "javascript:alert(1)" },
        ])
          assert.equal(
            (await owner.call("/companies/current/licenses", invalid)).status,
            400,
          );
        assert.equal(
          (
            await owner.call("/companies/current/licenses", {
              ...license,
              expectedCompanyId: taken.id,
            })
          ).status,
          409,
        );
        assert.equal(
          (await member.call("/companies/current/licenses", license)).status,
          403,
        );
        const created = await owner.call(
          "/companies/current/licenses",
          license,
        );
        assert.equal(created.status, 201, JSON.stringify(created.data));
        assert.equal(created.data.license_number, "EC-001234");
        assert.equal(created.data.expires_on, "2028-01-01");
        assert.equal(
          (
            await member.call(
              "/companies/current/licenses/" + created.data.id,
              undefined,
              "DELETE",
            )
          ).status,
          403,
        );
        const cert = {
          expectedCompanyId: c.id,
          category: "certification",
          title: "Test installer certification",
          organization: "Test issuer",
          scope: "personnel",
          scopeDetail: "Qualified team member",
          credentialNumber: "00023",
          issuedOn: "2025-01-01",
          validUntil: null,
          doesNotExpire: true,
          sourceUrl: "",
        };
        const certification = await owner.call(
          "/companies/current/credentials",
          cert,
        );
        assert.equal(
          certification.status,
          201,
          JSON.stringify(certification.data),
        );
        assert.equal(certification.data.evidence_basis, "company");
        assert.equal(certification.data.checked_at, null);
        const insurance = {
          expectedCompanyId: c.id,
          coverageType: "General liability",
          insurer: "Test insurer",
          coverageLimit: 1000000,
          currency: "USD",
          limitBasis: "per_occurrence",
          expiresOn: "2028-01-01",
          verificationUrl: "",
        };
        const insured = await owner.call(
          "/companies/current/insurance",
          insurance,
        );
        assert.equal(insured.status, 201, JSON.stringify(insured.data));
        assert.equal(
          (
            await owner.call("/companies/current/insurance", {
              ...insurance,
              coverageLimit: -1,
            })
          ).status,
          400,
        );
        const profile = (await client()("/companies/" + c.id)).data;
        assert.equal(profile.licenses[0].license_number, "EC-001234");
        assert.equal(profile.insurance[0].coverage_limit, 1000000);
        assert.equal(profile.credentials[0].credential_number, "00023");
        assert.equal(
          (
            await owner.call(
              "/companies/current/licenses/" + created.data.id,
              { ...license, licenseNumber: "EC-009876" },
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await owner.call(
              "/companies/current/licenses/" + created.data.id,
              undefined,
              "DELETE",
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "editing availability preserves imported company size and unrelated crew details",
      async () => {
        await pool.query(
          "UPDATE companies SET employee_count='25 employees' WHERE id=$1",
          [c.id],
        );
        const settings = {
          availability: "accepting",
          availableFrom: null,
          crewCount: null,
          peoplePerCrew: null,
          capacityQuantity: null,
          capacityUnit: "projects",
          capacityPeriod: "month",
        };
        const response = await owner.call(
          "/companies/current/profile",
          {
            ...form,
            employee_count: "25 employees",
            workDetails: { ...form.workDetails, settings },
          },
          "PATCH",
        );
        assert.equal(response.status, 200, JSON.stringify(response.data));
        const row = (
          await pool.query(
            "SELECT c.employee_count,p.availability,p.crew_size,p.capacity FROM companies c JOIN provider_profiles p ON p.company_id=c.id WHERE c.id=$1",
            [c.id],
          )
        ).rows[0];
        assert.equal(row.employee_count, "25 employees");
        assert.equal(row.availability, "Accepting new work");
        assert.equal(row.crew_size, form.workDetails.crewSize);
        assert.equal(row.capacity, form.workDetails.capacity);
        assert.equal(
          (
            await owner.call(
              "/companies/current/profile",
              { ...form, employee_count: "unbounded new category" },
              "PATCH",
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      "numeric work settings validate and generate consistent public labels without erasing research timestamps",
      async () => {
        const settings = {
          availability: "from_date",
          availableFrom: "2028-01-01",
          crewCount: 2,
          peoplePerCrew: 4,
          capacityQuantity: 5,
          capacityUnit: "projects",
          capacityPeriod: "month",
        };
        const before = (
          await pool.query(
            "SELECT updated_at FROM provider_profiles WHERE company_id=$1",
            [c.id],
          )
        ).rows[0].updated_at;
        assert.equal(
          (
            await owner.call(
              "/companies/current/profile",
              {
                ...form,
                workDetails: {
                  ...form.workDetails,
                  settings: { ...settings, crewCount: 1.5 },
                },
              },
              "PATCH",
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await owner.call(
              "/companies/current/profile",
              {
                ...form,
                workDetails: {
                  ...form.workDetails,
                  settings: { ...settings, availableFrom: null },
                },
              },
              "PATCH",
            )
          ).status,
          400,
        );
        const saved = await owner.call(
          "/companies/current/profile",
          { ...form, workDetails: { ...form.workDetails, settings } },
          "PATCH",
        );
        assert.equal(saved.status, 200, JSON.stringify(saved.data));
        const row = (
          await pool.query(
            "SELECT work_settings,availability,crew_size,capacity,updated_at FROM provider_profiles WHERE company_id=$1",
            [c.id],
          )
        ).rows[0];
        assert.deepEqual(row.work_settings, settings);
        assert.equal(row.crew_size, "2 crews · 4 people per crew");
        assert.equal(row.capacity, "Up to 5 projects per month");
        assert.equal(row.updated_at.toISOString(), before.toISOString());
        const cleared = await owner.call(
          "/companies/current/profile",
          {
            ...form,
            workDetails: {
              ...form.workDetails,
              settings: {
                ...settings,
                crewCount: null,
                peoplePerCrew: null,
                capacityQuantity: null,
              },
            },
          },
          "PATCH",
        );
        assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
        const afterClear = (
          await pool.query(
            "SELECT crew_size,capacity FROM provider_profiles WHERE company_id=$1",
            [c.id],
          )
        ).rows[0];
        assert.equal(afterClear.crew_size, "");
        assert.equal(afterClear.capacity, "");
      },
    );
    if (process.env.TEST_JOBS_SERVICE === "true")
      await t.test(
        "job posting validates quantities, budget and calendar dates then round trips structured choices",
        async () => {
          const body = {
            title: "Need an installation crew",
            description:
              "Install rooftop solar systems at three locations in Austin.",
            trade: "crew",
            location: "Austin, TX",
            postalCode: "00701",
            status: "draft",
            budgetCents: 1500000,
            peopleNeeded: 4,
            systemSizeKw: 12.5,
            siteCount: 3,
            materialsBy: "provider",
            workArrangement: "onsite",
            postingDetails: {
              startMode: "date",
              startDate: "2028-01-10",
              durationAmount: 2,
              durationUnit: "weeks",
            },
            startWindow: "2028-01-10",
            expectedDuration: "2 weeks",
            quoteDeadline: "2028-01-01T23:59:59.000Z",
          };
          for (const patch of [
            { budgetCents: "1500000" },
            { budgetCents: 1.25 },
            { peopleNeeded: 1.5 },
            { siteCount: 0 },
            {
              postingDetails: {
                ...body.postingDetails,
                startDate: "2028-02-30",
              },
            },
            { postingDetails: { ...body.postingDetails, durationAmount: 0 } },
            { quoteDeadline: "not-a-date" },
          ]) {
            const response = await owner.call("/jobs", { ...body, ...patch });
            assert.equal(response.status, 400, JSON.stringify(response));
          }
          const created = await owner.call("/jobs", body);
          assert.equal(created.status, 201, JSON.stringify(created.data));
          const read = await owner.call("/jobs/" + created.data.id);
          assert.deepEqual(read.data.job.posting_details, body.postingDetails);
          assert.equal(read.data.job.postal_code, "00701");
          const bad = await owner.call(
            "/jobs/" + created.data.id,
            {
              ...body,
              status: "open",
              quoteDeadline: "2020-01-01T00:00:00.000Z",
            },
            "PATCH",
          );
          assert.equal(bad.status, 400);
          assert.equal(
            (
              await owner.call(
                "/jobs/" + created.data.id,
                {
                  ...body,
                  postingDetails: { ...body.postingDetails, durationAmount: 3 },
                  expectedDuration: "3 weeks",
                },
                "PATCH",
              )
            ).status,
            200,
          );
        },
      );
  } finally {
    await pool.query(
      "DELETE FROM jobs WHERE hiring_company_id=ANY($1::uuid[])",
      [companyIds],
    );
    await pool.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [
      companyIds,
    ]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
    await pool.end();
  }
});
