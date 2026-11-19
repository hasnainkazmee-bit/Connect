# Colabb search and answer-engine discovery

## Public URLs

- `/services`: service directory.
- `/services/solar-installation`: companies with a current solar-installation offering.
- `/services/solar-installation/ohio`: providers based in Ohio or with recorded Ohio coverage for that offering.
- `/services/roofing/georgia/atlanta`: providers based in Atlanta or with explicit Atlanta city coverage. State-wide and country-wide coverage are not expanded into every city.
- `/services/solar-installation/ohio/page/2` and `/providers/page/2`: independently canonical paginated results. No query-string SEO landing pages.
- `/<company-username>`: the canonical company profile. Historical usernames, UUID routes and `/jobs/companies/<slug>` permanently redirect to it.

Filter/search query combinations remain app utilities, are `noindex,follow`, and do not enter the sitemap. Campaign parameters do not create alternate canonical pages. Empty combinations and unknown help/service pages return HTTP 404. Page 1 aliases redirect to the base URL.

## Eligibility and truthfulness

Service pages read the existing `provider_current_candidates` view: expired research and facts invalidated by a profile edit do not qualify. A company name never determines its category. Each company appears once per result set, regardless of offering count. Demos are excluded.

A profile enters the sitemap when it is not a demo, has at least 80 characters of overview, and has a location or services. A service/location page needs at least three qualifying companies to enter the sitemap and be indexable. Pages with one or two results are usable but noindex. These thresholds are guardrails, not a substitute for editorial review. Do not publish generic doorway pages or invent local availability, endorsements, credentials, reviews or prices.

Geography is based on explicit US city/state addresses or scoped coverage records. Cards distinguish `Based in` from `Recorded service area`. Confirm actual site coverage and availability with the provider. The `On Colabb` mark means a managed company account, not professional certification.

The discovery snapshot has a 60-second in-process TTL in production. Changes, expiry and deletions are reflected after that window. New eligible service/city combinations enter the sitemap automatically. No migration or copied SEO database is required.

## Rendering and metadata

`apps/api/src/colabb-seo.ts` is the Colabb public-page resolver. It produces server HTML and the same metadata used during client navigation. Legacy Connect remains on its existing renderer.

Public marketing pages, company profiles, directory pages, service pages and help pages have meaningful server-rendered text and links. Service landing-page content is shared between server and client. Help copy is shared too. Private workspaces expose a generic noindex shell, never proposals, addresses, attachments or messages.

Every public page has a title, description, absolute canonical, robots metadata and Open Graph/Twitter metadata with a 1200 × 630 PNG. `colabb-social-preview.png` uses the approved vector logo and Manrope. Organization logos have a raster version for crawler compatibility.

Structured data reflects visible content:

- Colabb: Organization, WebSite and WebPage (AboutPage for the story).
- Company: ProfilePage, Organization, actual service OfferCatalog and breadcrumbs.
- Discovery: CollectionPage, ItemList and BreadcrumbList.
- Help: WebPage and breadcrumbs.

No invented aggregate rating, LocalBusiness address, FAQ rich-result eligibility or employment JobPosting markup. These are company-to-company jobs, not employee vacancies. Google/Connect reviews stay separate in the product.

Crawl rules allow the public API resources needed to render company pages and public company images. API JSON responses carry `X-Robots-Tag: noindex`. Authentication continues to protect private resources. Hashed JS/CSS is cached immutably; build-time HTML fragments carry noindex.

## Verification and measurement

- Run `npm run build` and `npm run test:ui`; `colabb-seo.spec.ts` covers no-JavaScript rendering, responsive layout, geography, clean pagination, sparse-page exclusions, schema escaping, aliases, SPA metadata and private/demo exclusions in an isolated test database.
- Run `node tools/audit-colabb-seo.mjs https://connect.sunhubapp.com` after release.
- Submit `https://connect.sunhubapp.com/sitemap.xml` in the verified Google Search Console and Bing Webmaster Tools properties. This requires access to those properties; publishing a sitemap is not the same as submitting it.
- Inspect the homepage, a provider, Ohio installation, a city page and page 2 in Search Console URL Inspection. Validate their structured data with Google's Rich Results Test and schema.org validator. Not all valid schema creates a Google rich result.
- Monitor indexed vs excluded pages, crawl errors, query impressions/clicks by service and location, landing-page job starts, and Core Web Vitals. Compare against a pre-launch baseline and review at 2, 4 and 8 weeks.
- Recheck low-result/expired pages and enrich missing services/coverage rather than widening geography by inference. Keep unique company content current and obtain relevant industry links through real partnerships and useful resources.

Answer-engine readiness follows the same foundations: accessible factual text, clear headings, provenance, accurate entities and navigable supporting pages. No special AI schema or `llms.txt` is required, and no ranking or AI citation is guaranteed.

Primary guidance: [Google AI features](https://developers.google.com/search/docs/appearance/ai-features), [canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [spam policies](https://developers.google.com/search/docs/essentials/spam-policies), [Open Graph](https://ogp.me/).
