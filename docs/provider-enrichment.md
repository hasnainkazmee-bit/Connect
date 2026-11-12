# Provider enrichment and matching

The first cohort is eight existing, unclaimed Ohio company profiles. It covers four solar installers, an electrical contractor, an energy adviser, a racking manufacturer, and a distributor. This was the initial research pilot. The full-inventory discovery workflow and Rust matching foundation are described below.

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

`provider_capabilities` stores versioned, validated research separately from company-maintained `provider_profiles`. The operator importer uses a strict Zod schema; the Rust jobs service serves the profile detail. Reviewed research remains in JSONB with its evidence. Migration 026 adds a normalized projection for matching, without making unreviewed discovery data eligible.

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

## Matching principles

Use work category + delivery mode + applicable service area as eligibility inputs. A request for labor-only installers must not match an equipment supplier or a turnkey installer whose subcontracting policy is unknown. Show why a provider is a candidate, and distinguish information awaiting confirmation from a confirmed match.

Then collect from claimed companies: work arrangements accepted, current service territory, minimum/maximum project size by service, crew skills/count, earliest start, booked dates, work capacity, travel limits, and current credential/license/insurance evidence. Timestamp availability and expire it unless reconfirmed. Requirements such as licenses and mandatory certifications are eligibility checks; preferences such as nearby location or preferred credentials can order eligible results.

Only calculate distance after verified geocoding, with the accuracy displayed. Do not infer a radius from headquarters, rank by fabricated coordinates, promise job availability from website hours, or treat a published project size as current capacity. No invitations, emails, or notifications are sent by this pilot.

## Full company inventory and matching foundation

Migration `026_provider_matching.sql` enrolls every existing company and automatically enrolls new companies. Demo profiles have a separate state. Enrollment is not a claim that a profile has been researched or verified.

The reviewed JSON remains the editorial source. An indexed relational projection now supports Rust matching:

| Data | Structure | Matching rule |
| --- | --- | --- |
| Vocabulary | `provider_taxonomy` | 30 service IDs and 9 product IDs. Display wording can change without changing the ID. |
| Offerings | `provider_offerings` | Category, service delivery or product role, sector and normalized system types belong to one offering. |
| Evidence | `provider_evidence`, `provider_offering_evidence` | Every reviewed offering retains its official source, basis and check time. |
| Territory | `provider_coverage_areas`, `provider_coverage_offerings`, `provider_coverage_evidence` | Geography applies only to the linked offerings. Office location is never service coverage. |
| Research state | `provider_matching_profiles` | Stores the reviewed batch, profile snapshot and expiry. It does not overwrite owner-operated fields. |
| Availability | `provider_service_availability` | Company-confirmed status per service category, earliest start, available crew count, confirmer and expiry. Research cannot set it. |
| Discovery | `provider_research_runs`, `provider_research_results` | Immutable, inventory-complete research runs and per-company candidate evidence. Candidates cannot enter matching. |
| Credentials | Existing `company_credentials` | Required credentials use exact catalog key and scope, issuer evidence and freshness. Personnel qualification does not establish company certification. |

`provider_current_offerings` is the only matching input. It excludes demo profiles, expired research, profiles whose company-managed work details changed after research, and projections whose matching fields no longer equal the reviewed snapshot. Source material remains stored when a projection becomes stale. Re-running the projection command cannot silently overwrite the same batch after an owner edit.

Research is eligible for matching for 180 days, after which it requires review. Availability expires after the company's chosen confirmation period of 1–30 days. An expired or absent value is unknown. `crew_count` counts crews, not people; it must not be converted into job headcount. Company marketing about speed, opening hours or emergency response is not a live availability feed.

City coverage matches an exact normalized city within its country and state. State and country coverage are explicit. Multi-state regions can carry a reviewed `stateCodes` list: Caltrik's explicit contiguous-US territory contains the 48 applicable states, so it does not automatically match Alaska or Hawaii. Other descriptive regions and metros remain unconfirmed until a boundary is explicitly mapped. There is no invented radius or geocoding.

Research can retain international bases and territories using country codes. The current matching location contract supports US states and Canadian provinces/territories. The original profile location stays available for display; unknown base locations can be null in new research. Neither that display label nor an office address is used to estimate travel distance.

### Rust API contract

- `GET /api/jobs/provider-taxonomy`: stable category IDs and labels, sectors, system types and delivery modes.
- `POST /api/jobs/provider-matches`: authenticated company preview, with separate `matches` and `needsConfirmation` arrays, reasons, source links and totals. Results are paginated (24 per group by default, maximum 50). It does not create invitations or edit jobs.
- `PUT /api/jobs/providers/me/availability`: verified company owner/admin confirmation for that company's service category. A company ID in the request is rejected; the session determines the company.

Example matching input:

```json
{
  "kind": "service",
  "categoryId": "solar-installation",
  "sector": "commercial",
  "delivery": "turnkey",
  "countryCode": "US",
  "stateCode": "OH",
  "requireAvailability": true,
  "startBy": "2027-01-15",
  "requiredCredentials": [],
  "page": 1,
  "pageSize": 24
}
```

