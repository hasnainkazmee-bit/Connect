import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pool } from "../apps/api/dist/db.js";
import { importProviderEnrichment } from "../apps/api/dist/provider-enrichment.js";
if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Use an isolated test database.");
const bind = "127.0.0.1:4212",
  base = "http://" + bind;
const server = spawn("./target/debug/connect-jobs", [], {
  env: { ...process.env, JOBS_BIND: bind },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
const ids = [],
  users = [];
let assertions = 0;
const check = (value, message) => {
  assert.ok(value, message);
  assertions++;
};
async function call(path, account, body, method = body ? "POST" : "GET") {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(account ? { cookie: account.cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  return { status: response.status, data };
}
async function member(company, role = "owner") {
  const user = randomUUID();
  users.push(user);
  await pool.query(
    "INSERT INTO users(id,email,name,password_hash,email_verified_at) VALUES($1,$2,'Test operator','test',now())",
    [user, `matching-${user}@example.test`],
  );
  await pool.query(
    "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,$3)",
    [user, company, role],
  );
  const token = randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO sessions(token_hash,user_id,company_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [createHash("sha256").update(token).digest("hex"), user, company],
  );
  return { user, company, cookie: `connect_session=${token}` };
}
const find = (r, id, section = "matches") =>
  r.data[section]?.find((c) => c.company.id === id);
try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(base + "/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  check(server.exitCode === null, "Rust test service is running");
  const hirer = randomUUID();
  ids.push(hirer);
  await pool.query(
    "INSERT INTO companies(id,slug,name) VALUES($1::uuid,$1::text,'Matching test hirer')",
    [hirer],
  );
  const owner = await member(hirer);
  const pilot = JSON.parse(
    await readFile(
      new URL(
        "../data/provider-enrichment/ohio-pilot-2026-11-12.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  pilot.batchId = "api-matching-" + randomUUID();
  pilot.records = pilot.records.filter((r) =>
    ["Yellowlite Inc", "APA Solar"].includes(r.companyName),
  );
  for (const r of pilot.records) {
    r.companyId = randomUUID();
    ids.push(r.companyId);
    const p = r.expectedProfile;
    await pool.query(
      `INSERT INTO companies(id,slug,name,website,listing_status,description,tagline,services,service_areas)
   VALUES($1::uuid,$1::text,$2,$3,'unclaimed',$4,$5,$6,$7)`,
      [
        r.companyId,
        r.companyName,
        r.website,
        p.description,
        p.tagline,
        p.services,
        p.serviceAreas,
      ],
    );
  }
  await importProviderEnrichment(pilot, true);
  const texas = JSON.parse(
    await readFile(
      new URL(
        "../data/provider-enrichment/texas-reviewed-2026-11-12.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  texas.batchId = "api-texas-" + randomUUID();
  texas.records = texas.records.filter(
    (r) => r.companyName === "Caltrik Solar",
  );
  const supplier = texas.records[0];
  supplier.companyId = randomUUID();
  ids.push(supplier.companyId);
  await pool.query(
    `INSERT INTO companies(id,slug,name,website,listing_status,description,tagline,services,service_areas,type)
    VALUES($1::uuid,$1::text,$2,$3,'unclaimed',$4,$5,$6,$7,$8)`,
    [
      supplier.companyId,
      supplier.companyName,
      supplier.website,
      supplier.expectedProfile.description,
      supplier.expectedProfile.tagline,
      supplier.expectedProfile.services,
      supplier.expectedProfile.serviceAreas,
      supplier.expectedProfile.type,
    ],
  );
  await importProviderEnrichment(texas, true);
  check(
    (
      await pool.query("SELECT type FROM companies WHERE id=$1", [
        supplier.companyId,
      ])
    ).rows[0].type === "Distributor",
    "reviewed source corrects installer classification",
  );
  const installationRequest = {
    kind: "service",
    categoryId: "solar-installation",
    countryCode: "US",
    stateCode: "TX",
  };
  check(
    !find(
      await call("/jobs/provider-matches", owner, installationRequest),
      supplier.companyId,
    ),
    "supplier is not an installer",
  );
  const shipmentRequest = {
    kind: "product",
    categoryId: "solar-modules",
    productRole: "distributes",
    countryCode: "US",
    stateCode: "CA",
  };
  check(
    find(
      await call("/jobs/provider-matches", owner, shipmentRequest),
      supplier.companyId,
    ),
    "reviewed contiguous-state delivery matches California",
  );
  check(
    !find(
      await call("/jobs/provider-matches", owner, {
        ...shipmentRequest,
        stateCode: "AK",
      }),
      supplier.companyId,
    ),
    "contiguous-state delivery does not cover Alaska",
  );
  check(
    (
      await call("/jobs/provider-matches", owner, {
        ...shipmentRequest,
        stateCode: "ZZ",
      })
    ).status === 400,
    "invalid state code is rejected",
  );
  const installer = pilot.records.find(
    (r) => r.companyName === "Yellowlite Inc",
  ).companyId;
  const manufacturer = pilot.records.find(
    (r) => r.companyName === "APA Solar",
  ).companyId;
  const provider = await member(installer),
    employee = await member(installer, "member");
  const request = {
    kind: "service",
    categoryId: "solar-installation",
    sector: "commercial",
    delivery: "turnkey",
    countryCode: "US",
    stateCode: "OH",
  };
  check(
    (await call("/jobs/provider-matches", null, request)).status === 401,
    "matching requires an authenticated company",
  );
  const taxonomy = await call("/jobs/provider-taxonomy");
  check(
    taxonomy.status === 200 && taxonomy.data.categories.length === 39,
    "stable taxonomy is available",
  );
  let response = await call("/jobs/provider-matches", owner, request);
  check(response.status === 200, JSON.stringify(response));
  check(
    find(response, installer),
    "supported service and territory are eligible",
  );
  check(
    !find(response, manufacturer),
    "a racking manufacturer cannot satisfy a turnkey installation request",
  );
  check(
    find(response, installer).offerings[0].availability === "unknown",
    "website evidence never creates availability",
  );
  response = await call("/jobs/provider-matches", owner, {
    ...request,
    stateCode: "TX",
  });
  check(
    !find(response, installer) &&
      find(response, installer, "needsConfirmation"),
    "unsupported territory is not an eligible match",
  );
  response = await call("/jobs/provider-matches", owner, {
    ...request,
    categoryId: "solar-maintenance",
    delivery: "specialist-service",
    stateCode: "IN",
  });
  check(
    !find(response, installer) &&
      find(response, installer, "needsConfirmation"),
    "installation coverage does not leak to maintenance",
  );
  response = await call("/jobs/provider-matches", owner, {
    kind: "service",
    categoryId: "racking-installation",
    countryCode: "US",
    stateCode: "CA",
  });
  check(
    !find(response, manufacturer) &&
      find(response, manufacturer, "needsConfirmation"),
    "shipping is not field-crew coverage",
  );
  response = await call("/jobs/provider-matches", owner, {
    kind: "product",
    categoryId: "racking-mounting",
    productRole: "manufactures",
    countryCode: "US",
    stateCode: "CA",
  });
  check(
    find(response, manufacturer),
    "explicit manufacturer national product coverage can match",
  );
  response = await call("/jobs/provider-matches", owner, {
    ...request,
    delivery: "labor-only",
  });
  check(
    !find(response, installer),
    "turnkey evidence is not labor-only acceptance",
  );
  response = await call("/jobs/provider-matches", owner, {
    ...request,
    requireAvailability: true,
  });
  check(
    !find(response, installer) &&
      find(response, installer, "needsConfirmation"),
    "required unknown availability blocks eligibility",
  );
  const availability = {
    categoryId: "solar-installation",
    status: "accepting",
    earliestStart: "2027-01-10",
    crewCount: 2,
    validForDays: 14,
  };
  check(
    (
      await call(
        "/jobs/providers/me/availability",
        employee,
        availability,
        "PUT",
      )
    ).status === 403,
    "ordinary employee cannot change company availability",
  );
  response = await call(
    "/jobs/providers/me/availability",
    provider,
    availability,
    "PUT",
  );
  check(response.status === 200, JSON.stringify(response));
  response = await call("/jobs/provider-matches", owner, {
    ...request,
    requireAvailability: true,
    startBy: "2027-01-15",
  });
  check(
    find(response, installer),
    "fresh owner-confirmed availability satisfies requested date",
  );
  response = await call("/jobs/provider-matches", owner, {
    ...request,
    startBy: "2027-01-05",
  });
  check(
    !find(response, installer),
    "a later start cannot meet an earlier deadline",
  );
  for (const invalid of [
    { ...availability, validForDays: 31 },
    { ...availability, earliestStart: "2026-02-30" },
    { ...availability, companyId: manufacturer },
  ]) {
    check(
      (await call("/jobs/providers/me/availability", provider, invalid, "PUT"))
        .status >= 400,
      "invalid or cross-company availability input rejected",
    );
  }
  await pool.query(
    "UPDATE provider_service_availability SET confirmed_at=now()-interval '16 days',valid_until=now()-interval '2 days' WHERE company_id=$1",
    [installer],
  );
  response = await call("/jobs/provider-matches", owner, {
    ...request,
    requireAvailability: true,
  });
  check(!find(response, installer), "expired availability is unknown");
  response = await call("/jobs/provider-matches", owner, {
    ...request,
    categoryId: "solar-design",
    delivery: "specialist-service",
    systemType: "ground-mount",
  });
  check(find(response, installer), "normalized system types match exact scope");
  response = await call("/jobs/provider-matches", owner, {
    ...request,
    categoryId: "solar-design",
    delivery: "specialist-service",
    systemType: "floating",
  });
  check(
    !find(response, installer),
    "a listed rooftop and ground-mount offering is not floating-solar evidence",
  );
  response = await call("/jobs/provider-matches", owner, {
    ...request,
    pageSize: 1,
  });
  check(
    response.data.matches.length <= 1 &&
      response.data.needsConfirmation.length <= 1 &&
      response.data.totalMatches >= 1,
    "results are paginated with totals",
  );
  const credential = "api-check-" + randomUUID();
  await pool.query(
    `INSERT INTO company_credentials(company_id,catalog_key,category,title,scope,scope_detail,source_url,evidence_basis,checked_at)
  VALUES($1,$2,'qualification','Personnel qualification','personnel','Qualified personnel','https://issuer.test/qualification','company',now())`,
    [installer, credential],
  );
  const required = {
    ...request,
    requiredCredentials: [{ catalogKey: credential, scope: "personnel" }],
  };
  response = await call("/jobs/provider-matches", owner, required);
  check(
    !find(response, installer),
    "company-published claim is not issuer verification",
  );
  await pool.query(
    "UPDATE company_credentials SET evidence_basis='issuer' WHERE company_id=$1 AND catalog_key=$2",
    [installer, credential],
  );
  response = await call("/jobs/provider-matches", owner, required);
  check(
    find(response, installer),
    "fresh issuer-backed matching credential scope accepted",
  );
  response = await call("/jobs/provider-matches", owner, {
    ...request,
    requiredCredentials: [{ catalogKey: credential, scope: "company" }],
  });
  check(
    !find(response, installer),
    "personnel qualification is not company accreditation",
  );
  await pool.query(
    "UPDATE company_credentials SET valid_until=current_date-1 WHERE company_id=$1 AND catalog_key=$2",
    [installer, credential],
  );
  response = await call("/jobs/provider-matches", owner, required);
  check(
    !find(response, installer),
    "expired credential cannot satisfy requirement",
  );
  response = await call("/jobs/provider-matches", provider, request);
  check(!find(response, installer), "company cannot be matched to itself");
  await pool.query(
    "UPDATE companies SET services=ARRAY['Company edited services'] WHERE id=$1",
    [installer],
  );
  response = await call("/jobs/provider-matches", owner, request);
  check(
    !find(response, installer) &&
      !find(response, installer, "needsConfirmation"),
    "old projection disappears when owner changes facts",
  );
  check(
    (
      await call("/jobs/provider-matches", owner, {
        ...request,
        categoryId: "random",
      })
    ).status === 400,
    "unknown category rejected",
  );
  check(
    (await call("/jobs/provider-matches", owner, { ...request, nearest: true }))
      .status >= 400,
    "unsupported distance preference is not silently fabricated",
  );
  check(
    response.data.invitationsSent === 0 && !response.data.distanceCalculated,
    "preview sends nothing and invents no distances",
  );
  console.log(JSON.stringify({ status: "passed", assertions }));
} catch (error) {
  console.error(log);
  throw error;
} finally {
  server.kill("SIGTERM");
  await pool.query(
    "DELETE FROM provider_service_availability WHERE company_id=ANY($1::uuid[])",
    [ids],
  );
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await pool.query("DELETE FROM companies WHERE id=ANY($1::uuid[])", [ids]);
  await pool.end();
}
