#!/bin/bash
set -euo pipefail

# Build a signed app bundle using the macOS Command Line Tools only.
macos_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$macos_dir/../.." && pwd)"
build_dir="$macos_dir/.build"
artifacts_dir="$macos_dir/artifacts"
architecture=universal

usage() {
  cat <<'USAGE'
Usage: apps/macos/build.sh [--arch universal|arm64|x86_64]

Build Connect.app for macOS 13 or later. Universal is the default.
SIGNING_IDENTITY may name a Developer ID Application certificate already in
Keychain. If unset, the app is ad-hoc signed for local testing only.
USAGE
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; architecture="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
case "$architecture" in
  universal) architectures=(arm64 x86_64) ;;
  arm64|x86_64) architectures=("$architecture") ;;
  *) printf 'Unsupported architecture: %s\n' "$architecture" >&2; exit 2 ;;
esac
[[ "$(uname -s)" == Darwin ]] || { printf 'A Mac with Apple Command Line Tools is required.\n' >&2; exit 1; }

sdk_path="$(xcrun --sdk macosx --show-sdk-path)"
swift_compiler="$(xcrun --find swiftc)"
shopt -s nullglob
sources=("$macos_dir"/Sources/*.swift)
[[ ${#sources[@]} -gt 0 ]] || { printf 'No Swift sources found in apps/macos/Sources.\n' >&2; exit 1; }
icon_source="$repo_dir/apps/web/public/assets/connect-icon.png"
wordmark_source="$repo_dir/apps/web/public/assets/connect-logo.png"
[[ -f "$icon_source" ]] || { printf 'The Connect source icon is missing.\n' >&2; exit 1; }
[[ -f "$wordmark_source" ]] || { printf 'The Connect wordmark is missing.\n' >&2; exit 1; }
write_input_fingerprint() {
  /usr/bin/shasum -a 256 "$macos_dir"/Sources/*.swift \
    "$macos_dir/Resources/Info.plist" "$macos_dir/Resources/Connect.entitlements" \
    "$icon_source" "$wordmark_source"
}
/usr/bin/plutil -lint "$macos_dir/Resources/Info.plist" "$macos_dir/Resources/Connect.entitlements" >/dev/null

mkdir -p "$build_dir" "$artifacts_dir"
staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/connect-macos-build.XXXXXX")"
trap 'rm -rf "$staging_dir"' EXIT
write_input_fingerprint > "$staging_dir/inputs.sha256"
app_bundle="$staging_dir/Connect.app"
mkdir -p "$app_bundle/Contents/MacOS" "$app_bundle/Contents/Resources"
cp "$macos_dir/Resources/Info.plist" "$app_bundle/Contents/Info.plist"
cp "$wordmark_source" "$app_bundle/Contents/Resources/ConnectWordmark.png"
printf 'APPL????' > "$app_bundle/Contents/PkgInfo"

binaries=()
for arch in "${architectures[@]}"; do
  printf 'Compiling Connect for %s (macOS 13+)…\n' "$arch"
  arch_dir="$build_dir/$arch"
  mkdir -p "$arch_dir/module-cache"
  "$swift_compiler" -sdk "$sdk_path" -target "$arch-apple-macosx13.0" \
    -module-cache-path "$arch_dir/module-cache" \
    -swift-version 6 -warnings-as-errors -O -whole-module-optimization \
    -framework AppKit -framework WebKit -framework Foundation \
    -framework UniformTypeIdentifiers \
    "${sources[@]}" -o "$arch_dir/Connect"
  binaries+=("$arch_dir/Connect")
done
if [[ ${#binaries[@]} -eq 2 ]]; then
  xcrun lipo -create "${binaries[@]}" -output "$app_bundle/Contents/MacOS/Connect"
else
  cp "${binaries[0]}" "$app_bundle/Contents/MacOS/Connect"
fi
xcrun lipo "$app_bundle/Contents/MacOS/Connect" -verify_arch "${architectures[@]}"
chmod 755 "$app_bundle/Contents/MacOS/Connect"

# sips preserves alpha while padding the supplied, slightly portrait logo.
# Square the canvas first, then resize; never stretch or crop the artwork.
icon_width="$(/usr/bin/sips -g pixelWidth "$icon_source" | awk '/pixelWidth:/{print $2}')"
icon_height="$(/usr/bin/sips -g pixelHeight "$icon_source" | awk '/pixelHeight:/{print $2}')"
[[ "$icon_width" =~ ^[0-9]+$ && "$icon_height" =~ ^[0-9]+$ ]] || { printf 'Could not read the icon dimensions.\n' >&2; exit 1; }
icon_edge="$icon_width"
if (( icon_height > icon_edge )); then icon_edge="$icon_height"; fi
/usr/bin/sips --padToHeightWidth "$icon_edge" "$icon_edge" "$icon_source" --out "$staging_dir/icon-square.png" >/dev/null
iconset="$staging_dir/Connect.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  /usr/bin/sips -z "$size" "$size" "$staging_dir/icon-square.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  double_size=$((size * 2))
  /usr/bin/sips -z "$double_size" "$double_size" "$staging_dir/icon-square.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
/usr/bin/iconutil -c icns "$iconset" -o "$app_bundle/Contents/Resources/Connect.icns"

# Finder metadata inherited by generated files is not valid sealed bundle data.
# Remove only these build-time attributes, never quarantine or source attributes.
/usr/bin/xattr -r -d com.apple.FinderInfo "$app_bundle" 2>/dev/null || true
/usr/bin/xattr -r -d com.apple.ResourceFork "$app_bundle" 2>/dev/null || true

signing_identity="${SIGNING_IDENTITY:--}"
signing_options=(--force --options runtime --entitlements "$macos_dir/Resources/Connect.entitlements" --sign "$signing_identity")
if [[ "$signing_identity" == - ]]; then
  signing_options+=(--timestamp=none)
else
  signing_options+=(--timestamp)
fi
/usr/bin/codesign "${signing_options[@]}" "$app_bundle"
/usr/bin/codesign --verify --strict --verbose=2 "$app_bundle"

# Refuse to publish slices from different source revisions if files change mid-build.
write_input_fingerprint > "$staging_dir/inputs-after.sha256"
if ! /usr/bin/cmp -s "$staging_dir/inputs.sha256" "$staging_dir/inputs-after.sha256"; then
  printf 'Build inputs changed during compilation. Rebuild after edits are finished.\n' >&2
  exit 1
fi

# Replace the previous app only after compilation, icon export and signing pass.
rm -rf "$artifacts_dir/Connect.app"
mv "$app_bundle" "$artifacts_dir/Connect.app"
/usr/bin/xattr -r -d com.apple.FinderInfo "$artifacts_dir/Connect.app" 2>/dev/null || true
/usr/bin/xattr -r -d com.apple.ResourceFork "$artifacts_dir/Connect.app" 2>/dev/null || true
printf '\nBuilt %s\nArchitectures: %s\n' "$artifacts_dir/Connect.app" "$(xcrun lipo -archs "$artifacts_dir/Connect.app/Contents/MacOS/Connect")"
if [[ "$signing_identity" == - ]]; then
  printf 'Signing: ad-hoc, for local testing; not notarized.\n'
else
  printf 'Signing: configured identity; notarization is a separate, explicit step.\n'
fi
