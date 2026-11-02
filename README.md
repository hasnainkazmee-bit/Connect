# Connect

A custom full-stack directory and social network for solar companies. Visitors find businesses by service and coverage; signed-in members publish, follow and message through the same company profiles.

## Run locally

Requires Node.js 22 or newer and Docker Compose.

```sh
npm ci
cp .env.example .env
docker compose up -d db
npm run migrate
npm run seed
npm run dev
```

Open **http://localhost:5173**. The API runs on port 4100 and PostgreSQL on localhost:5438. Vite proxies `/api` to the API, including the live event stream.

The seed is optional, idempotent, and intended for local development. All seeded companies, people, projects, and account credentials are demonstration data.

To add the curated real-world directory instead, run `npm run build` and `npm run directory:import`. This explicitly adds 12 sourced, unclaimed company listings and creates no accounts, reviews or posts. Repeating the import preserves existing profiles. See [directory sources and ownership operations](infra/DIRECTORY.md).

| Company            | Email                  | Password       |
| ------------------ | ---------------------- | -------------- |
| Brightfield Energy | amina@brightfield.test | SunhubDemo123! |
| HelioWorks Solar   | maya@helioworks.test   | SunhubDemo123! |

Use separate browser profiles or a private window for the second company. Sign in as Brightfield, find HelioWorks, and send a connection request. Sign in as HelioWorks in the other window, open the notification bell → Connection requests and accept it, and message Brightfield. Both company inboxes update live.

You can also start directly in Messages: select HelioWorks from All companies and write a message request. HelioWorks can open the Requests tab, read the message, and choose Accept & connect. Acceptance connects both companies and preserves the first message in the shared conversation.

## Android

The native Android app uses Kotlin/Jetpack Compose and a shared Rust client core. It connects to the same API and database as the web app. See [Android setup and scope](apps/android/README.md) for the APK build, local emulator/phone setup, and verification commands. The existing server remains Express/PostgreSQL.

## Run the packaged stack

Stop `npm run dev` first so port 4100 is free.

```sh
APP_ORIGIN=http://localhost:4100 docker compose up -d --build
```

Open **http://localhost:4100**. The container applies migrations before serving the compiled React app and API. Database and attachment volumes persist across container restarts. The container does not automatically create demo users. Existing local seed records remain available because both modes use the same database volume. Development attachments in `uploads/` and container attachments in the Docker volume are separate stores.

The Compose defaults are for local use. Set your own database password, exact public `APP_ORIGIN`, HTTPS reverse proxy, and backups before deployment. If the explicit development subnet conflicts with another local network, set `COMMUNITY_SUBNET` to an unused private subnet. `docker compose down` stops services and preserves data; adding `-v` deletes data volumes.

## Implemented

- A public discovery homepage at `/` for visitors and a social feed at the same address after sign-in. The directory remains available at `/directory`.
- Public text posts, photo galleries, playable MP4/WebM video, and PDF attachments. Up to four JPG/PNG/WebP photos (10 MB each), one video (100 MB), or one PDF (20 MB) per post.
- Upload previews, image descriptions, real upload progress, saved text drafts, and administrator post deletion.
- Photo adjustment on web and Android: drag, zoom, and crop logos, covers, and post images, with matching editor and published framing.
- Company follows, an All posts feed, a Following feed, and company Updates tabs. Follows are unilateral; they do not create connections or unlock messaging.
- Persistent company likes and attributed comments, comment removal, shareable post URLs, and stable feed pagination.

- Public directory with company, service, audience and service-area filters; curated city landing pages; public HTML, canonical URLs and a sitemap. Location searches use service coverage, separately from the company's office. City/state search is supported; ZIP-radius search is not.
- Unclaimed listings with official website/phone contacts and a company claim flow. Verified company-domain emails can claim the existing profile; other requests require an operator review. Claiming preserves the URL, reviews and followers. Imported listings cannot receive unattended Connect message requests.
- New company signup checks for existing listings. Creating or editing a managed company updates its public directory profile directly, without a second listing or synchronization job.
- Company profiles with services, projects, team, and editable company details.
- Registration, password sign-in, persisted sessions, and company switching.
- My Network shows accepted connections grouped by business type, with live counts, type filters, and search. Requests are accessible from notifications; blocked companies are in company settings.
- Company-owned relationships: send, accept, decline, or withdraw a request; disconnect, block, and unblock.
- A shared inbox with individual author attribution, live updates, unread counts, retained history, and earlier-message pagination.
- Messages includes the full company directory with search and pagination, plus Chats and Requests tabs. Owners and administrators can send a text message request (up to 2,000 characters) before connecting. Acceptance atomically creates or restores the connection and saves the original message once; pending, declined, and withdrawn requests do not enable replies. Blocking cancels pending requests.
- Private JPG, PNG, WebP, and PDF attachments, up to three files of 10 MB per message.
- Owner, administrator, and member permissions. Owners and administrators manage profiles and connections; members participate in conversations.
- Readable company welcome links at `/join/company-username`. Each invitation is bound to a verified work email, expires after three days, can be revoked, and can only be accepted once. The administrator copies the link; creating an invitation does not send an email.

