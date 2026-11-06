# Company credentials and industry presence

Profiles have a dedicated sourced section, separate from company-authored achievements and Connect reviews. Web, Mac and Windows use the shared editor; Android displays the same API records.

Records distinguish certification, professional qualification, industry ranking, directory listing and membership. Every record includes its organization, company/product/personnel scope, scope details, HTTPS evidence URL and evidence basis. Period, expiry and source-check date remain separate: checking a page does not renew a certificate or establish current validity.

Company administrators can add, edit and remove their own records. Those submissions are always company-reported and have no independent review date. Administrators cannot change or delete operator-sourced catalog records through the profile API. Contact the operator to correct a sourced record. The API never fetches submitted URLs.

## Import public research

After building and applying migration 016:

```sh
npm run build
npm run migrate
npm run directory:credentials
npm run directory:credentials -- --apply
```

The default is a dry run. The explicit apply is transactional and idempotent by company and catalog key. It only updates credential records; it does not create companies, users, memberships, claims or reviews. It matches an existing non-demo directory identity and its official website. Missing or mismatched profiles are skipped. Run the existing directory import first if needed.

`apps/api/src/credential-catalog.ts` contains the source URLs and a fixed research date, 2026-11-06. Re-running the importer does not pretend to recheck those sources. Revisit the pages and update the catalog and date when refreshing evidence. Removed catalog entries are not automatically deleted: remove or supersede outdated records deliberately after review.

The first batch covers ten existing companies: All Energy Solar, Namaste Solar, ReVision Energy, Solar Energy World, Silfab Solar, REC Group, First Solar, Canadian Solar, JinkoSolar and Qcells. Lighthouse Solar and Purelight Power have no inferred credentials in this batch. Empty records do not mean a company lacks credentials.

## Evidence rules

- NABCEP professional certification belongs to the named person. Company accreditation requires its own evidence.
- UL/IEC standards apply to models and certificate conditions. A manufacturer datasheet is labeled company-reported; mentioning a UL standard does not identify UL as the issuing laboratory.
- BloombergNEF and S&P Global Tier 1 are distinct industry classifications. They do not replace model safety certificates. Canadian Solar's BNEF website claim has no quarter, so it is explicitly undated and does not establish inclusion in the latest list.
- Directory presence does not imply network approval. Namaste Solar and Silfab Solar's EnergySage entries explicitly state they are not in its network.
- External review counts and ratings never contribute to Connect's customer review scores.

Key references: [BNEF methodology](https://assets.bnef.com/public/tiering/solarmodules.pdf), [S&P Global 2026 list](https://www.spglobal.com/energy/en/news-research/blog/energy-transition/070726-tier-1-cleantech-companies-pv-wind-turbine-battery-cells-storage-systems), [NABCEP professional directory](https://directories.nabcep.org/?_certtypes=professional), and the individual evidence URLs in the catalog.

## Full live-directory research

The live directory snapshot on 2026-11-06 contains 3,339 companies, substantially more than the original curated seed catalog. The scalable research commands require Python 3.10+ and curl:

```sh
npm run credentials:research -- inventory
npm run credentials:research -- crawl --workers 24 --pages 3
npm run credentials:research -- sitemaps
npm run credentials:research -- directories --workers 6
npm run credentials:research -- reconcile
npm run credentials:batch
npm run credentials:research -- report --publish
npm run test:credential-research
```

The inventory is fetched from the public app API with exact company UUIDs and official website identities. Crawls resume from `.research/credentials/crawl.jsonl`; page text, raw contexts and checkpoint files remain in ignored local research storage. The first pass visits the website and up to two relevant linked pages per company. A no-findings result only describes the pages checked, not the absence of credentials. Access failures, robots exclusions, changed domains and a missing website are recorded separately.

The crawler validates public network destinations at each redirect, retains TLS verification, and throttles requests per host. Robots disallow rules and declared crawl delays are honored. Directory discovery uses publicly listed EnergySage and SolarReviews sitemaps, not their private search or account APIs. A sitemap name match is only a candidate: it requires either the exact official website backlink or both an exact company heading and a phone number corroborated on the official company website. A direct directory link from the company's own website can also be corroborated by the profile's exact company heading.

`tools/build-credential-batch.py` recognizes a limited set of explicit first-party installer designations and NABCEP personnel statements. Educational material, negation, training, historical transitions, vague alignment, supplier/partner credentials and generic product-standard mentions abstain. Those automatic records are **company-reported claims**, not independent issuer verification. Product certificates and rankings require manual scope review. Human-reviewed records and exact issuer-directory domain matches live in `data/company-credentials/manual.json`; they take precedence in the resulting `reviewed.json` batch. Each imported record retains its source, check date, scope and evidence basis. Review method and evidence rationale are preserved in the batch artifact.

### Apply the reviewed batch

Build and deploy the code/migration first. Preview the exact data changes before applying:

```sh
npm run directory:credentials -- --file data/company-credentials/reviewed.json
npm run directory:credentials -- --file data/company-credentials/reviewed.json --apply
```

The batch importer matches the exact company UUID **and** current official website domain. It never creates companies or accounts, and rejects raw crawl findings, duplicate keys, future source-check dates and first-party claims masquerading as issuer evidence. Repeating an apply is idempotent. An older source check cannot replace newer evidence. Existing company-authored credentials remain separate.

For a packaged production app, copy the reviewed JSON file into the running app container and use the compiled importer there:

```sh
docker compose --env-file .env.production -f compose.production.yaml cp data/company-credentials/reviewed.json app:/tmp/connect-reviewed-credentials.json
docker compose --env-file .env.production -f compose.production.yaml exec -T app node apps/api/dist/import-credentials.js --file /tmp/connect-reviewed-credentials.json
docker compose --env-file .env.production -f compose.production.yaml exec -T app node apps/api/dist/import-credentials.js --file /tmp/connect-reviewed-credentials.json --apply
```

The JSON file is an operator input, not a public upload route. A successful local import test does not mean the production app has been deployed or populated. The full coverage snapshot and batch counts are recorded in `data/company-credentials/research-summary.json` and `coverage.json` when a research pass is published.
