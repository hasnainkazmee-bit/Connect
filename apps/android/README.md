# Connect for Android

Native Kotlin/Jetpack Compose screens backed by a Rust client core through Mozilla UniFFI. This first Android slice talks to the existing Express/PostgreSQL API. The server has not been rewritten in Rust. Web and Android share the same accounts, company permissions, requests, connections, posts, and messages.

## Initial scope

- Native bottom navigation with horizontal paging, preserved tab state, sign-in/registration, company switching, and profiles.
- Company news feed that starts directly with posts. The floating plus button opens a Post by default, with caption above a separate square attachment frame and an explicit Press release option for rich inline writing. Publish is a direct action. Shared drafts live in the account menu. Previews, compact emoji reactions, threaded replies, and follows remain available. Existing articles/case studies remain readable and editable as Company updates.
- Company editing, branding uploads, portfolio, achievements, customer reviews, and employee invitations with readable welcome links.
- Individual accounts and consent-based personal conversations, without company-team membership.
- In-app update notices with checksum, package, version, and signing-certificate checks before the Android installer opens.
- Searchable company directory and My Network grouped by business type.
- Messages includes the directory, chats, requests, acceptance, text replies, and private photo/PDF attachments.
- Rust owns pooled HTTP, session transport, a bounded SQLite response cache, and foreground SSE. Kotlin owns platform UI, lifecycle, media playback, and Keystore-encrypted session persistence. Rust never persists the raw session token.
- Cached screens render before refresh. Message events refresh network/conversation data rather than the feed. Lists use native lazy layout with stable IDs. Video players are created on demand and released when removed.

This is an initial implementation, not a measured performance release. Background message outbox/retry, relationship blocking/disconnection controls, and broad Android performance benchmarks remain to be implemented. Firebase push and allowlisted notification destinations are implemented. Those existing management controls are available in the web app. The existing web upload flows remain available. Request/connection changes remain restricted to company owners and administrators; authorized team members can reply in accepted conversations.

## Build

Use JDK 17+, Android SDK platform 36, Build Tools 36.0.0, NDK 28.2.13676358, and Gradle 9.1.0. Google requires acceptance of the [Android SDK license](https://developer.android.com/studio/terms) before SDK use.

The project-local tool installation (when present under `.toolchains/`) can be used without changing system settings:

```sh
apps/android/with-local-tools.sh ./build-rust.sh
apps/android/with-local-tools.sh ./gradlew assembleDebug
```

For an existing Android Studio setup, after accepting the SDK license and installing these packages through Android Studio or `sdkmanager`:

```sh
rustup target add aarch64-linux-android x86_64-linux-android
export ANDROID_HOME=/absolute/path/to/android-sdk
cd apps/android
./build-rust.sh
./gradlew assembleDebug
```

The debug app uses `http://10.0.2.2:4100`, Android Emulator's address for the host's local API. Start the existing local database and API with the root README's commands. For a USB-connected phone, run `adb reverse tcp:4100 tcp:4100` and build with `-PsunhubApiUrl=http://127.0.0.1:4100`. Production builds require a real HTTPS API URL through `-PsunhubApiUrl=...`; the default release URL deliberately has no service. Cleartext HTTP is restricted to local debug development.

APK path: `app/build/outputs/apk/debug/app-debug.apk`.

`apps/android/package-debug.sh` builds two installable development packages under `apps/android/artifacts/`: `connect-emulator-debug.apk` for the emulator's host address, and `connect-phone-debug.apk` for phones using a reachable HTTPS backend. The phone build requires an explicit endpoint and verifies its health before packaging:

```sh
CONNECT_API_URL=https://your-connect-api.example apps/android/package-debug.sh
```

Replace the example with the actual backend origin. The resulting phone APK works across Wi-Fi and mobile data while that endpoint is available. `artifacts/phone-build.txt` records the packaged origin and event transport. The script never silently uses `127.0.0.1` for a phone package: on a phone, that address refers to the phone itself.

For a deliberately USB-only development build, enable USB debugging, connect the phone, and run:

```sh
apps/android/with-local-tools.sh adb reverse tcp:4100 tcp:4100
apps/android/with-local-tools.sh ./gradlew assembleDebug -PsunhubApiUrl=http://127.0.0.1:4100
apps/android/with-local-tools.sh adb install -r app/build/outputs/apk/debug/app-debug.apk
```

For temporary cross-network testing, a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) can expose the running development API through HTTPS. Starting that tunnel publicly exposes the application and requires approval. The computer, API, and tunnel must stay running; the URL changes when the tunnel restarts. This is not permanent hosting. Quick Tunnels do not support SSE, so packaging a `trycloudflare.com` endpoint enables foreground polling every five seconds for connection requests and messages. Normal builds retain SSE. No certificate checks or HTTPS requirements are disabled.

