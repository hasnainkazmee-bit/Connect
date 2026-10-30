# Connect for Android

Native Kotlin/Jetpack Compose screens backed by a Rust client core through Mozilla UniFFI. This first Android slice talks to the existing Express/PostgreSQL API. The server has not been rewritten in Rust. Web and Android share the same accounts, company permissions, requests, connections, posts, and messages.

## Initial scope

- Native bottom navigation, sign-in/registration, company switching, and profiles.
- Feed reading, native image/video presentation, text/photo/video/PDF posts, likes, comments, and follows.
- Searchable company directory and My Network grouped by business type.
- Messages includes the directory, chats, requests, acceptance, text replies, and private photo/PDF attachments.
- Rust owns pooled HTTP, session transport, a bounded SQLite response cache, and foreground SSE. Kotlin owns platform UI, lifecycle, media playback, and Keystore-encrypted session persistence. Rust never persists the raw session token.
- Cached screens render before refresh. Message events refresh network/conversation data rather than the feed. Lists use native lazy layout with stable IDs. Video players are created on demand and released when removed.

This is an initial implementation, not a measured performance release. Background message outbox/retry, push notifications, deep links, company/profile administration, relationship blocking/disconnection controls, and Android performance benchmarks remain to be implemented. Those existing management controls are available in the web app. The existing web upload flows remain available. Request/connection changes remain restricted to company owners and administrators; authorized team members can reply in accepted conversations.

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

`NativeFlowTest` covers native sign-in, discovery, following, request acceptance, live chat, grouped connections, publishing, activity recreation, and sign-out. It refuses to run unless the app points at the isolated local test API (`http://10.0.2.2:4101`).

`ConnectionRecoveryTest` uses an on-device HTTP fixture to verify a failed connection recovers through Retry, cached content stays visible on failure, and returning to the app retries after connectivity is restored.

## Performance acceptance targets

These are targets to measure on an agreed midrange physical Android phone in a release build, not claims about current results:

- Visible response to a tap within 100 ms; network completion is a separate state.
- Cached tab restoration under 300 ms and cold cached content under one second.
- Smooth 60 fps scrolling (16.7 ms frame budget), measured with long mixed-media feeds and conversations; use the device's tighter budget on higher-refresh displays.
- Keep scroll position and drafts when changing screens. Keep displayed data while refreshing.
- Benchmark startup, feed scrolling, keyboard/open-chat transitions, uploads, reconnects, and low-memory/background behavior. Add an app-specific Baseline Profile only after measuring the critical journeys.

Rust improves control over core work; it does not remove network latency, database cost, image decoding, or rendering work. Optimize measured bottlenecks. Move server routes to Rust incrementally behind the same tested contracts once the Android client and performance baselines are established.

## Verified locally

On 2026-10-30: web/API production compilation, 44 API checks, five Rust isolation/cache checks, Rust-to-API social/media/messaging integration, Android APK compilation, and the native Android UI journey passed. Native UI verification used an ARM64 Android 16 emulator. All packaged native libraries and APK entries were checked for 16 KB alignment. These functional checks do not establish real-device release performance.