An accepted connection enables messaging for authorized teammates at both companies. Disconnecting or blocking prevents new messages and retains history. Unblocking does not reconnect automatically. Reconnecting reuses the same conversation. Removing a teammate revokes future access while preserving their attributed messages.

### Social behavior

Owners and administrators publish, delete posts, and manage company follows. All authorized members can like and comment as their company; comments record the individual author. Administrators may remove comments on their company’s posts, and members may remove their own comments. Posts and media are public. Blocking removes follows in both directions and hides each company’s posts for the signed-in blocked company; it does not turn public posts into private content. Unblocking does not restore follows.

The feeds are chronological and use exact sequence cursors. Following includes the company’s own posts. Three demo posts are added by the optional seed and are labeled Demo; their photography is illustrative. Public social uploads are stored under `UPLOAD_DIR/posts`, separate from private conversation attachments. Video uploads stream to disk, and the media endpoint supports byte-range playback. Videos play on demand and are not transcoded; use browser-compatible MP4 or WebM. Feed refresh is manual; company conversations continue to update live.

## Architecture

```text
apps/android/             Native Kotlin/Jetpack Compose Android app
crates/mobile-core/       Rust networking, cache, uploads and event stream
apps/web/                 React + TypeScript + Vite; responsive UI
apps/api/src/             Express + TypeScript; authorization and business rules
apps/api/migrations/      Versioned PostgreSQL migrations
tests/api.test.mjs        HTTP integration tests against an isolated database
tests/browser/            Playwright tests with separate company sessions
compose.yaml             PostgreSQL and packaged application
```

PostgreSQL is the source of truth for accounts, memberships, sessions, profiles, requests, relationships, messages, notifications, invitations, posts, follows, likes, and comments. Browser storage only holds unsent drafts. Upload bytes live in the configured attachment directory; metadata and authorization live in PostgreSQL.

Authentication uses salted scrypt password hashes and random, hashed session tokens in HttpOnly, SameSite cookies. HTTPS origins enable secure cookies. Mutations check the configured origin and apply rate limits. Authorization derives the acting company and person from the server-side session. Connection changes and message sends serialize per company pair to enforce relationship rules under concurrent requests. Message sequences provide exact pagination and read boundaries.

Live updates use server-sent events that invalidate API data; the event payload contains no conversation content. The event registry and rate limiter are currently in-process, so this version is intended for one API instance. Multiple instances would need shared pub/sub and shared rate limiting. The UI reconnects the event stream automatically.

## Verification

With the local database running:

```sh
npm run build
npm test
npm run test:ui
```

`test:ui` runs the API suites and browser flows for company connections, directory message requests, network business-type counts, and social publishing/following with real photo and video fixtures. Tests use a separate `sunhub_community_test` database on port 5438, an isolated API on port 4101, and temporary attachment storage. Set `TEST_DATABASE_URL` for another database; its name must end in `_test`. Tests create their own data and never clear the development database. API suites restart the isolated server between runs to keep rate-limit windows independent. The browser suite uses an installed Google Chrome via Playwright's `chrome` channel.

## Current scope

The app covers social posts → follows → company discovery → connections → shared messaging. Audio Spaces, Sunhub SSO, marketplace links, and sales portal integration remain outside the current release.

Email verification and recovery are implemented. Curated listing claims require a verified email on an operator-sourced company domain or an operator-approved manual claim. New company registration still records the registrant as owner without independently verifying their business authority. Account ownership is separate from contractor licensing or credential verification. A complete moderation workflow and operational monitoring remain deployment considerations. Company logos, covers, and portfolio photos support uploads; demo photos remain illustrative. Attachment signatures are validated, but malware scanning is not implemented.

Stock-photo credits are available in the app: solar photography by Siwawut Phoophinyo on Unsplash, and office photography by Jakub Zerdzicki on Pexels. Illustrative company data is separate from any existing Sunhub production system.

## Account onboarding, private chat, and storage

Connect now includes dedicated web and native Android welcome/sign-in/recovery screens, email-code verification, company setup, optional company follows, password changes and revocable device sessions. Company conversations support private photo/PDF previews, timestamps, read receipts, saved drafts, and idempotent message sends. Accepting a message request establishes the company connection and carries the first message into the conversation.