The app supports ARM64 devices/emulators and x86_64 emulators. These are debug-signed development packages, not release builds published to Google Play. Version 0.1.1 also adds an offline Retry action and retries when returning to the app after a connection failure.

Generated Kotlin bindings are checked in for inspection and regenerated by `build-rust.sh`. ABI libraries and build outputs are ignored. Keep the generated bridge and the Rust library from the same build.

## Verification

From the repository root:

```sh
cargo test -p sunhub-mobile-core --test core
npm run build
npm run test:android-core
npm run test:android # requires the ARM64 emulator to be running
ANDROID_EVENT_POLLING=true npm run test:android # also validates the preview polling transport
```

The integration test uses the existing isolated `_test` database and a separate API process. It runs the Rust client through registration, directory discovery, message request, acceptance, chat, private attachment upload/download, photo/video publishing, follows, cached reads, and logout.

With the project-local SDK, a matching emulator can be started with:

```sh
apps/android/with-local-tools.sh emulator -avd Sunhub_API_36
```

`test:android` uses a test-only API URL, so run `apps/android/with-local-tools.sh ./gradlew assembleDebug` afterward to restore the development APK's port 4100.

`NativeFlowTest` covers native sign-in, discovery, following, request acceptance, live chat, grouped connections, publishing, activity recreation, and sign-out. It refuses to run unless the app points at the isolated local test API (`http://10.0.2.2:4101`, or port 4102 for a parallel isolated Android test database). It also verifies phone navigation, a 720 dp tablet feed column, and 1.3× system text scaling; display settings are restored afterward.

`ConnectionRecoveryTest` uses an on-device HTTP fixture to verify a failed connection recovers through Retry, cached content stays visible on failure, and returning to the app retries after connectivity is restored.

## Performance acceptance targets

The native layout uses available window width, including split-screen: phone navigation stays at the bottom with swipe paging; windows at least 840 dp wide use a navigation rail. Feed content is centered and bounded to 720 dp, account forms to 520 dp, and workspaces to 840 dp. Primary and secondary actions share a 48 dp minimum target and full capsule corners; primary actions use the original #ff6b0b solar orange with dark ink text. Cards, multiline editors and dialogs use 24 dp corners. System font scaling is preserved.

Post is the default, with a simple Post / Press release switch and a direct Publish action. Posts allow up to four photos, or one video or PDF; their caption stays above a separate square media gallery. Each image, video, or document fits inside the same 1:1 window in the composer, feed, profile, and post detail, without cropping. Press releases allow up to 20 attachments and keep rich inline photos in their original writing positions; compact feed previews use the same square gallery. Legacy inline posts retain all text and formatting while their photos move into the separate gallery. Switching formats preserves writing and attachments, and image descriptions remain available through attachment controls. There is no required image dimension.

Photo selection opens a native adjustment screen before upload. Post photos offer Original, 4:5, or 1:1; company logos use 1:1, and covers start at 4:5 with a square alternative. Drag, pinch, zoom, and reset use the same crop geometry as the exported file. Crops preserve PNG transparency and cap the longest edge at 2048px. Canceling a pending batch retains existing writing and attachments; accepting displays the final crop in the Post media frame or at the Press release writing cursor.

The first nonempty writing line supplies a press release's headline at publication; the complete document is retained. A failed save leaves the writing and attachments intact. Tapping the selected Home navigation item refreshes the feed without adding another toolbar above the posts.

