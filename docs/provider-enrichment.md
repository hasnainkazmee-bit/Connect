# Provider enrichment: Ohio pilot

The first cohort is eight existing, unclaimed Ohio company profiles. It covers four solar installers, an electrical contractor, an energy adviser, a racking manufacturer, and a distributor. This is a deliberately small research pilot, not a bulk crawl or a working job recommendation engine.

Reviewed input: `data/provider-enrichment/ohio-pilot-2026-11-12.json`. It contains 39 services, 15 product offerings, and 27 official website pages reviewed on 12 November 2026. Each claim references its source within the record. Existing Connect company UUID and official domain identify the target; a similar company name is not enough.

`data/provider-enrichment/ohio-pilot-source-checks.json` records the URL, check time and content hash for every reviewed page. All 27 pages were readable during the final source check. State names inside a contact form are not coverage evidence; the Solar Power & Light territory, for example, references its explicit five-state service list.

## Profile findings

| Company | Profile focus | Important matching distinction |
| --- | --- | --- |
| Yellowlite Inc | Solar projects, engineering, storage, repairs, home EV charging | Repairs other installers' systems. Neighboring-state installation territory must not be applied automatically to repair services. |
| Icon Solar | Residential/commercial solar, repairs, expansions, home batteries | Full installation projects with its own team do not establish availability for labor-only subcontracting. |
| Ohio Power Solutions | Solar, battery backup, generators, solar thermal, wind, lighting | Central Ohio and named cities are supported; statewide crew coverage is not. A customer's EV-charging testimonial is insufficient to add that service. |
| Raiden Electric | Electrical work, solar, facility batteries, EV charging, maintenance staffing | Explicitly offers hourly/contracted facility maintenance personnel. That does not establish solar installation crew supply. |
| Solar Power & Light | Solar delivery, repair/O&M, battery care, detach/reset, development | Supports other installers' systems and roofing-related array removal. Utility development is delivered through a consortium. |
| APA Solar | Racking engineering, installation programs, manufactured racking/foundations | National equipment supply and engineering do not prove nationwide field crew coverage. |
| Exel Solar | Wholesale modules, inverters, batteries, mounting, BOS, procurement and logistics | Distributor, not an installation crew. Catalog listings do not establish stock, dealer authorization, price or lead time. |
| Ampica | Energy advisory, renewable procurement, solar project implementation support | North American advisory footprint does not establish an on-site installation territory. |

## Data model

`provider_capabilities` stores versioned, validated research separately from company-maintained `provider_profiles`. The operator importer uses a strict Zod schema; the Rust jobs service serves the profile detail. The research is JSONB so this small pilot can refine its vocabulary without manufacturing a large taxonomy prematurely.

- **Services:** stable local identifier, normalized category, clear scope, supported sectors, delivery mode, system configurations, acceptance of third-party systems, and evidence links. Geography references individual service IDs; sectors belong to each service, not a company-wide Cartesian product.
- **Products:** category, supply role (`manufactures`, `distributes`, `supplies-and-installs`), named brands supported by product evidence, and sources. A logo alone is insufficient.
- **Location:** city, state and country of the business. Coordinates remain null with city precision. Office location is distinct from service coverage and from the crew's current location.
- **Coverage:** city, metro, region, state or country, plus the exact services/products covered. Advisory coverage, shipping coverage and on-site coverage stay attached to their respective offerings.
- **Source review:** exact URLs, company-website basis, review date, identity explanation, and concise evidence notes. These are company-published capabilities, not independent performance guarantees.
- **Unknowns:** current availability, earliest start, crew capacity, labor-only work, subcontracting and live stock are explicitly unknown. An empty field does not mean a company cannot perform the work. Existing company-maintained availability, crew, capacity, license and insurance fields are never changed by this import.
- **Qualifications:** existing credentials remain separate, retaining issuer/company/directory scope. A website's NABCEP personnel statement is not company accreditation; manufacturer logos are not verified installer status. This pilot does not promote any certification claims.

The public profile presents specific service descriptions, separate product offerings, scoped coverage, and compact source links using the existing design system. A later company work-details edit takes precedence over the researched presentation. Research remains available in storage for review; it is not silently reasserted over an owner's edit.

## Import safeguards and operation

Apply migration `025_provider_capabilities.sql`, build the API, then preview the exact batch:

```sh
npm run providers:enrich -- --file data/provider-enrichment/ohio-pilot-2026-11-12.json
npm run providers:enrich -- --file data/provider-enrichment/ohio-pilot-2026-11-12.json --apply
```

The normal build, migration and application startup never import records. Batches are limited to 25 profiles. Dry run is the default. The importer validates source ownership and references, locks the target rows, compares the observed profile snapshot, and refuses managed companies, demo identities, memberships, stale research, changed profiles and changed data under an already-used batch ID. Any blocked record prevents the entire apply transaction.

Only descriptions, taglines, service labels, service areas, trade labels and project types are updated. Existing logos, locations, websites, accounts, credentials, reviews, jobs and messages are preserved. Full before-state snapshots and the applied record hash are retained in `provider_enrichment_audit`. Reapplying identical input is a no-op even if an owner subsequently edits their profile. An undo should compare current values to the recorded after-state and restore only unchanged imported fields; never replay an old whole-company snapshot over later owner edits.

In the packaged production app, copy the batch into the running app container and use `node apps/api/dist/import-provider-enrichment.js --file /tmp/provider-pilot.json`, first without `--apply`. Do not run the importer against a different database simply because the names match.

Focused checks:

```sh
DATABASE_URL=postgres://.../connect_provider_enrichment_test node --test tests/provider-enrichment.test.mjs
```

## Next matching iteration

Use work category + delivery mode + applicable service area as eligibility inputs. A request for labor-only installers must not match an equipment supplier or a turnkey installer whose subcontracting policy is unknown. Show why a provider is a candidate, and distinguish information awaiting confirmation from a confirmed match.

Then collect from claimed companies: work arrangements accepted, current service territory, minimum/maximum project size by service, crew skills/count, earliest start, booked dates, work capacity, travel limits, and current credential/license/insurance evidence. Timestamp availability and expire it unless reconfirmed. Requirements such as licenses and mandatory certifications are eligibility checks; preferences such as nearby location or preferred credentials can order eligible results.

Only calculate distance after verified geocoding, with the accuracy displayed. Do not infer a radius from headquarters, rank by fabricated coordinates, promise job availability from website hours, or treat a published project size as current capacity. No invitations, emails, or notifications are sent by this pilot.
