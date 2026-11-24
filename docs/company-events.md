# Event participation

Event banners are separate from certifications, claimed-account identity, and reviews. The initial display reads **Attended RE+ 2026**, using the supplied RE+ logo. Profiles also identify the participation role; directory cards use a compact version of the same component.

`industry_events` defines reusable event identities. `company_event_participations` links companies to an event, preserving role, source reference, research date and identity rationale. Public APIs use `company_public_events`, which intentionally excludes internal spreadsheets, row references and research notes.

## Reviewed imports

The operator command defaults to a dry run:

```sh
node apps/api/dist/import-event-companies.js --file /path/to/reviewed-batch.json
node apps/api/dist/import-event-companies.js --file /path/to/reviewed-batch.json --apply
```

Each batch has at most 100 records, a stable ID and a content hash. It runs in a transaction. Existing companies must match the reviewed UUID, name and website domain. Existing descriptions, ownership, logos, memberships, availability, licenses and credentials are not modified. Replaying the same applied batch is a no-op; changing it under the same ID is rejected.

New companies require a substantive overview, sourced offerings, accurate business type and first-party evidence. Name/domain collisions stop publication for reconciliation. New listings remain unclaimed; importing never creates users, memberships, invitations or outreach. Contact-person addresses, roles and countries must not become company headquarters or coverage. Service territory requires the existing scoped provider enrichment workflow. Website research does not establish live stock, staffing, availability or independently verified credentials.

The public company profile shows overview, services and project types. First-party evidence is retained in `company_event_profile_sources`; it is not a substitute for the richer `provider_capabilities` matching projection. If additional reviewed matching research is prepared, apply it using `import-provider-enrichment.js` with current snapshots and explicit offering/territory evidence.

Cache new logos through the existing normalized company-asset pipeline, scoped to this event:

```sh
node apps/api/dist/import-company-logos.js --event=replus-2026
node apps/api/dist/import-company-logos.js --event=replus-2026 --apply
```

Only unclaimed listings with remote logos are eligible. This does not modify managed companies or unrelated listings.

For reproducible visual review, add `--cache-dir=/path/to/reviewed-logos` with `--event`. That directory contains `manifest.json` mapping each exact source URL to its SHA-256, plus `<sha256>.webp` files. Only source URLs in the manifest are selected, and altered bytes are rejected. Reversed white marks receive a dark plate without recoloring their artwork.

## RE+ research

The supplied workbook has 1,045 contact rows representing 625 distinct exhibitor/domain pairs. Only company columns were retained for research; contact fields are not part of import batches. The user confirmed that the list describes RE+ 2026. The initial inventory comparison found 85 exact domain matches, five name-only candidates and 535 potentially new companies. A domain match is not enough when the exhibitor name identifies a different business.

`tools/research-event-companies.py` uses the existing robots-aware provider crawler, records source receipts and logo candidates, and never publishes raw crawl output. Captured logo candidates can belong to customers or partners and require review. Blocked sites, mismatched domains, sparse pages and uncertain logos are held out of publication, with outcomes retained in the private research workspace.

Checks cover dry runs, duplicate protection, changed identities, transaction rollback, idempotency, company-control preservation, source privacy and desktop/mobile badge rendering.
