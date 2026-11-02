#!/bin/bash
set -euo pipefail
macos_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/connect-webkit-smoke.XXXXXX")"
fixture_pid=""
cleanup() {
  if [[ -n "$fixture_pid" ]]; then kill "$fixture_pid" 2>/dev/null || true; wait "$fixture_pid" 2>/dev/null || true; fi
  rm -rf "$test_dir"
}
trap cleanup EXIT INT TERM
node "$macos_dir/Tests/webkit-fixture.mjs" "$test_dir/origins.json" > "$test_dir/fixture.log" 2>&1 &
fixture_pid=$!
for _ in {1..100}; do
  [[ -s "$test_dir/origins.json" ]] && break
  kill -0 "$fixture_pid" 2>/dev/null || { cat "$test_dir/fixture.log"; exit 1; }
  sleep 0.1
done
[[ -s "$test_dir/origins.json" ]] || { printf 'Fixture startup timed out.\n' >&2; exit 1; }
connect_origin="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).connectOrigin)' "$test_dir/origins.json")"
sso_origin="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).ssoOrigin)' "$test_dir/origins.json")"
sources=()
for source in "$macos_dir"/Sources/*.swift; do
  [[ "$(basename "$source")" == main.swift ]] || sources+=("$source")
done
bundle="$test_dir/WebKitSmoke.app"
mkdir -p "$bundle/Contents/MacOS" "$test_dir/module-cache"
cat > "$bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>WebKitSmoke</string><key>CFBundleIdentifier</key><string>com.sunhub.connect.webkitsmoke</string><key>CFBundleName</key><string>Connect WebKit Smoke</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/><key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict>
</dict></plist>
PLIST
xcrun swiftc -sdk "$(xcrun --sdk macosx --show-sdk-path)" -target "$(uname -m)-apple-macosx13.0" \
  -D DEBUG -swift-version 6 -warnings-as-errors -module-cache-path "$test_dir/module-cache" \
  -framework AppKit -framework WebKit -framework Foundation -framework UniformTypeIdentifiers \
  "${sources[@]}" "$macos_dir/Tests/WebKitSmoke.swift" -o "$bundle/Contents/MacOS/WebKitSmoke"
/usr/bin/codesign --force --sign - --timestamp=none "$bundle" >/dev/null
printf 'Running native WebKit smoke test against %s and %s…\n' "$connect_origin" "$sso_origin"
"$bundle/Contents/MacOS/WebKitSmoke" "$connect_origin" "$sso_origin" flow
printf 'Restarting native app to verify persisted HttpOnly session…\n'
"$bundle/Contents/MacOS/WebKitSmoke" "$connect_origin" "$sso_origin" persistence
