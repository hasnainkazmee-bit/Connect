# Master Companies public listing snapshot

Source: [All contacts - Sunhub - Industry enriched, Master Companies tab](https://docs.google.com/spreadsheets/d/1wpEjbcstR8oqTukT6vBlgqslrZSK6TQKwiWgi0W2vn0/edit?gid=1484232718#gid=1484232718), read 2026-11-04. The sheet's linked `gid=2018962536` is **Master Contacts**, so this snapshot uses the separate **Master Companies** tab.

The 14 NDJSON files contain 3,330 company-level public listings: name, website/domain, Connect business type, location, description, tagline, services, listed service areas, audiences, public business phone, logo URL, employee count/founded year when present, suggested username, and source-check date. No CRM relationship, deal, owner, contact, lead, sales, or review-note columns are included.

Selection from 3,537 populated rows: 3,417 were marked US/site qualified or eligible. We held back 84 of those because the listed domain did not match the website host, and three more because their normalized company name duplicated an earlier eligible row. Another 119 rows were marked as won-customer exceptions with sparse public profile data; one spacer row was ignored. Held-back rows require human review before publication.

Run `npm run directory:import-master` for a database-aware dry run; add `-- --apply` to create unclaimed listings. The importer never updates an existing profile or creates a user. Re-running it is safe.

Logo quality corrections: the source images for 15 lightyears and 1stle were customer logos (UCF and Public Storage). Migration 014 replaces them with each company's own header artwork from its official website. The original snapshot remains unchanged for provenance.

The same migration clears imported external logo URLs that could not be cached. Those listings show an empty white logo area and sort after listings with a usable logo; the original URLs remain in the source snapshot for later review.