A service/category/territory fit can be returned with unknown availability if the request does not require a confirmed schedule. The result still explicitly labels availability `unknown`. A requested schedule, unknown sector/system type, unmapped service territory or unverified mandatory credential places the offering in `needsConfirmation`. Another offering from the same company cannot supply missing scope for it. An explicitly different delivery method or sector is excluded. Self-matches are excluded.

The existing broad job text is not automatically converted into these IDs. The next job-form iteration should submit selected taxonomy IDs directly, using preferences for ranking and requirements for eligibility. Project size, headcount, stock, insurance policy limits, licenses and distance still need additional structured, confirmed inputs before they can be used as matching constraints. Unsupported request fields are rejected instead of silently ignored.

### Complete research run

Export current public identity fields, then crawl official sites:

```sh
mkdir -p .research/provider-matching
node apps/api/dist/export-provider-inventory.js > .research/provider-matching/inventory.json
python3 tools/research-provider-capabilities.py crawl --workers 12 --pages 3
python3 tools/research-provider-capabilities.py report
```

The first inventory contains 3,339 real companies and 20 demos. Old credential caches suggest URLs only; the new run checks pages afresh. The crawler respects robots and per-host delays, validates public network destinations, checks redirects, retains source hashes/timestamps, excludes menu/form/testimonial content from discovery and never interprets a candidate as approval. Domain redirects, missing identity evidence, inaccessible pages and missing websites have explicit outcomes. A bounded three-page pass is discovery, not an assertion that all company capabilities have been found.

The resume log and cached source text are in ignored `.research/provider-matching/`. Production receives concise candidate evidence and source receipts, not full page copies. Candidate fields do not update public profiles, credentials, company accounts, contacts or operational capacity. A website name match is a review aid; it is not sufficient for publication by itself.

Import the complete run through the operator command (dry run first):

```sh
npm run providers:research-import -- \
  --run-id company-capabilities-2026-11-12 \
  --inventory .research/provider-matching/inventory.json \
  --results .research/provider-matching/research.jsonl
# Repeat the same command with --apply after checking the report.
npm run providers:matching-report
```

Every inventory company must appear exactly once after resume-log deduplication. The importer verifies current company UUID/name/domain/demo identity, checks all source references and taxonomy IDs, and rejects an entire run if identities changed. Reusing an identical run is a no-op; changing input under an existing ID fails. Research results are internal, not served by a public endpoint.

Promote findings only by preparing a reviewed batch in the same format as the Ohio and Texas files. The existing 25-company batch limit, current-profile comparison, ownership protections and before-state audit remain. A business-type correction additionally needs the observed previous type and source-backed replacement. After importing a reviewed batch, the relational matching projection updates in the same transaction.

Existing reviewed data can be projected once after migration:

```sh
npm run providers:project-matching
npm run providers:project-matching -- --apply
```

### Texas source review

`data/provider-enrichment/texas-reviewed-2026-11-12.json` contains four further existing profiles, 15 service offerings and 9 product offerings, backed by 10 freshly checked official pages. Its source receipts are in the companion `texas-source-checks-2026-11-12.json`.

- **Caltrik Solar:** equipment distributor and freight coordination. Corrects the old installer label. Its territory is scoped to equipment supply and the contiguous states.
- **TXEN Solar:** separate home and commercial solar offerings, home storage/generators, and repairs of other installers' systems. Commercial service cities are not automatically assigned to every residential repair service.
- **Seven Petal Electric:** electrical work, home generators, batteries and EV charging. Corrects the old installer label to contractor. An ambiguously placed solar sentence is insufficient evidence for adding solar installation. Its base address remains unconfirmed; the existing display location is preserved.
- **Capital Power Systems:** generator delivery, electrical services, maintenance and rental. Corrects the old installer label to contractor. A solar catalog entry marked as forthcoming is not a current solar capability. Rental availability and stock remain unknown.

### Validation

`tests/provider-capability-research.test.py` checks extraction boundaries. `tests/provider-enrichment.test.mjs` and `tests/provider-matching.test.mjs` check transactional import/projection behavior. `tests/provider-matching-api.mjs` starts the actual Rust service against an isolated `_test` database and covers eligibility, territory scope, regional exclusions, credentials, role permissions, owner edits, availability expiry, pagination and input validation. The dedicated `provider-matching` CI job runs these independently from the retired directory UI tests.

### 12 November 2026 inventory pass

The completed run accounts for all 3,359 inventory entries: 3,339 real companies and 20 excluded demos. It read 8,861 official website pages and found 9,818 offering candidates across 2,431 companies. Another 692 companies need deeper scope research, 143 need identity review, 53 were restricted by robots/access checks, 19 were unreachable, and one had no website.

These are discovery outcomes, not claims that all profiles are fully enriched. The reviewed Ohio and Texas batches together provide 12 detailed profiles, 54 service offerings and 24 product offerings. The remaining candidates need evidence review before publication and matching. Company-confirmed availability and capacity remain separate. See `data/provider-enrichment/company-research-summary-2026-11-12.json` for the run summary and source-file hashes; full per-company results are retained in the internal research tables.
