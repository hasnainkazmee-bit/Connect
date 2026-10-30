#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# A phone package must work without adb or the emulator's special host address.
# Keep USB-only builds explicit instead of silently shipping localhost to phones.
: "${CONNECT_API_URL:?Set CONNECT_API_URL to the reachable HTTPS API origin for the phone build.}"
CONNECT_API_URL="${CONNECT_API_URL%/}"
export CONNECT_API_URL
node --input-type=module <<'NODE'
const value = process.env.CONNECT_API_URL;
const url = new URL(value);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(value)) {
  throw new Error('CONNECT_API_URL must be an HTTPS origin without credentials, path, query, or fragment.');
}
const response = await fetch(`${value}/api/health`, { signal: AbortSignal.timeout(15000) });
if (!response.ok || (await response.json()).status !== 'ok') throw new Error('The phone API is not healthy; no APK was packaged.');
console.log(`Verified phone API: ${value}`);
NODE
poll_events=false
if [[ "$CONNECT_API_URL" == https://*.trycloudflare.com ]]; then poll_events=true; fi
mkdir -p artifacts
./with-local-tools.sh ./gradlew assembleDebug --console=plain
cp app/build/outputs/apk/debug/app-debug.apk artifacts/connect-emulator-debug.apk
./with-local-tools.sh ./gradlew assembleDebug "-PsunhubApiUrl=$CONNECT_API_URL" "-PsunhubEventPolling=$poll_events" --console=plain
cp app/build/outputs/apk/debug/app-debug.apk artifacts/connect-phone-debug.apk
printf 'API_URL=%s\nPOLL_EVENTS=%s\n' "$CONNECT_API_URL" "$poll_events" > artifacts/phone-build.txt
shasum -a 256 artifacts/connect-*.apk > artifacts/SHA256SUMS