These are targets to measure on an agreed midrange physical Android phone in a release build, not claims about current results:

- Visible response to a tap within 100 ms; network completion is a separate state.
- Cached tab restoration under 300 ms and cold cached content under one second.
- Smooth 60 fps scrolling (16.7 ms frame budget), measured with long mixed-media feeds and conversations; use the device's tighter budget on higher-refresh displays.
- Keep scroll position and drafts when changing screens. Keep displayed data while refreshing.
- Benchmark startup, feed scrolling, keyboard/open-chat transitions, uploads, reconnects, and low-memory/background behavior. Add an app-specific Baseline Profile only after measuring the critical journeys.

Rust improves control over core work; it does not remove network latency, database cost, image decoding, or rendering work. Optimize measured bottlenecks. Move server routes to Rust incrementally behind the same tested contracts once the Android client and performance baselines are established.

## Verified locally

On 2026-10-30: web/API production compilation, 44 API checks, five Rust isolation/cache checks, Rust-to-API social/media/messaging integration, Android APK compilation, and the native Android UI journey passed. Native UI verification used an ARM64 Android 16 emulator. All packaged native libraries and APK entries were checked for 16 KB alignment. These functional checks do not establish real-device release performance.

On 2026-11-02: Android 0.4.0 compiled and both native instrumentation scenarios passed against an isolated local API/database. Checks covered publishing a Post and Press release, shared drafts and preview, sign-in/session recreation, connection requests/chat, profile editing/invitations, 48 dp primary actions, phone bottom navigation, tablet navigation rail with an exact 720 dp feed, and 1.3× Compose font scaling. The emulator returned to its original display settings. These remain functional emulator checks, not physical-device performance measurements.

On 2026-11-02, the 0.5.0 update passed the integrated native editor, navigation, recovery, publishing and interaction journeys against an isolated API/database. The new reaction/comment scenario covers emoji search and chip toggling, company attribution, replies to replies, deleted-parent preservation, drafts surviving sheet dismissal, and failed-send recovery. Web/API validation additionally covers reply pagination, blocking, legacy Celebrate compatibility, and delayed mutation responses.

The 0.5.1 update validated 24 native checks across the full run and focused reruns after fixes. A real picker callback exercises canceled-crop cleanup, a 4:5 export, HTTP upload, an actual loaded editor bitmap, and screenshot pixels before and after publication. Crop checks cover bounds, panning, PNG alpha, 2048px output, and EXIF orientation. Publishing now waits for the published post ID in the composed feed before positioning it, avoiding stable-key anchoring on an older card.

On 2026-11-02, the 0.5.1 changes passed all 24 native scenarios across the integrated run and focused publishing rerun. Coverage includes continuous-document preservation, five crop/export/EXIF checks, and a real file-picker → cancel → crop → HTTP upload → visible editor photo → published feed journey. The photo test checks drawable dimensions and screenshot pixels, not only saved JSON. Publishing now positions the new post after its ID enters the composed feed, preventing stable-key scroll anchoring from hiding it. These are emulator functional checks; physical-device performance is not benchmarked by this suite.

Sunhub sign-in is an optional secondary path below the existing Connect email/password form. `GET /api/auth/sunhub/config` controls visibility; unavailable or disabled configuration leaves the Connect form working. Sign-up remains available locally and through the Sunhub browser flow, with the selected company/individual account type passed to the broker.

