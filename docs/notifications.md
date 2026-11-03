# Connect notifications

Connect keeps a per-user inbox and a PostgreSQL delivery outbox. Database triggers create both inside the same transaction as a message, request, comment, reply, reaction, follow, published post, team invitation, or explicit application release. Failed transactions cannot notify people. Reaction toggles from the same company on the same post are grouped into one notification per UTC day.

The worker runs every five seconds, claims up to 25 rows with database leases, sends at most five concurrently, and retries temporary failures with exponential backoff for up to 24 hours. Provider acknowledgements mark delivery; a crash between acknowledgement and persistence may redeliver, so clients use the notification UUID as their display tag. Invalid Web Push subscriptions (404/410) and unregistered FCM tokens are removed. Delivered jobs expire after seven days, inactive device registrations after 90 days, and inbox records after 90 days.

Current company membership, administrative permissions for requests/team events, blocks, live invitations, source visibility, session validity, unread status, and preferences are checked again before sending. Push registrations belong to the authenticated user and session. Deleting/revoking a session or resetting a password also removes its devices. A stable random installation ID identifies the device; a fresh random binding ID identifies each opt-in/account binding. Switching a binding atomically removes its old delivery queue. Both the user ID and binding ID accompany every push; clients reject delayed pushes belonging to another account even after offline logout.

## Providers

Set these only in the server environment or secret mount:

- `WEB_PUSH_PUBLIC_KEY` and `WEB_PUSH_PRIVATE_KEY`: persistent VAPID P-256 key pair. Generate once with the installed `web-push` library's `generateVAPIDKeys()`. Rotating the public key requires browsers to subscribe again.
- `WEB_PUSH_SUBJECT`: contact URL, normally `mailto:connect@sunhubapp.com`.
- `FIREBASE_SERVICE_ACCOUNT_FILE`: absolute path to a read-only Firebase service-account JSON mount with permission to send Cloud Messaging messages in the Connect Firebase project. Enable its Firebase Cloud Messaging API. Never commit this file, log its contents, or serve it to clients.

Provider readiness validates VAPID keys and loads the Firebase credential file; failures are retried after a short cache window. This confirms local configuration, not delivery to a particular device. Without the relevant configuration the inbox still works, but the server does not claim that closed-app push is available. Device requests cannot supply arbitrary delivery URLs: Web Push accepts HTTPS subscriptions only from supported Google, Mozilla, Apple, or Microsoft push domains and validates encryption keys. FCM uses high-priority **data-only** messages so Android checks the current account binding before showing anything. Notifications do not bypass OS permission, battery, or network restrictions.

Message previews default off: lock-screen notifications show “Connect” and a generic message. Opting into previews includes the stored notification title and body. Per-user categories are `messages`, `social`, `requests`, `team`, and `updates`; these settings control push, while the inbox remains available.

## API

All routes below are relative to `/api`. Only configuration is public.

- `GET /notifications/config` → `{webPush:{enabled,publicKey},fcm:{enabled}}`.
- `GET /notifications?before=<sequence>` → latest 30 `notifications`, `unread`, and `nextCursor`. Each item includes `id`, `sequence`, `type`, `category`, `title`, `text`, `url`, `company_id`, `actor_company_id`, `created_at`, and `read_at`.
- `POST /notifications/read` with `{ids:[...]}` marks only those owned records; `{}` marks the user's inbox read. Both return `{ok:true,ids:[...]}` with changed IDs for withdrawing delivered device alerts. The legacy company inbox is also marked for old clients on read-all.
- `POST /notifications/read-context` with `{kind:'company_conversation'|'personal_conversation'|'post',id}` marks related notifications after verifying access to the loaded conversation/post. Company conversations use the connection UUID. It returns `{ok:true,read,ids:[...]}`; unrelated and other-workspace records stay unread. Clients call this only while the related content is visible and focused. Inbox rows mark read after a one-second view, not merely because they were fetched.
- `GET`/`PATCH /notifications/preferences` reads/changes category booleans plus `previews`.
- `POST /notifications/devices`: `{platform:'web',installationId,bindingId,subscription:{endpoint,keys:{p256dh,auth}}}` or `{platform:'android',installationId,bindingId,token,appVersionCode,appVersionName}` → `{id}`. Registration requires verified sign-in.
- `GET /notifications/devices/:id` → `{active}` for the current user/session, exposing no endpoint or token. `DELETE` revokes an owned registration.
- `GET /notifications/events`: authenticated SSE invalidation stream for company and individual accounts; clients refetch the inbox on `changed`.

