# Colabb Network release

Network is implemented in `apps/colabb/src/network` and the Rust jobs service. The Express API streams `/api/network-v2` to that service using the existing session cookie. It does not reuse the historical Connect publishing interface or copy its posts.

## Included

- Company posts, image carousels, PDF/image previews, cropping, captions above attachments, likes, saved posts, comments and replies, mentions, editing and deletion.
- Persistent drafts with optimistic version checks and protection against leaving with unsaved work.
- Company-owned public/private communities, membership approval, roles, rules, cover images, configurable topic fields, invitation links, pinning and scoped moderation.
- Topic answers retain their original labels after a community changes its form.
- Notification preferences, focused-screen read handling and existing notification/push delivery integration.
- Sourcing discussions can create an unpublished job draft. Only explicitly selected attachments are copied to the job's independent storage.
- Fixed desktop navigation/sidebar positions, scrolling content without scrollbar chrome, three rotating company suggestions, and full-page task views.

## Deployment

1. Build and deploy both the API/frontend image and the Rust jobs image from the same reviewed commit. Preserve the existing shared upload volume; Network attachments live in its `network/` directory.
2. Apply `042_network.sql` before starting the new API or Rust image. It is additive: existing jobs, company profiles and historical Connect tables remain intact. Take the normal database/configuration backup first.
3. Preserve the existing `JOBS_SERVICE_URL`, `DATABASE_URL`, session settings, storage mount and notification worker configuration. No new provider credentials or paid service are required for Network.
4. Verify `/api/health`, `/api/ready`, the authenticated Network bootstrap, a company post and a private-community attachment using authorized test accounts. Confirm the legacy interface switch still works.
5. Configure platform moderators through the deployment operator's existing access process. `network_administrators` starts empty; a company owner is never automatically a platform administrator. Community owners can moderate their own communities without this grant.

Invitations provide a shareable, expiring link and notify an existing verified matching account in-app. Invitation email delivery is not part of this release. No community or post is automatically created in production.

Unattached uploads older than seven days are removed hourly. Files referenced by a post, community cover or saved draft are retained. Access to a published attachment is checked against its current community/post permissions on every read.

## Verification

```sh
npm run build
cargo test --locked -p connect-jobs
node --test tests/network-proxy.test.mjs tests/network-notification-routing.test.mjs
# With DATABASE_URL pointing to a migrated local database ending in _test:
node crates/jobs-service/tests/run-network-api.mjs
# The normal UI runner also exercises binary uploads through Express and Network browser flows:
npm run test:ui
```

Automated scenarios cover permissions, demo isolation, private membership revocation, invitation rotation/expiry, stale drafts, retry safety, topic validation/history, moderation, notification visibility and independent job attachment copies. Browser scenarios cover consistent layout anchors, hidden scrollbars, mobile navigation, saved posts and focused comments. Tests create only isolated local fixtures.