The native app opens the Connect broker in the system browser and retains a random PKCE verifier and state encrypted with Android Keystore. The broker receives only the S256 challenge. Its exact callback is `com.sunhub.community.debug://auth/sunhub` for the current debug package, or `com.sunhub.community://auth/sunhub` for a release package. A matching, unexpired callback supplies a one-use handoff code; the app exchanges `{code, verifier}` at `/api/auth/sunhub/mobile/exchange` and persists the returned Connect session using the existing encrypted store. OIDC tokens never travel in the callback URL. Duplicate/foreign callbacks, state mismatch, expired attempts and unknown parameters are rejected. Existing-email conflicts guide users to link Sunhub through Connect account settings on the web first. The external-browser/PKCE design follows [RFC8252](https://www.rfc-editor.org/rfc/rfc8252), with Android intent handling documented in [Android deep links](https://developer.android.com/training/app-links/create-deeplinks).

On 2026-11-02, eight focused native SSO scenarios passed against a local broker fixture, covering PKCE vectors, encrypted pending-state restoration, callback validation/replay protection, cancellation/expiry, config visibility, primary Connect login placement, browser handoff, session persistence, and cold-return account-linking guidance. Six Rust transport checks passed, including adoption of the handoff cookie and deletion of the previous identity's cache. The existing native account/publishing/chat journey, floating navigation, and connection recovery checks also passed against the isolated API. The production-origin 0.5.2/code9 APK retains the existing package and signing certificate, with 16 KB APK and native-library alignment verified. Live Sunhub identity-provider deployment is validated separately from these local broker tests.

The 0.5.3 update passed 32 native checks across the integrated run and focused reruns. Checks cover direct Post/Press release publishing, rich caption normalization and exact unchanged format round-trips, preservation of legacy photo captions, attachment deletion without image resurrection, ordered mixed-media galleries, square image/video/PDF previews, and deletion of a selected last gallery page. A real crop/upload journey verifies the photo bitmap and square frame both before and after publishing. The full journey also checks account persistence, chat, requests, reactions/replies, phone navigation, tablet layout, and text scaling. These are emulator checks, not physical-device performance measurements.

## Push notifications

Android uses Firebase Cloud Messaging data messages, including when the app process is closed. The native notification inbox and preferences are available from the bell; enabling device notifications requests Android 13+ permission at that point. Messages, company activity, and app updates have separate Android channels. Message previews are off by default, and lock-screen public content is generic.

`app/google-services.json` contains the public Firebase registration for `com.sunhub.community.debug`. The build reads the matching package and initializes Firebase programmatically; no service-account key is packaged. A different public client file can be supplied with `-PsunhubFirebaseConfig=/absolute/path/google-services.json`. The four `sunhubFirebaseAppId`, `sunhubFirebaseApiKey`, `sunhubFirebaseProjectId`, and `sunhubFirebaseSenderId` Gradle properties can also supply public values. Missing configuration produces a working app with an explicit unavailable-push state. Server credentials remain on the API host.

Visible inbox rows become read after one second in the foreground; scrolling past a row or leaving it offscreen does not clear it. Opening a conversation, post, or comments also marks its authorized notification context read. Confirmed reads clear corresponding system-tray alerts, reject late duplicate deliveries, and update older paginated rows without waiting for them to reappear on the first page.

The authenticated API registers an installation ID, a fresh account binding ID, and the current FCM token. FCM sends data-only payloads containing the recipient and binding; Android validates both before displaying anything. Logging out clears the binding, queued registration work, and visible notifications immediately. Token refresh registration is serialized and cannot restore a device after logout or account replacement. Taps accept only known same-origin company/chat/post/invitation/update routes; immutable PendingIntents contain no session cookie or access token. An active conversation suppresses duplicate system notifications only while actually visible. Notification inbox changes use a foreground-only authenticated event stream; there is no background polling service.

`ComposerStartupTest` blocks all API responses and verifies that Create opens the usable writing field within 1.5 seconds without creating an empty server draft. This is a regression bound on a local emulator, not a device performance benchmark.

`PushNotificationsTest` checks route validation, binding isolation, token rotation, late registration, foreground visibility, private channels, replay handling, and logout cleanup. `NotificationFlowTest` exercises live inbox invalidation, persisted preferences, comment navigation, company-chat links, and session cleanup through the real isolated API. `FcmDeviceProbeTest` is an opt-in provider check (`liveFirebase=true`): it creates a unique local-test account and device, then writes a private probe payload for a single real FCM send after backgrounding and terminating the app process. It must never target production users.

Writing uses a 1.15 line-height multiplier with no fixed extra pixels between lines. Rendered document blocks use a 6 dp gap; explicit blank paragraphs remain intact.
