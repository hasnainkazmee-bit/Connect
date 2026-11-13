# Project conversations

The web inbox is keyed by job and provider company. Each hiring company talks privately with each provider; employees retain their own identities. Company owners/admins control quote and agreement decisions. Team members can participate in conversations and progress updates.

## Quote and work decisions

- Quote versions are immutable. Decisions include the quote ID and reviewed version.
- A chosen company must confirm the selected version before work starts. Declining reopens the job without disclosing the previous company's private updates.
- A work review includes the completion update ID. A stale screen cannot accept a replacement submission.
- Scope changes require the other company's approval and the current agreement revision. Payment tracking does not transfer funds.
- Competing conversations become read-only after a company is chosen. Completed/cancelled conversations retain their history.

## Files and retries

Create quotes/updates with `attachmentCount`. When attachments are expected, the item remains unpublished until all files arrive and the client calls its `publish` endpoint. Publication is idempotent. Published quote/update attachments cannot change silently.

Raw uploads use a stable `uploadId` for retry deduplication. Chat attachments are staged against a message draft ID, then associated atomically when sending. Staged files are private to their uploader; sent files remain private to that job/provider conversation.

## Notifications

A shared PostgreSQL listener wakes the existing authenticated SSE streams. Payloads contain only a recipient ID; the SSE handler rechecks session access. Existing polling remains a recovery path. Message and workflow read state is recorded when the visible conversation reaches the latest item.

## Deployment order

Migrations 034–037 introduce quote snapshots, private conversation events, notification wakeups, and publication gates. **Stop the old app and Rust jobs writers before applying these migrations.** Build release images first, take a consistent Connect backup, stop writers, migrate, then start the matching app/jobs release together.

The migration runner uses one transaction. If migration fails, the old schema remains usable. After migration succeeds, do not restart an old jobs binary: it does not maintain the new quote/publication invariants. Repair forward with a compatible release, or perform an explicit backup restoration during maintenance.

The legacy `seed-marketplace.ts` and `refine-marketplace-demos.ts` scripts stop before writing once quote history is enabled. Create new demo quotes through the jobs API so versions and events remain consistent.

## Local verification

Use an isolated database with `test` in its name and a local Rust jobs service. Set `DATABASE_URL`, `JOBS_TEST_URL`, and optionally `API_TEST_URL` to the local API for real SSE delivery checks.

```sh
npm run typecheck
npm run build
cargo test -p connect-jobs
node --test tests/job-list-focus.test.mjs
node tests/project-quote-service.mjs
node tests/project-chat-service.mjs
node tests/notification-stream-service.mjs
node tests/job-inbox-service.mjs
node tests/job-contact-service.mjs
node tests/jobs-service-smoke.mjs
```

Service tests create isolated fixtures. Do not point them at production.
