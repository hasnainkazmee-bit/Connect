# Connect hiring marketplace

The active web product is at `connect.sunhubapp.com`. This guide supersedes the social-feed layout guidance for web marketplace routes. Native clients and the separate `sunhubapp.com` application are outside this release.

## Decisions and information

| Screen                      | User decision                    | Information that belongs here                                                                                           | Main action                                                              |
| --------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Public home                 | Get help or find work            | Crews, specialist services, supplies and solar business support; simple hiring process                                  | Post what you need / Find work                                           |
| Find work                   | Can we help with this request?   | Clear title, short brief, work category, location, headcount/duration when known, budget, hiring company                | View job                                                                 |
| Post a job                  | What help do we need?            | One-page form with title/type, location/timing, description/files, optional budget, and a live preview                  | Publish job / Save draft                                                 |
| Job details, before quoting | Can we deliver this scope?       | Full brief, requirements, materials responsibility, documents, timing, budget, company profile                          | Send a quote                                                             |
| Quote form                  | What are we proposing?           | Total price, availability, duration, approach, optional inclusions/exclusions/terms and price breakdown, multiple files | Send quote                                                               |
| Hiring company, open job    | Which proposal should we choose? | Received quotes with price/schedule, full proposal and documents, company evidence, questions                           | Choose company, with confirmation                                        |
| Active job                  | What happens next?               | Current stage, progress, original brief/files, job-specific messages, agreed quote                                      | Confirm / Share progress / Review work, according to role and stage      |
| Payment plan                | What has each company reported?  | Agreed total, named stages, invoice reference, reported payment and receipt status                                      | Role-specific confirmation                                               |
| Company profile             | Is this company suitable?        | Services, real project examples, coverage/capacity, credentials with sources, job reviews                               | Invite to a job; unclaimed listings link to their website and claim flow |
| My jobs                     | Which work needs attention?      | Posted jobs, quotes, invitations, selected active jobs, completed work                                                  | A stage-specific next action                                             |

Do not invent a budget, project size, availability, rating, or credential to fill space. Optional facts render only when present. Keep the brief accessible after quotes arrive and throughout execution. A non-selected bidder must not see the winning quote, private address, progress attachments, or payment plan.

## Layout and controls

- One frame aligns the brand, navigation, and page content: 80% of wide screens, 24px side insets on intermediate screens, 16px on phones.
- A single primary color uses Connect orange with dark text. Neutral secondary controls, dark ink, white space, restrained faded-blue supporting surfaces, rounded panels and pill buttons are shared across routes.
- Reserve vivid orange for the main action. Selected navigation and work filters may also use orange; supporting actions use neutral colors; disabled primary actions use gray rather than faded orange.
- Find work uses a single column of readable job cards, with work-type filters to the left. Job titles lead; metadata and company identity recede. Promotional side panels are omitted.
- Posting is one continuous form alongside a live preview. Title, type, location, start, description, attachments, and optional budget/deadline stay visible. Requirements, project measurements, materials, remote/hybrid arrangement, and private site address live under one optional disclosure. Crew requests expose headcount and duration. Empty budgets mean open quotes. Save draft accepts incomplete briefs; Publish validates the full form and never exposes a half-uploaded job.
- At phone widths, the quote action stays in a compact bottom bar while reading an open job. The equivalent desktop action sits alongside the brief.
- Primary controls are at least 44px high. Forms have persistent labels; search inputs do not render a second nested border. Keyboard focus remains visible.
- Titles, paragraphs, and spacing use one hierarchy. Lists emphasize job decisions, not decorative statistics. Repeated company cards have consistent grid sizing.
- The top navigation has Jobs, My jobs, Companies, and Inbox for signed-in users. The current job section stays selected on detail screens. On phones it moves to its own row with readable labels.
- No social-feed onboarding step. Company setup ends with finding work or posting a job.

## Structured data

