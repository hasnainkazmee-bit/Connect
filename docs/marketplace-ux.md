# Connect hiring marketplace

The active web product is at `connect.sunhubapp.com`. This guide supersedes the social-feed layout guidance for web marketplace routes. Native clients and the separate `sunhubapp.com` application are outside this release.

## Decisions and information

| Screen | User decision | Information that belongs here | Main action |
| --- | --- | --- | --- |
| Public home | Hire a company or find work | Solar services, three-step hiring process, profile claiming, payment model | Find a company / Find work |
| Find work | Is this project a fit? | Scope excerpt, trade, project type/size/sites when known, location, schedule, budget, hiring company | View job |
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
- Primary controls are at least 44px high. Forms have persistent labels; search inputs do not render a second nested border. Keyboard focus remains visible.
- Titles, paragraphs, and spacing use one hierarchy. Lists emphasize job decisions, not decorative statistics. Repeated company cards have consistent grid sizing.
- The top navigation has Find work, Find companies, and My jobs for signed-in users. On phones it moves to its own row with readable labels.
- No social-feed onboarding step. Company setup ends with finding work or posting a job.

## Structured data

Migration `021_job_briefs_and_quote_breakdowns.sql` adds optional `project_type`, `system_size_kw`, `site_count`, `materials_by`, and `requirements` to jobs. Constraints reject invalid categories, negative/zero project dimensions, and oversized requirements. Existing jobs retain their data; unknown dimensions remain NULL.

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
