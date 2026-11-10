# Connect hiring marketplace

The active web product is at `connect.sunhubapp.com`. This guide supersedes the social-feed layout guidance for web marketplace routes. Native clients and the separate `sunhubapp.com` application are outside this release.

## Decisions and information

| Screen | User decision | Information that belongs here | Main action |
| --- | --- | --- | --- |
| Public home | Get help or find work | Crews, specialist services, supplies and solar business support; simple hiring process | Post what you need / Find work |
| Find work | Can we help with this request? | Clear title, short brief, work category, location, headcount/duration when known, budget, hiring company | View job |
| Post a job | What help do we need? | Title, work category, brief, work location, optional timing and attachments; additional details on demand | Review job, then Publish job |
| Job details, before quoting | Can we deliver this scope? | Full brief, requirements, materials responsibility, documents, timing, budget, company profile | Send a quote |
| Quote form | What are we proposing? | Total price, availability, duration, approach, optional inclusions/exclusions/terms and price breakdown, multiple files | Send quote |
| Hiring company, open job | Which proposal should we choose? | Received quotes with price/schedule, full proposal and documents, company evidence, questions | Choose company, with confirmation |
| Active job | What happens next? | Current stage, progress, original brief/files, job-specific messages, agreed quote | Confirm / Share progress / Review work, according to role and stage |
| Payment plan | What has each company reported? | Agreed total, named stages, invoice reference, reported payment and receipt status | Role-specific confirmation |
| Company profile | Is this company suitable? | Services, real project examples, coverage/capacity, credentials with sources, job reviews | Invite to a job; unclaimed listings link to their website and claim flow |
| My jobs | Which work needs attention? | Posted jobs, quotes, invitations, selected active jobs, completed work | A stage-specific next action |

Do not invent a budget, project size, availability, rating, or credential to fill space. Optional facts render only when present. Keep the brief accessible after quotes arrive and throughout execution. A non-selected bidder must not see the winning quote, private address, progress attachments, or payment plan.

## Layout and controls

- One frame aligns the brand, navigation, and page content: 80% of wide screens, 24px side insets on intermediate screens, 16px on phones.
- A single primary color uses Connect orange with dark text. Neutral secondary controls, navy text, faded blue surfaces, rounded panels and pill buttons are shared across routes.
- Reserve vivid orange for the main action. Navigation, selected filters, and supporting actions use neutral colors; disabled primary actions use gray rather than faded orange.
- Find work uses one continuous list, with quiet work-type filters to the left. Job titles lead; metadata and company identity recede. Promotional side panels are omitted.
- Posting has two steps: a concise brief and a review. Optional budget, requirements, address, and project specifications remain under Add more details. The review preserves all input and files when returning to edit. It creates no published record until the user chooses Publish job.
- At phone widths, the quote action stays in a compact bottom bar while reading an open job. The equivalent desktop action sits alongside the brief.
- Primary controls are at least 44px high. Forms have persistent labels; search inputs do not render a second nested border. Keyboard focus remains visible.
- Titles, paragraphs, and spacing use one hierarchy. Lists emphasize job decisions, not decorative statistics. Repeated company cards have consistent grid sizing.
- The top navigation has Find work, Find companies, and My jobs for signed-in users. On phones it moves to its own row with readable labels.
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

The hierarchy follows [Linear's interface refresh](https://linear.app/now/behind-the-latest-design-refresh): supporting navigation should recede behind the work. Action emphasis follows [IBM Carbon's button guidance](https://carbondesignsystem.com/components/button/usage/). The review step applies the [GOV.UK check answers pattern](https://design-system.service.gov.uk/patterns/check-answers/), with editable details before the final submission. These guide interaction decisions; Connect retains its own palette, rounded controls, and company workflows.