Migration `021_job_briefs_and_quote_breakdowns.sql` adds optional `project_type`, `system_size_kw`, `site_count`, `materials_by`, and `requirements` to jobs. Constraints reject invalid categories, negative/zero project dimensions, and oversized requirements. Existing jobs retain their data; unknown dimensions remain NULL.

Migration `022_flexible_solar_work.sql` extends work categories to crews, permits, inspections, equipment, and logistics. It adds optional `people_needed` (1–1000), `expected_duration` (120 characters), and `work_arrangement` (on site, remote, or hybrid). Jobs do not require a solar system size, site count, or project type. A remote request can be published without a site address. Budgets and quotes still mean a total agreed price; this release does not introduce hourly billing or employment contracts.

Quotes retain total price, start window, estimated duration, approach, included/excluded work, and payment terms. An optional `price_breakdown` contains at most 20 named positive amounts in integer cents. The Rust service rejects a breakdown whose sum differs from the quoted total.

A new job is saved as a draft before files upload and is published only after all pending uploads succeed. Retrying an interrupted upload reuses that draft and skips completed files.

## Files

Both job and quote forms accept multiple selections and append subsequent selections. Each file can be previewed or removed before submission. Images use thumbnails; PDFs have document cards. The viewer includes image zoom, previous/next navigation, PDF reading, and downloads.

Files are limited to 12 MiB each and PDF/JPEG/PNG/WebP. The Rust service validates file signatures and company authorization. Only the authenticated file-preview endpoint allows same-origin embedding; the rest of the application keeps its framing protection. Private quote and progress files keep their existing access rules.

## Verification

- `npm run build` and `npm test` cover compilation and the API regression suites.
- `tests/jobs-service-smoke.mjs` exercises the Rust lifecycle, structured fields, quote totals, file preview headers, and private/cross-demo access.
- `tests/marketplace-ui.mjs` must run only against a local test environment. It checks 320/390/768/1024/1440/1920px layouts plus job creation, multiple files, viewer behavior, quote submission/comparison, messages, selection and confirmation. Supply the isolated demo password through `MARKETPLACE_DEMO_PASSWORD`; do not commit it.
- Fictional examples may be refined with `ALLOW_DEMO_SEED=true node apps/api/dist/refine-marketplace-demos.js`. It only changes untouched generated demo briefs and quotes. Real profiles, edited examples, and active/completed jobs are excluded.
- `ALLOW_DEMO_SEED=true node apps/api/dist/seed-flexible-work-examples.js` idempotently adds three fictional crew, electrician, and remote-design requests to existing demo companies. It never modifies existing jobs or real company records.

## Design references

