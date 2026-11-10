# Connect deployment

The production stack is independent of the Sunhub CRM. It owns the `connect-production` Docker project, network and volumes. Only the web/API process is published, at `127.0.0.1:14100`. PostgreSQL and Garage have no published ports. The test inbox is confined to local development and is not part of this deployment.

Cloudflare public application route:

- Hostname: `connect.sunhubapp.com`
- Service: `http://127.0.0.1:14100`
- Existing server tunnel; preserve all other routes and its final catch-all.

Create `.env.production` with unique random `POSTGRES_PASSWORD`, `AUTH_TOKEN_SECRET`, `GARAGE_RPC_SECRET`, `S3_ACCESS_KEY_ID` (Garage format: `GK` plus 32 hex characters), and `S3_SECRET_ACCESS_KEY`. Do not copy local development secrets. Set `CONNECT_RELEASE` to the exact Git commit SHA.

```sh
docker compose --env-file .env.production -f compose.production.yaml up -d --build
curl --fail http://127.0.0.1:14100/api/ready
```

The Docker image runs migrations before accepting traffic. Existing local-disk attachments remain readable after switching new uploads to Garage. New files carry SHA-256 metadata; private chat files are always authorized by the API and never exposed as public bucket URLs. Default company storage quota is 5 GiB. Photo/PDF chat uploads allow up to three files of 10 MiB each; feed video uploads allow 100 MiB. S3 supports byte-range playback.

## Hiring jobs

The web app routes `/api/jobs` through the Connect API to a separate Rust service on the private Docker network. The Rust service has no published host port. It uses the same PostgreSQL database for authenticated company membership, jobs, quotes, updates, messages, payment-stage records, and reviews. Migration `019_jobs.sql` runs in the app container before the app accepts traffic. Job photos and PDFs use the existing `attachments` volume, mounted in both app and jobs containers; both run as UID 1000. Backups stop both writers before snapshotting that volume.

Jobs can be drafted, published, quoted, awarded, confirmed, updated, reviewed, and completed. Payment stages record invoice and payment confirmations between companies; Connect does not collect or hold funds. Job addresses, quotes, and attached files remain limited to the relevant companies. Check `docker compose --env-file .env.production -f compose.production.yaml ps app jobs db` and `curl --fail http://127.0.0.1:14100/api/jobs` after a release.

## Account email

Chats are stored in PostgreSQL and delivered in-app. SMTP is exclusively for verification and password recovery. The local Docker mail container captures test messages; **it does not deliver to people's email accounts**. Production requires a real SMTP sender in `.env.production`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_REQUIRE_TLS=true`, and a verified `MAIL_FROM`. Port 465 also needs `SMTP_SECURE=true`. Restart only `app` to apply settings. Verification is enforced; do not disable it to work around missing delivery. Codes expire after ten minutes and five incorrect attempts. Outbox payloads are encrypted with a key derived from `AUTH_TOKEN_SECRET` and erased after sending or expiry.

No production data or accounts are seeded automatically. `npm run seed` is a development-only fixture command; it is not part of the deployment startup.

## Public company directory

After deploying the directory migration and assets, explicitly import the curated listings:

```sh
docker compose --env-file .env.production -f compose.production.yaml exec -T app node apps/api/dist/import-directory.js
```

This creates 12 unclaimed listings, never users or demo content. Existing profiles are preserved. Companies that join normally already appear in the same directory. Source records and the operator-only manual-claim review commands are documented in [DIRECTORY.md](DIRECTORY.md). Monitor pending claims regularly; no automatic email or external notification is sent to the operator. Real SMTP delivery must work for new claimants to verify their email.

## Backups and recovery

Run `tools/backup-production.sh` from the deployed release. It briefly stops only Connect's app and Garage, dumps PostgreSQL, snapshots the stopped object store and legacy attachment volume, checks archive readability, creates checksums, and restarts Connect even if a backup fails. Backups are private in `.backups/`. Protect a separate copy of `.env.production`; its keys are required to restore encrypted pending email and Garage configuration. Keep backup access as restricted as database access.

A same-server backup does not survive loss of that server. Configure an encrypted off-host backup destination before relying on this service for business-critical records. No off-host transfer is configured automatically.

Restore into a separate Docker project first. Load `database.dump` into a new PostgreSQL 16 database with `pg_restore --exit-on-error --no-owner`; restore each tar archive into an empty, stopped matching volume. Verify migrations, row counts, file checksums, private access, and `/api/ready` before switching traffic. Do not restore over a running service.

## Operational limits

This initial deployment uses one API process and a single-node Garage store. The event stream is in-process; multiple API replicas require a shared event bus. Native Android keeps a private local cache, encrypted session cookies, and retries foreground loading. Quick preview tunnels use polling; named Cloudflare routes support the normal event stream. This is a tested initial deployment, not a claim of high availability or a completed independent security audit.

A failing `/api/ready`, unsent email outbox rows, exhausted `storage_deletions` retries, and failed backups require operator attention. SMTP readiness is separate from DB/object readiness. Never expose Mailpit, Docker, database ports, `.env` files or server credentials publicly.
