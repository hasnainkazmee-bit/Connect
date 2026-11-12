# Job matching

The hirer chooses a service or product and a state/province while posting a job. Project type, system type, preferred certifications, delivery method, local base and fresh availability refine the results. Publishing opens a full-page company list. Searching never sends an invitation.

## Candidate pool and readiness

The initial pool contains 991 enriched profiles: 12 individually reviewed profiles and 979 profiles with source-checked offerings. The latter now participate in candidate evaluation instead of being excluded entirely. This is not a promotion of all 979 to verified coverage or live availability.

Only the 12 reviewed profiles currently have offering-specific coverage research. The other 979 can appear under **Needs confirmation** for the services they explicitly offer. Their existing office or broad directory location is not reinterpreted as an installation territory. To qualify for a specific job, an offering needs matching service, location, project sector, system and delivery facts for whichever of those the hirer selected. Missing facts stay visible. Explicit coverage limited to other states is excluded.

Use `npm run providers:matching-report` after migration 032 to see the current candidate pool, coverage gaps and fresh availability count. These counts are live, not hard-coded in the UI. Changed or expired research drops out until reviewed again. Demo companies remain available in the existing test/browse flow but are excluded from evidence-based matches.

## Ranking

Results are sorted by the best single offering per company. Facts from unrelated offerings are never combined to fabricate a fit. The ranking considers the requested service, confirmed territory, project sector, system type, delivery mode, and the hirer's preferences. A same-state office is a separate preference, not evidence of service coverage. Distance is not calculated.

Preferred certifications use exact title and scope, freshness and expiry. Issuer-supported credentials rank above company-listed ones. Personnel qualifications remain personnel qualifications. These are preferences, not assertions that all job requirements have been verified. Current capacity, project size, crew size and any missing schedule are shown as items to confirm with the company.

Per-service availability is valid only until its owner-confirmed expiry. The profile's structured work availability can also be used after the company saves its service-area/availability section; that confirmation lasts 30 days. An old or absent value is unknown. Saving unrelated profile sections does not refresh availability.

## Screens and actions

1. **Post a job:** choose work, location and matching preferences; enter scope; add files; publish.
2. **Companies for your job:** switch between Matches and Needs confirmation. Each company shows its service, reasons, missing details and official sources. The requirements sidebar collapses on smaller screens. Edit preferences is available only while the job remains editable.
3. **Company profile:** review services, projects and credentials, then return to the same results tab and page.
4. **Invite to quote:** an explicit action for a managed company. The server checks ownership, admin role, open job and quote deadline. Unclaimed public profiles cannot receive in-app invitations yet. The response reports actual invitation IDs; it does not pretend an unclaimed invitation was sent.
5. The existing flow continues: invitation → quote and job conversation → choose company → provider confirms → progress updates → work submitted → accept or request changes → review.

No modal is introduced. Exact site addresses stay subject to the existing job privacy rules. Matching is hirer-only.

## API and storage

- `GET /api/jobs/provider-taxonomy`: categories, sectors, system types, delivery methods and preferred-credential options.
- `matchingPreferences` on POST/PATCH `/api/jobs`: validated JSON stored as `jobs.matching_preferences`. Omission on PATCH preserves the value; explicit `null` clears it.
- `GET /api/jobs/:id/matches?page=1`: authenticated hirer; 12 results per group, total counts, reasons, follow-up items, sources and actual invitation state. It does not create invitations.
- `POST /api/jobs/provider-matches` retains its reviewed-only boundary for callers that need that stricter dataset.
- `provider_current_candidates` shares the existing expiry, identity/snapshot and owner-edit protections, while admitting `source_checked` candidates.

## Manual test

Post under your company with these fields:

- Title: `TEST — Commercial solar installation in Cleveland`
- Work: Installation
- Location: Cleveland, OH
- Service: Solar installation; country: United States; state: Ohio
- Project type: Commercial; size: 250 kW; sites: 1
- System type: Any system
- Delivery preference: Complete installation / turnkey
- Start: Flexible; budget: Receive quotes; leave preferred certifications empty for the first test

Description:

> TEST JOB — evaluating the Connect workflow. We need a company to plan, install and commission a 250 kW solar system for one commercial property in Cleveland, Ohio. Scope includes a site survey, system design, permits, mounting and module installation, inverters, electrical connections, testing and commissioning. Please quote the total price, earliest start, expected duration, relevant commercial projects and exclusions. Final system layout and equipment will be agreed after the site assessment. No purchase or site visit is authorized by this test post.

With the current reviewed research, Icon Solar, Solar Power & Light and Yellowlite Inc meet the service/area/commercial/turnkey filters. Project capacity and availability still need confirmation. Adding Rooftop requires explicit rooftop facts; it can move otherwise relevant companies into Needs confirmation. A name appearing in results does not mean its account has been claimed or it has agreed to do the work.

Only send an invitation to a company when you intend to contact it. Automated checks use isolated local accounts, with outbound push/email disabled.