The hierarchy follows [Linear's interface refresh](https://linear.app/now/behind-the-latest-design-refresh): supporting navigation should recede behind the work. Action emphasis follows [IBM Carbon's button guidance](https://carbondesignsystem.com/components/button/usage/). The live job preview keeps the public-facing brief visible while the user writes it. These guide interaction decisions; Connect retains its own palette, rounded controls, and company workflows.

## Editorial homepage

The public homepage uses the same 80% frame, brand ink, orange action, faded blue canvas, and icon set as the product. Its sequence is deliberate: a clear hiring/finding-work introduction, a wide original work image, service discovery, an interactive three-step product walkthrough, an invitation to claim a company profile, and practical FAQs. The example quotes are labelled Example; they are not live market activity or endorsements. No fabricated reviews, customer logos, success metrics, or availability claims are used.

The art direction takes visual hierarchy and a people-led introduction from [Airzon's marketplace reference](https://dribbble.com/shots/27653963--Talent-Marketplace-Landing-Page-Minimal-Hero-Section). Original solar-work imagery and Connect's product workflows replace the reference's assets and layout details. The posting flow applies [Upwork's documented title, scope, budget, and review approach](https://support.upwork.com/hc/en-us/articles/211063408-How-to-post-a-job), adapted for company services, crews, remote work, and total-price quotes.

Image provenance, final asset paths, and generation prompts are in [marketplace-imagery.md](marketplace-imagery.md). Mobile receives a 93 KiB hero derivative; the desktop hero is about 347 KiB. The planning image loads lazily. Images reserve their dimensions, and the walkthrough never auto-advances. Keyboard focus and reduced-motion settings are respected.

## Connect editorial identity

The complete web marketplace shares `marketplace-brand.css`, informed by [K2 Systems](https://k2-systems.com/en/). White and dark ink carry the interface. Sunhub orange is used sparingly for primary actions, selected states, and thin section accents; broad information panels remain neutral. Larger titles, deliberate section spacing, consistent line icons, and generous imagery provide personality without making every detail compete.

Company profiles lead with the company identity, useful tagline, and its own cover when available. Generic built-in covers are omitted from real listings, and missing images do not create empty hero frames. Actual profile facts form a compact strip; services, project previews, credentials, and job reviews each have a clear reading order. All credentials remain accessible with their original category and source; directory listings and rankings are not relabelled certifications. Project images open an accessible dialog for a closer look. Availability, service areas, and contact information sit in a supporting column. Incomplete profiles render only available facts.

Job pages put the title and company first, with the budget and the role-appropriate next action alongside. Location, timing, duration, and team size appear in a single strip above the full brief. Quote comparison, progress, messages, and payment reporting retain the existing authorization and lifecycle. The sidebar is sized to its contents. All information remains readable without image-dependent heights.

The signed-out posting entry keeps its explanation and sign-in button together in a centered panel. Signing in returns to `/jobs/new` and opens the posting flow. Responsive browser verification includes action alignment, continuation after sign-in, project previews, and the full job-to-quote workflow.

## Demo company access

Demo companies can use the complete marketplace workflow and interact with regular managed companies: invite, quote, exchange job messages, choose and confirm a company, share files and progress, track reported payments, complete work, and leave job reviews. Demo status describes fictional company data; it does not reduce account capabilities. Company membership, owner/admin permissions, verified email, job visibility, lifecycle rules, and private document access still apply.

Public discovery excludes demo data by default. Signed-in demo companies start with demo jobs and companies, and can switch to regular listings. The invitation picker also offers the demo-company filter. Explicit filter choices survive search and clearing other filters. Demo labels and search-engine exclusion remain in place.

`tests/jobs-service-smoke.mjs` exercises the full lifecycle with a regular hirer and a demo provider, plus invitations, quotes, and messages in the reverse direction. `tests/marketplace-demo-ui.mjs` checks discovery and mixed-account actions through the browser against an isolated local test database.

## Approved job workspace layouts

The supplied posting, quote-comparison, progress, and work-review mockups guide `job-workspace.css`. Working screens use a faded blue canvas, white bordered panels, restrained line icons, compact titles, and orange primary actions. The editorial landing and company profiles retain their own content hierarchy.

Posting uses a single-page form and live preview. Files support drag-and-drop as well as repeated selection, with matching previews in the brief. Quote comparison puts the job summary in a narrow column and companies/proposals in the wide column. Each quote shows actual services, price, start, duration, and proposal. Expanded details expose scope, terms, price breakdown, and attachments. There are no fabricated match rankings, distances, or ratings; Connect job ratings aggregate completed-job reviews.

Selected work shows both companies, a status-driven progress indicator, a timeline, agreed quote and scope, private address, and documents. Completion highlights the latest final submission and its actual attachments; the checklist describes submitted files rather than asserting unverified completion milestones. Accepting or requesting changes uses the existing permission checks and lifecycle. Request update and Report a problem create durable private activity, notify the other selected company, and prevent rapid duplicate requests. A reported problem is shared with that company; this does not promise a separate arbitration or support service.

`023_job_activity.sql` extends the existing private update kinds. `GET /jobs/inbox` provides paginated, searchable job conversations scoped to the active company; each opens its own job conversation. No legacy social messages are restored. Browser tests cover the full sequence from posting through quotes, messages, update requests, reported problems, changes, final acceptance, and reviews across six viewport widths.
