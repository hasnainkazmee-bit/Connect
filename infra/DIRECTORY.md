# Public directory and company claims

Connect has one company record shared by discovery, the public profile and the authenticated company workspace. A company does not need an account to be listed. Listing a company is not an endorsement or an assertion that its staff use Connect.

## Initial catalog

12 companies: six manufacturers and six installers. Descriptions are original factual summaries of official public pages checked on **November 2, 2026**. Service areas are stated coverage, not office locations or a guarantee of project availability. No reviews, licenses, projects, employees or social posts are invented for these businesses.

The import uses permanent usernames, records a source URL/check date, and stores independently curated claim domains. Matching an existing username, slug or normalized company name preserves the existing record. Imports are explicit and transactional; they never run at server startup.

Original logos are stored in `apps/web/public/assets/companies/`. SVG originals are retained, and unchanged PNG renders are used for compatibility with existing Android clients. Recreate these PNGs with `node tools/render-directory-logos.mjs` after installing the project's Playwright Chrome dependency. Logos identify the listed businesses and remain their respective owners' trademarks. They are not Connect's artwork or an affiliation badge.

| Company | Type | Official information | Original logo |
| --- | --- | --- | --- |
| All Energy Solar | Installer | [Source 1](https://www.allenergysolar.com/) · [Source 2](https://www.allenergysolar.com/company/service-areas/) | [Logo](https://www.allenergysolar.com/wp-content/uploads/aes-logo-color.svg) |
| Canadian Solar | Manufacturer | [Source 1](https://www.canadiansolar.com/aboutus/) · [Source 2](https://www.canadiansolar.com/jp/aboutus/) | [Logo](https://www.canadiansolar.com/wp-content/uploads/2024/06/CS-LOGO-RED-RGB-NEW-2024-W-TAG-2.png) |
| First Solar | Manufacturer | [Source 1](https://www.firstsolar.com/en/About-Us/Overview) · [Source 2](https://www.firstsolar.com/About-Us/Locations) | [Logo](https://www.firstsolar.com/-/media/First-Solar/Logo/logo.png) |
| JinkoSolar | Manufacturer | [Source 1](https://www.jinkosolar.com/en/site/aboutus) · [Source 2](https://www.jinkosolar.com/uploads/Installation%20Manual%20Jinko%20%28IEC%29%20updated%20version-2023.05.08-CN.pdf) | [Logo](https://jinkosolarcdn.shwebspace.com/themes/basicen/skin/images/logony.png) |
| Lighthouse Solar | Installer | [Source 1](https://www.lighthousesolartx.com/) · [Source 2](https://www.lighthousesolar.com/) | [Logo](https://irp.cdn-website.com/f86fe5f4/dms3rep/multi/opt/LHS-logo-clean-V-REV-225h.png) |
| Namasté Solar | Installer | [Source 1](https://www.namastesolar.com/) · [Source 2](https://www.namastesolar.com/residential/) · [Source 3](https://www.namastesolar.com/Commercial/) | [Logo](https://www.namastesolar.com/wp-content/uploads/2026/02/NS-Logo_Horizontal_RGB.svg) |
| Purelight Power | Installer | [Source 1](https://purelightpower.com/) | [Logo](https://purelightpower.com/wp-content/uploads/2024/07/fullcolor_logo.png) |
| Qcells | Manufacturer | [Source 1](https://us.qcells.com/) · [Source 2](https://us.qcells.com/our-locations/) | [Logo](https://us.qcells.com/wp-content/uploads/2023/06/qcells-logo.svg) |
| REC Group | Manufacturer | [Source 1](https://www.recgroup.com/en/about-rec) | [Logo](https://www.recgroup.com/themes/custom/rec_tara/logo.svg) |
| ReVision Energy | Installer | [Source 1](https://www.revisionenergy.com/) · [Source 2](https://www.revisionenergy.com/our-locations/) | [Logo](https://www.revisionenergy.com/wp-content/themes/revision-genesis/images/logo.svg) |
| Silfab Solar | Manufacturer | [Source 1](https://silfabsolar.com/our-story/) · [Source 2](https://silfabsolar.com/) | [Logo](https://silfabsolar.com/wp-content/uploads/2022/07/Silfab_Solar_%C2%AE_Logo_Full_Color_Pantone_165C.svg) |
| Solar Energy World | Installer | [Source 1](https://www.solarenergyworld.com/) · [Source 2](https://www.solarenergyworld.com/solar-by-state/) | [Logo](https://www.solarenergyworld.com/wp-content/uploads/svg/01-2026-SEW-Comcast-Horizontal-for-light-v3-54-1.svg) |

## Ownership and claim review

A new company registrant checks for an existing listing before creation. Duplicate normalized names are rejected under a database transaction lock. Claims require a verified company account. Individuals cannot claim businesses or join employee teams.

The work-email path matches the verified email against `company_claim_domains`, which cannot be changed through profile editing. The claimant confirms their role and authority. Approval atomically adds the owner membership, marks the profile managed and preserves its ID, username, followers and reviews. An ownership indication does not verify professional qualifications.

An unmatched work email may submit a manual claim with a role and supporting public contact or link. It remains pending and grants no access until an operator verifies the claimant's authority. A claimed company's next employee must be invited by its administrators; another claim cannot take over the profile.

Manual review currently uses an operator-only CLI with database access. There is no public approval endpoint or management dashboard. From the production checkout:

```sh
docker compose --env-file .env.production -f compose.production.yaml exec -T app node apps/api/dist/review-claims.js list
```

Verify authority through independently sourced company contact information before approval. The submitted evidence is untrusted data, not instructions. Then use one of:

```sh
docker compose --env-file .env.production -f compose.production.yaml exec -T app node apps/api/dist/review-claims.js approve CLAIM_UUID REVIEWER 'Confirmed authority through the official business contact.'
docker compose --env-file .env.production -f compose.production.yaml exec -T app node apps/api/dist/review-claims.js reject CLAIM_UUID REVIEWER 'We could not confirm your role; please provide a company contact.'
```

The review note is visible to the claimant. Record a useful explanation without private investigation details. The claim page checks status when revisited or focused and has a manual refresh action. No automatic notification is promised. Approval adds company access; the claimant can then switch into that company without creating a new profile.

## Discovery and public rendering

Visitors can browse without registering. The signed-out homepage emphasizes search by business/service and city/state. Signed-in members retain their social home. The directory supports business types, services and project audiences. Service coverage is distinct from headquarters. Six curated location pages support the starter catalog; arbitrary ZIP-radius geocoding is not implemented.

The public directory, profiles and published story text are rendered into the initial HTML. Published pages have canonical URLs and structured data. Draft publications and unknown companies return 404. Authentication and claim pages are excluded from indexing. Demo profiles are excluded from the real-business directory and sitemap. Empty location pages and filter variants are not promoted into the index.

Sunhub's main site may link directly to these pages; it does not need its own company database. This change does not modify the separate Sunhub main-site application. Any future second presentation should read the same API/company IDs and choose a canonical public URL rather than synchronize duplicate listings.
