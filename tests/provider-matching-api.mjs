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
  const directoryQuery = "directory-order-" + randomUUID();
  const pinned = [],
    enriched = [],
    ordinary = [];
  for (let i = 0; i < 30; i++) {
    const id = randomUUID();
    ids.push(id);
    const isPinned = i < 2,
      isEnriched = i >= 2 && i < 27,
      isDemo = i === 29;
    await pool.query(
      `INSERT INTO companies(id,slug,name,type,location,logo_url,description,is_demo)
       VALUES($1::uuid,$1::text,$2,$3,'Directory test location',$4,$5,$6)`,
      [
        id,
        directoryQuery +
          (isPinned
            ? " Z pinned " + i
            : isEnriched
              ? " Z enriched"
              : " A complete"),
        isEnriched ? "Installer" : "Manufacturer",
        isEnriched ? "" : "/logo.png",
        isEnriched
          ? ""
          : i === 28
            ? "Its published company location is here. Listed services include solar installation. ".repeat(
                8,
              )
            : "We design and install residential and commercial energy systems, including rooftop solar, battery backup and charging infrastructure. Our team also maintains existing systems and coordinates permits for new installations.",
        isDemo,
      ],
    );
    if (isPinned) {
      pinned.push(id);
      await pool.query(
        "INSERT INTO provider_directory_pins(company_id,position) VALUES($1,$2)",
        [id, 9001 + i],
      );
    } else if (isEnriched) {
      enriched.push(id);
      await pool.query(
        `INSERT INTO provider_capabilities(company_id,batch_id,research,checked_at)
         VALUES($1,'directory-order-test','{"reviewMethod":"source-check-v1"}',now())`,
        [id],
      );
    } else if (!isDemo) {
      ordinary.push(id);
      if (i === 27) {
        await pool.query(
          "UPDATE companies SET services=ARRAY['Solar installation','Battery storage'],service_areas=ARRAY['Ohio'] WHERE id=$1",
          [id],
        );
        await pool.query(
          "INSERT INTO provider_profiles(company_id,project_types) VALUES($1,ARRAY['Residential solar','Commercial solar'])",
          [id],
        );
      }
    }
  }
  const directory = await call("/jobs/providers?q=" + directoryQuery);
  const directoryPage2 = await call(
    "/jobs/providers?q=" + directoryQuery + "&page=2",
  );
  check(
    directory.status === 200 && directory.data.total === 29,
    "Directory count excludes demo profiles",
  );
  const ordered = [
    ...directory.data.providers,
    ...directoryPage2.data.providers,
  ].map((p) => p.id);
  check(
    ordered.slice(0, 2).join() === pinned.join(),
    "Explicit pins are first and second before alphabetical/completeness ranking",
  );
  check(
    ordered.slice(2, 4).join() === ordinary.join() &&
      ordered.slice(4).join() === enriched.sort().join(),
    "Actual completeness outranks the source-check flag, with stable pagination ties",
  );
  check(
    ordered.length === 29 && new Set(ordered).size === 29,
    "Pagination neither duplicates nor drops companies",
  );
  const filtered = await call(
    "/jobs/providers?q=" + directoryQuery + "&kind=Installer",
  );
  check(
    filtered.data.total === 25 &&
      filtered.data.providers.every((p) => enriched.includes(p.id)),
    "Pinned companies never bypass selected filters",
  );
  const improved = enriched[0];
  await pool.query(
    `UPDATE companies SET
    description='Electrical installation and maintenance for commercial facilities and new construction. Services include distribution equipment upgrades, panel replacement, new wiring, backup power and lighting retrofits.',
    services=ARRAY['Electrical installation'],service_areas=ARRAY['Ohio'],website='https://example.test',
    logo_url='/company-logo.png',cover_url='/company-cover.jpg' WHERE id=$1`,
    [improved],
  );
  await pool.query(
    "INSERT INTO provider_profiles(company_id,project_types) VALUES($1,ARRAY['Commercial electrical'])",
    [improved],
  );
  const updatedDirectory = await call("/jobs/providers?q=" + directoryQuery);
  check(
    updatedDirectory.data.providers[2].id === improved,
    "Completing a profile changes its rank immediately without a new import flag",
  );
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
  const publicProfile = await call("/jobs/providers/" + supplier.companyId);
  check(
    publicProfile.status === 200 &&
      publicProfile.data.provider.capabilities.sources.every(
        (source) => source.url && !("evidence" in source),
      ),
    "Public profiles retain source links without publishing internal research excerpts",
  );
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
    taxonomy.status === 200 && taxonomy.data.categories.length === 42,
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
  // The full job flow includes sourced candidates without promoting unknown scope.
  const jobBody = {
    title: "Test commercial solar installation",
    description:
      "Install a commercial solar system in Cleveland, Ohio. Test job only.",
    trade: "installation",
    location: "Cleveland, OH",
    visibility: "invite_only",
    matchingPreferences: { ...request, preferAvailable: true },
  };
  check(
    (
      await call("/jobs", owner, {
        ...jobBody,
        matchingPreferences: { ...request, stateCode: "ZZ" },
      })
    ).status === 400,
    "invalid matching location rejected before saving a job",
  );
  const created = await call("/jobs", owner, jobBody);
  check(created.status === 201, JSON.stringify(created));
  const jobId = created.data.id;
  try {
    response = await call(`/jobs/${jobId}/matches`, owner);
    check(
      response.status === 200 &&
        response.data.configured &&
        find(response, installer),
      "publishing stores preferences and job owner can retrieve matches",
    );
    check(
      response.data.invitationsSent === 0 &&
        response.data.invitedCompanyIds.length === 0,
      "matching does not invite companies automatically",
    );
    const unclaimedInvite = await call(`/jobs/${jobId}/invite`, owner, {
      companyIds: [manufacturer],
    });
    check(
      unclaimedInvite.status === 200 &&
        !unclaimedInvite.data.invitedCompanyIds.includes(manufacturer),
      "unclaimed profiles are not falsely reported as invited",
    );
    await pool.query(
      "UPDATE companies SET listing_status='managed' WHERE id=$1",
      [installer],
    );
    const invited = await call(`/jobs/${jobId}/invite`, owner, {
      companyIds: [installer],
    });
    check(
      invited.status === 200 &&
        invited.data.invitedCompanyIds.includes(installer),
      "claimed company can be explicitly invited from matches",
    );
    await call(`/jobs/${jobId}/invite`, owner, { companyIds: [installer] });
    check(
      (
        await pool.query(
          "SELECT count(*)::int n FROM job_invitations WHERE job_id=$1 AND provider_company_id=$2",
          [jobId, installer],
        )
      ).rows[0].n === 1,
      "repeated invitations are idempotent",
    );
    await pool.query(
      "UPDATE jobs SET quote_deadline=now()-interval '1 day' WHERE id=$1",
      [jobId],
    );
    check(
      (await call(`/jobs/${jobId}/invite`, owner, { companyIds: [installer] }))
        .status === 409,
      "expired jobs cannot send invitations",
    );
    await pool.query("UPDATE jobs SET quote_deadline=NULL WHERE id=$1", [
      jobId,
    ]);
    check(
      [403, 404].includes(
        (await call(`/jobs/${jobId}/matches`, provider)).status,
      ),
      "another company cannot inspect hirer matching results",
    );
    check(
      (await call(`/jobs/${jobId}/matches?page=0`, owner)).status === 400,
      "matching pagination validated",
    );
    await pool.query(
      "UPDATE provider_matching_profiles SET state='source_checked' WHERE company_id=$1",
      [installer],
    );
    response = await call(`/jobs/${jobId}/matches`, owner);
    check(
      find(response, installer)?.evidenceLevel === "source_checked",
      "a current sourced profile can match documented service and coverage",
    );
    check(
      !find(await call("/jobs/provider-matches", owner, request), installer),
      "reviewed-only preview preserves its existing evidence boundary",
    );
    await pool.query(
      "UPDATE provider_coverage_areas SET state_code='TX' WHERE company_id=$1 AND kind='state'",
      [installer],
    );
    response = await call(`/jobs/${jobId}/matches`, owner);
    check(
      !find(response, installer) &&
        !find(response, installer, "needsConfirmation"),
      "explicit other-state coverage does not crowd job results",
    );
    await pool.query(
      "DELETE FROM provider_coverage_areas WHERE company_id=$1",
      [installer],
    );
    response = await call(`/jobs/${jobId}/matches`, owner);
    check(
      !find(response, installer) &&
        find(response, installer, "needsConfirmation")?.followUp.includes(
          "Service area",
        ),
      "unknown coverage is clearly separated from confirmed matches",
    );
    await pool.query(
      "UPDATE provider_profiles SET work_settings=$2,work_settings_confirmed_at=now() WHERE company_id=$1",
      [
        installer,
        JSON.stringify({ availability: "accepting", availableFrom: null }),
      ],
    );
    response = await call(`/jobs/${jobId}/matches`, owner);
    check(
      find(response, installer, "needsConfirmation")?.offerings[0]
        .availability === "accepting",
      "recent owner-confirmed profile availability feeds matching",
    );
    await pool.query(
      "UPDATE provider_profiles SET work_settings_confirmed_at=now()-interval '31 days' WHERE company_id=$1",
      [installer],
    );
    response = await call(`/jobs/${jobId}/matches`, owner);
    check(
      find(response, installer, "needsConfirmation")?.offerings[0]
        .availability === "unknown",
      "old profile availability expires",
    );
    const preferred = {
      ...request,
      preferredCredentials: [
        { title: "Personnel qualification", scope: "personnel" },
      ],
    };
    await pool.query(
      "UPDATE company_credentials SET valid_until=NULL,checked_at=now(),evidence_basis='company' WHERE company_id=$1 AND catalog_key=$2",
      [installer, credential],
    );
    check(
      (
        await call(
          `/jobs/${jobId}`,
          owner,
          { ...jobBody, matchingPreferences: preferred },
          "PATCH",
        )
      ).status === 200,
      "job matching preferences can be edited before quotes arrive",
    );
    response = await call(`/jobs/${jobId}/matches`, owner);
    check(
      find(response, installer, "needsConfirmation").reasons.includes(
        "Personnel qualification (listed)",
      ),
      "company-stated preferred credentials are labeled, not issuer-verified",
    );
    await pool.query(
      "UPDATE company_credentials SET valid_until=current_date-1 WHERE company_id=$1 AND catalog_key=$2",
      [installer, credential],
    );
    response = await call(`/jobs/${jobId}/matches`, owner);
    check(
      !find(response, installer, "needsConfirmation").reasons.some((r) =>
        r.startsWith("Personnel qualification"),
      ),
      "expired preferred credentials do not boost results",
    );
    check(
      (
        await call(
          `/jobs/${jobId}`,
          owner,
          { ...jobBody, matchingPreferences: null },
          "PATCH",
        )
      ).status === 200,
      "matching can be cleared explicitly",
    );
    check(
      (await call(`/jobs/${jobId}/matches`, owner)).data.configured === false,
      "unconfigured jobs show setup instead of invented matches",
    );
  } finally {
    await pool.query("DELETE FROM jobs WHERE id=$1", [jobId]);
  }
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
