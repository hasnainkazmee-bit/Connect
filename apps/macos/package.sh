#!/bin/bash
set -euo pipefail

macos_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
build_dir="$macos_dir/.build"
artifacts_dir="$macos_dir/artifacts"
source_app="$artifacts_dir/Connect.app"
skip_build=false
notarize=false
architecture=universal
usage() {
  cat <<'USAGE'
Usage: apps/macos/package.sh [--skip-build] [--arch universal|arm64|x86_64] [--notarize]

Build and package Connect.app as a drag-to-Applications DMG and a ZIP.
--skip-build packages the existing, signed artifacts/Connect.app.
--notarize explicitly submits the DMG to Apple. It requires a Developer ID
signed app and NOTARYTOOL_PROFILE naming an existing Keychain profile.
No notarization, upload or app launch occurs without --notarize.
USAGE
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) skip_build=true; shift ;;
    --notarize) notarize=true; shift ;;
    --arch) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; architecture="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
case "$architecture" in universal|arm64|x86_64) ;; *) usage >&2; exit 2 ;; esac
[[ "$(uname -s)" == Darwin ]] || { printf 'Packaging requires macOS.\n' >&2; exit 1; }
if [[ "$skip_build" == false ]]; then "$macos_dir/build.sh" --arch "$architecture"; fi
[[ -d "$source_app" ]] || { printf 'Build Connect.app first.\n' >&2; exit 1; }
# Use non-synced temporary storage: File Providers can attach FinderInfo to an
# .app inside Documents after signing. Verify the actual installer payload.
mkdir -p "$build_dir" "$artifacts_dir"
staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/connect-macos-package.XXXXXX")"
trap 'rm -rf "$staging_dir"' EXIT
mkdir -p "$staging_dir/volume"
app_bundle="$staging_dir/volume/Connect.app"
/usr/bin/ditto "$source_app" "$app_bundle"
/usr/bin/xattr -r -d com.apple.FinderInfo "$app_bundle" 2>/dev/null || true
/usr/bin/xattr -r -d com.apple.ResourceFork "$app_bundle" 2>/dev/null || true
/usr/bin/codesign --verify --strict --all-architectures --verbose=2 "$app_bundle"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_bundle/Contents/Info.plist")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf 'Expected a three-part app version.\n' >&2; exit 1; }
actual_architectures="$(xcrun lipo -archs "$app_bundle/Contents/MacOS/Connect")"
case "$actual_architectures" in
  'arm64 x86_64'|'x86_64 arm64') package_architecture=universal ;;
  arm64|x86_64) package_architecture="$actual_architectures" ;;
  *) printf 'Unsupported binary architectures: %s\n' "$actual_architectures" >&2; exit 1 ;;
esac
if [[ "$notarize" == true ]]; then
  [[ -n "${NOTARYTOOL_PROFILE:-}" ]] || { printf 'Set NOTARYTOOL_PROFILE to an existing Keychain profile.\n' >&2; exit 1; }
  signature_details="$(/usr/bin/codesign -dv --verbose=4 "$app_bundle" 2>&1)"
  [[ "$signature_details" == *'Authority=Developer ID Application:'* ]] || { printf 'Notarization requires a Developer ID Application signature; ad-hoc builds cannot be notarized.\n' >&2; exit 1; }
  xcrun --find notarytool >/dev/null
  xcrun --find stapler >/dev/null
fi

ln -s /Applications "$staging_dir/volume/Applications"
cat > "$staging_dir/volume/Install Connect.txt" <<'INSTALL'
Drag Connect.app into Applications, then open it from Applications.
Connect requires macOS 13 or later and an internet connection.

An ad-hoc signed test build is not notarized by Apple. macOS may block it.
For your own trusted local build, use System Settings > Privacy & Security
> Open Anyway if macOS offers that option. Do not disable Gatekeeper.
Public distribution should use a Developer ID signed, notarized build.
INSTALL
archive_name="Connect-$version-macos-$package_architecture"
dmg_path="$artifacts_dir/$archive_name.dmg"
zip_path="$artifacts_dir/$archive_name.zip"
/usr/bin/hdiutil create -quiet -volname Connect -srcfolder "$staging_dir/volume" \
  -format UDZO -ov "$staging_dir/$archive_name.dmg"
/usr/bin/hdiutil verify "$staging_dir/$archive_name.dmg" >/dev/null
mv -f "$staging_dir/$archive_name.dmg" "$dmg_path"

if [[ "$notarize" == true ]]; then
  printf 'Submitting the installer to Apple using the configured Keychain profile…\n'
  xcrun notarytool submit "$dmg_path" --keychain-profile "$NOTARYTOOL_PROFILE" --wait
  xcrun stapler staple "$dmg_path"
  xcrun stapler validate "$dmg_path"
  # The DMG ticket covers its app. Staple the artifact too for ZIP delivery.
  xcrun stapler staple "$app_bundle"
  xcrun stapler validate "$app_bundle"
fi
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app_bundle" "$staging_dir/$archive_name.zip"
mv -f "$staging_dir/$archive_name.zip" "$zip_path"
/usr/bin/codesign --verify --strict --all-architectures --verbose=2 "$app_bundle"
# File Provider registration can add FinderInfo after build.sh finishes.
/usr/bin/xattr -r -d com.apple.FinderInfo "$source_app" 2>/dev/null || true
/usr/bin/xattr -r -d com.apple.ResourceFork "$source_app" 2>/dev/null || true
printf '\nInstaller: %s\nArchive:   %s\n' "$dmg_path" "$zip_path"
if [[ "$notarize" == false ]]; then printf 'No Apple notarization was requested.\n'; fi