Start the open-source local services with `node tools/setup-local.mjs`, then `npm run migrate` and `npm run dev`. PostgreSQL stores application data, Garage stores new attachments through its S3 API, and [Mailpit](http://localhost:8026) captures account verification/reset emails. Mailpit does not send real email. Existing disk attachments continue to work. The API uses versioned scrypt password hashes, database-backed account throttles, one-time bounded verification challenges, secure production cookies, company-role authorization, storage quotas and queued object cleanup.

Validation: `npm run build`, `npm test`, `node tests/run.mjs --services --ui --rust`, and `npm run test:android` with the emulator running. The services suite additionally tests real SMTP delivery, private S3 upload/download, byte ranges, retry deduplication, read receipts, and browser onboarding/recovery at desktop and phone sizes.

Server setup and backup instructions: [infra/DEPLOYMENT.md](infra/DEPLOYMENT.md). The API remains TypeScript/Express; the native Android HTTP, caching and session transport core is Rust. Both clients use the same API and database.

## Publishing and company workspaces

Companies write in one continuous canvas, then choose Update or Press release at publish time. The first writing line supplies the press-release headline; the full document, formatting, and image positions remain intact. Existing titles/subtitles are preserved in the writing canvas, and older articles and case studies remain readable as company updates. The editor supports headings, lists, quotes, links, inline images, video and PDF attachments, image descriptions, drafts, and previews. Drafts and their files stay private to authorized company members; optimistic versions prevent one editor from overwriting another editor’s changes. Publishing and profile management require an owner or administrator.

Company profiles use `/company-username` on the app origin. Usernames are lowercase, unique, reserve application routes, and cannot reuse another company’s previous address. Previous usernames and `/company/...` links continue to resolve. Signup suggests a readable name; profile editing can claim another available username. Profiles include company facts, portfolio projects, achievements, people, customer ratings, and reviews.

Company employees have their own company-account login, with owner, administrator, or inbox-member permissions. `/join/company-username` is a public welcome page, not an access token: acceptance checks the signed-in verified email against a live invitation, locks and consumes it atomically, and completes onboarding. Anonymous visitors cannot see invited email addresses or employee permissions. Previous secret invitation URLs remain supported.

Individual accounts can follow companies, leave customer reviews, and start message requests with companies. They cannot publish, create company profiles, or join company teams. The People inbox keeps these conversations separate from company-to-company connections. Accepting an individual’s message request opens that conversation without creating a company connection. Employees of a company cannot review their own company.

Android uses a floating capsule navigation with a central Create action. Phone layouts use bottom navigation. Horizontal swipes move between main tabs; editing, chat details, and horizontal content keep their own gestures. Android keeps tab scroll state and uses native Compose paging. Web builds check for a newer server release and offer a refresh. Android checks the release manifest, downloads only from the project’s GitHub releases, verifies the checksum, package, version, and signing certificate, and asks Android to confirm installation. Native changes require an APK update; API and web changes do not.

### Optional Sign in with Sunhub

Connect keeps its own email/password registration, verification and sign-in. Setting `SUNHUB_SSO_ISSUER=https://accounts.sunhubapp.com` and `SUNHUB_SSO_CLIENT_ID=sunhub-connect` adds a second sign-in option for a Sunhub account with any email address. The Sunhub identity service is deployed separately from its private repository. Register the exact callback `https://connect.sunhubapp.com/api/auth/sunhub/callback` there.

On the web, Sunhub authentication opens a compact popup while Connect stays in place. The callback sets the usual HttpOnly session cookie and sends only a completion signal through an origin-checked message and a random per-attempt browser channel. Connect then reads its session from the API; no identity or session tokens pass between windows. Popup cancellation and blocked windows leave the Connect form available.

The backend uses authorization code + S256 PKCE, browser-bound one-use state, nonce, issuer/audience/expiry checks and EdDSA signature verification. Only a verified email is accepted. Connect permissions and company memberships stay local. An email match never silently links an existing Connect account: its owner signs into Connect and chooses **Link Sunhub account** in Account settings. New identities enter the existing company/individual onboarding. No SSO tokens are stored in browser storage.

Android opens the system browser and returns through an exact package-specific callback. A short-lived one-use code, bound to a separate native PKCE verifier, is exchanged for the usual Connect session. Identity tokens and session cookies never appear in the app return URL. To disable the extra option without disrupting Connect login, remove `SUNHUB_SSO_ISSUER` and redeploy.

`tests/sunhub-sso.test.mjs` exercises signed identity tokens, rejected nonces/audiences/signatures, unverified mailboxes, explicit linking, replay/expiry, return destinations and Android handoffs against an isolated local mock issuer. Browser and native tests cover the retained Connect form and optional Sunhub controls.
