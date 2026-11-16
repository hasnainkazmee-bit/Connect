# Colabb web application

This is the independent Colabb frontend. `apps/web` remains the existing Connect
interface. Colabb does not import Connect styles or layouts. The approved
Colabb product studies and marketing compositions are implemented in `src/brand`;
existing authentication, authorization and business operations use the same APIs
and data as Connect.

## Visual source and boundaries

- The approved local design study is `.presentation-build/colabb-product-design`.
  Necessary source/assets are copied into this app; builds do not require that
  working directory or the large `output` archive.
- White surfaces, a very light gray canvas, Manrope, ink text and orange actions.
- Active navigation uses an orange underline. No blue filled active state.
- Logos remain SVG. Facing triangles are a brand device, never a text container.
- Public marketing, job discovery, company discovery, profiles, full-page forms,
  job review workspace and inbox have Colabb-owned styles.
- No `apps/web` imports. Reused controllers enforce existing API rules and role
  permissions; their visual styles are defined independently here.
- Existing installed Connect clients continue using the preserved interface.

## Run and build

```sh
npm ci
npm run build
npm run dev:colabb
```

The development server runs on port5180 and proxies `/api` to port4100. For a
same-origin test/release, set `CONNECT_WEB_UI=colabb` on the API and serve its
built frontend. `tools/build-colabb-marketing.mjs` renders the approved marketing
compositions for first paint and visitors without JavaScript.

## UI and backend gap closure

| UI capability | Implemented behavior |
| --- | --- |
| Saved jobs | Company-private bookmarks persisted in Postgres. Members can read; permitted company administrators manage. |
| Proposal drafts | Private versioned text, pricing and answer drafts; stale edits return a conflict and can be explicitly reloaded. Publishing clears only the draft version it replaces. |
| Find work | Real discovery filters, dates, work arrangements, sorting, saved jobs and draft collection. |
| Certification filter | Multiple selections use OR matching; company/personnel/product scope remains explicit. |
| Company identity | `On Colabb` reflects a managed company account. It does not imply independent qualification verification. |
| Company reputation | Accepted completed jobs, actual job reviews, distinct/returning hirers and earned milestones. No estimated earnings or fictional rankings. |
| General/Google reviews | Existing customer-review and authorized Google Business Profile operations remain available, separated from completed-job reviews. No synthetic Google score. |
| Job workflow | Existing proposal questions, files, revision/selection/confirmation, proof submission, changes, approval and final completion use enforced API permissions. |
| Inbox | Project-specific conversations, optional Files/Activity panels, saved composer state, attachments, reactions and unread handling. |
| Profile editing | Full-page services, coverage, credentials, licenses, projects and team operations with typed inputs and existing validation. |
| Access | Existing independent account sign-in, email verification, recovery, claiming, team invitations and Sunhub SSO protocol. |

Migration041 adds only saved-job/proposal-draft records and a nullable publication
version reference. Existing Connect data is retained and the prior release remains
compatible with the additive schema.

## Deliberate product limits

- Proposal draft text/answers persist across devices. Selected files remain local
  until sending. The form warns users to reattach on another device and guards
  navigation with unsent files; it does not pretend files have been uploaded.
- Payment stages record the companies' workflow. Colabb does not hold funds,
  provide escrow, or settle payments in this release.
- Public listings are not treated as verified managed businesses. Credentials,
  service coverage and availability retain their actual evidence/status.
- Live third-party Sunhub SSO and Google authorization were not exercised with
  production credentials during the isolated local regression suite.

## Reversible production selection

The API uses `CONNECT_WEB_UI=colabb` as its production default. The selected
frontend never changes the authenticated user or active company.

- `/_interface/connect` selects the preserved Connect frontend in that browser.
- `/_interface/colabb` returns to Colabb.
- Selection is an allowlisted HttpOnly, same-site cookie. HTML/worker responses
  vary by cookie and user agent and are not cached. Hashed assets from both
  interfaces remain available to already-open tabs.
- `ConnectMac/` and `ConnectWindows/` clients retain Connect until a dedicated
  native rebrand release.

`tools/release-colabb.py` prepares exact-SHA app/jobs images, verifies non-root
runtime access, backs up the Connect database and protected configuration on the
server, applies additive migrations, replaces only app/jobs services and checks
health plus UI/API contracts. A failure restores both previous images/configuration
without deleting additive data. The backup is local to this server.

## Validation

- Build/typecheck all three workspaces.
- `node --test tests/colabb-web-ui.test.mjs` checks interface selection, reversible
  redirects, native selection, worker cache headers and cross-interface assets.
- `node crates/jobs-service/tests/run-job-library-api.mjs` runs the isolated API
  regression suite; see that folder's README for environment setup.
- Existing Rust jobs unit tests, proposal-question tests, browser proposal draft
  and proof-review workflows remain part of verification.
- Local real-API browser checks cover account onboarding, claim/invite entry,
  profile project/license save/remove, directory/profile/editor layouts, inbox
  drafts/send/uploads and full-screen image/PDF preview at desktop/tablet/phone.