Push payloads contain `id`, `type`, `title`, `body`, `url`, `companyId`, `recipientUserId`, `bindingId`, and `createdAt`. URLs are relative internal paths. The client must validate the route and select the authorized company context before navigating; it must never trust a URL to grant company access.

## App updates and validation

`recordNotificationRelease(platform,version,title,body)` records an explicit published application version once. The first deployment creates a silent baseline. Later Android version codes notify only devices with an older/unknown installed version, and delivery is limited to the matching platform. Ordinary API restarts and web commits do not invent releases. The Android manifest must be updated only after its matching APK is available.

`tests/notifications.test.mjs` covers transactional rollback, inbox isolation, reply and reaction deduplication, company/individual messages, device transfer/logout, block and membership removal, privacy/preferences, concurrent delivery leases, retry, invalid-token pruning, invitation validity, release deduplication and retention. Its transport is injected only under `NODE_ENV=test`; no test endpoint permits production sending. `tests/run.mjs` explicitly disables live provider credentials and the timed worker for deterministic tests.

Android uses FCM for closed-app delivery (subject to OS permission, force-stop, and Google Play services). Browsers use the root notification-only service worker and do not cache application pages. Both transports were validated with isolated accounts/browser profiles and real provider delivery. The native macOS and Windows shells show OS notifications while running or minimized; fully quit delivery needs APNs/WNS registration and is not configured. Desktop App updates checks a public platform manifest, accepts only this repository's release assets, and prompts the user to download an installer; it never executes a downloaded file automatically.

Clients retain bounded account/binding-specific read and delivery IDs to suppress delayed duplicates. Visible inbox rows mark read after a one-second dwell; viewing a chat or post clears only its related authorized notifications. Confirmed reads withdraw corresponding device alerts. Lock-screen previews remain off unless the user enables them.

Provider references: [Web Push library](https://github.com/web-push-libs/web-push), [Firebase Admin sending](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk), and [FCM error handling](https://firebase.google.com/docs/cloud-messaging/error-codes).

## Browser and desktop delivery

Browser alerts require an explicit Enable notifications click. The notification-only service worker has no fetch handler or application cache, so it does not keep old web releases installed. Its stored owner contains only user/binding identifiers. Before displaying preview text it verifies the current server session; temporary connectivity failures use generic text. Logout/account changes clear subscriptions and visible alerts, and late display completion rechecks ownership.

A visible active browser conversation receives a quiet system notification (`silent:true`, no renotify), because Web Push providers such as Safari require a visible notification for accepted pushes. Native Android and desktop delivery can suppress the redundant alert for the active conversation. Confirmed reads withdraw delivered alerts and record their IDs against late delivery. The browser keeps binding-specific read/delivered identifiers for up to seven days, bounded to 5,000 entries per ledger; these contain no message content.

macOS and Windows use their native notification centers while Connect is open or minimized. They require explicit opt-in for the current account; permission requests cross an isolated native bridge only after a real click or keyboard action. Payloads carry no session tokens, native tap destinations are allowlisted, and account changes invalidate old alerts/taps. Fully quit desktop apps do **not** receive remote notifications: APNs/WNS provisioning is separate from this running-app feature. Windows bundles the pinned Windows App SDK Foundation runtime with the installer.

Account → App updates compares the desktop host's installed version with the published desktop manifest. Only validated Connect GitHub release downloads are offered; preferences control a once-per-version native alert. Web improvements continue arriving without reinstalling. Binary updates require saving work, quitting Connect, and running the new installer; there is no silent replacement of a running app.
