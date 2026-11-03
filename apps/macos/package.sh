#!/bin/bash
set -euo pipefail

macos_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
build_dir="$macos_dir/.build"
artifacts_dir="$macos_dir/artifacts"
source_app="$artifacts_dir/Connect.app"
skip_build=false
notarize=false
architecture=universal
usage() {
  cat <<'USAGE'
Usage: apps/macos/package.sh [--skip-build] [--arch universal|arm64|x86_64] [--notarize]

Build Connect.app and package a native macOS Installer (.pkg), DMG and ZIP.
--skip-build packages the existing, signed artifacts/Connect.app.
INSTALLER_SIGNING_IDENTITY may name an existing Developer ID Installer identity.
--notarize explicitly submits the PKG and DMG to Apple. It requires a Developer
ID signed app, INSTALLER_SIGNING_IDENTITY, and NOTARYTOOL_PROFILE naming an
existing Keychain profile.
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
if [[ -n "${INSTALLER_SIGNING_IDENTITY:-}" && "$INSTALLER_SIGNING_IDENTITY" != 'Developer ID Installer:'* ]]; then
  printf 'INSTALLER_SIGNING_IDENTITY must name a Developer ID Installer identity.\n' >&2; exit 1
fi
if [[ "$notarize" == true ]]; then
  [[ -n "${NOTARYTOOL_PROFILE:-}" && -n "${INSTALLER_SIGNING_IDENTITY:-}" ]] || { printf 'Notarization requires NOTARYTOOL_PROFILE and INSTALLER_SIGNING_IDENTITY.\n' >&2; exit 1; }
fi
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
minimum_os="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$app_bundle/Contents/Info.plist")"
[[ "$minimum_os" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || { printf 'Expected a numeric minimum macOS version.\n' >&2; exit 1; }
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_bundle/Contents/Info.plist")" == com.sunhub.connect.macos ]] || { printf 'Unexpected app bundle identifier.\n' >&2; exit 1; }
actual_architectures="$(xcrun lipo -archs "$app_bundle/Contents/MacOS/Connect")"
case "$actual_architectures" in
  'arm64 x86_64'|'x86_64 arm64') package_architecture=universal; installer_architectures='arm64,x86_64' ;;
  arm64|x86_64) package_architecture="$actual_architectures"; installer_architectures="$actual_architectures" ;;
  *) printf 'Unsupported binary architectures: %s\n' "$actual_architectures" >&2; exit 1 ;;
esac
if [[ "$notarize" == true ]]; then
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
pkg_path="$artifacts_dir/$archive_name.pkg"
/usr/bin/hdiutil create -quiet -volname Connect -srcfolder "$staging_dir/volume" \
  -format UDZO -ov "$staging_dir/$archive_name.dmg"
/usr/bin/hdiutil verify "$staging_dir/$archive_name.dmg" >/dev/null

if [[ "$notarize" == true ]]; then
  printf 'Submitting the installer to Apple using the configured Keychain profile…\n'
  xcrun notarytool submit "$staging_dir/$archive_name.dmg" --keychain-profile "$NOTARYTOOL_PROFILE" --wait
  xcrun stapler staple "$staging_dir/$archive_name.dmg"
  xcrun stapler validate "$staging_dir/$archive_name.dmg"
  # The DMG ticket covers its app. Staple the artifact too for ZIP delivery.
  xcrun stapler staple "$app_bundle"
  xcrun stapler validate "$app_bundle"
fi
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app_bundle" "$staging_dir/$archive_name.zip"

# A native Installer product with one non-relocatable app. No scripts touch
# running processes, user containers, preferences, sessions, or other copies.
installer_source="$macos_dir/Resources/Installer"
package_root="$staging_dir/package-root"
installer_resources="$staging_dir/installer-resources"
mkdir -p "$package_root" "$installer_resources" "$staging_dir/components"
/usr/bin/ditto "$app_bundle" "$package_root/Connect.app"
# Installer does not preserve arbitrary linked CSS resources. Keep each native
# HTML pane self-contained, while maintaining the shared palette in one file.
for page in Welcome ReadMe Conclusion; do
  /usr/bin/awk 'FNR == NR { css = css $0 "\n"; next } { gsub(/@INSTALLER_CSS@/, css); print }' \
    "$installer_source/installer.css" "$installer_source/$page.html" > "$installer_resources/$page.html"
done
if [[ "$notarize" == true ]]; then
  trust_notice='This installer is Developer ID signed and notarized by Apple.'
elif [[ -n "${INSTALLER_SIGNING_IDENTITY:-}" ]]; then
  trust_notice='This installer is signed but has not been notarized by Apple.'
else
  trust_notice='This local test installer is unsigned and has not been notarized by Apple. macOS may block a downloaded copy.'
fi
/usr/bin/sed "s/@TRUST_NOTICE@/$trust_notice/" "$installer_resources/ReadMe.html" > "$installer_resources/ReadMe.ready.html"
mv "$installer_resources/ReadMe.ready.html" "$installer_resources/ReadMe.html"
/usr/bin/pkgbuild --root "$package_root" --install-location /Applications \
  --identifier com.sunhub.connect.macos.pkg --version "$version" \
  --component-plist "$installer_source/components.plist" \
  --ownership recommended --min-os-version "$minimum_os" \
  "$staging_dir/components/ConnectComponent.pkg"
cat > "$staging_dir/Distribution.xml" <<DISTRIBUTION
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>Connect</title>
  <welcome file="Welcome.html" mime-type="text/html"/>
  <readme file="ReadMe.html" mime-type="text/html"/>
  <conclusion file="Conclusion.html" mime-type="text/html"/>
  <options customize="never" require-scripts="false" allow-external-scripts="false" hostArchitectures="$installer_architectures"/>
  <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
  <volume-check><allowed-os-versions><os-version min="$minimum_os"/></allowed-os-versions></volume-check>
  <choices-outline><line choice="connect"/></choices-outline>
  <choice id="connect" title="Connect" description="Connect for macOS" visible="false">
    <pkg-ref id="com.sunhub.connect.macos.pkg"/>
  </choice>
  <pkg-ref id="com.sunhub.connect.macos.pkg" version="$version" onConclusion="None">ConnectComponent.pkg</pkg-ref>
  <pkg-ref id="com.sunhub.connect.macos.pkg"><must-close><app id="com.sunhub.connect.macos"/></must-close></pkg-ref>
</installer-gui-script>
DISTRIBUTION
product_command=(/usr/bin/productbuild --distribution "$staging_dir/Distribution.xml"
  --resources "$installer_resources" --package-path "$staging_dir/components")
if [[ -n "${INSTALLER_SIGNING_IDENTITY:-}" ]]; then
  product_command+=(--sign "$INSTALLER_SIGNING_IDENTITY" --timestamp)
fi
"${product_command[@]}" "$staging_dir/$archive_name.pkg"
if [[ "$notarize" == true ]]; then
  xcrun notarytool submit "$staging_dir/$archive_name.pkg" --keychain-profile "$NOTARYTOOL_PROFILE" --wait
  xcrun stapler staple "$staging_dir/$archive_name.pkg"
  xcrun stapler validate "$staging_dir/$archive_name.pkg"
fi
"$macos_dir/test-package.sh" "$staging_dir/$archive_name.pkg" "$app_bundle"
/usr/bin/codesign --verify --strict --all-architectures --verbose=2 "$app_bundle"
mv -f "$staging_dir/$archive_name.pkg" "$pkg_path"
mv -f "$staging_dir/$archive_name.dmg" "$dmg_path"
mv -f "$staging_dir/$archive_name.zip" "$zip_path"
# File Provider registration can add FinderInfo after build.sh finishes.
/usr/bin/xattr -r -d com.apple.FinderInfo "$source_app" 2>/dev/null || true
/usr/bin/xattr -r -d com.apple.ResourceFork "$source_app" 2>/dev/null || true
printf '\nInstaller: %s\nDisk image: %s\nArchive:    %s\n' "$pkg_path" "$dmg_path" "$zip_path"
if [[ -z "${INSTALLER_SIGNING_IDENTITY:-}" ]]; then printf 'PKG signing: unsigned local test installer; existing app signature preserved.\n'; fi
if [[ "$notarize" == false ]]; then printf 'No Apple notarization was requested.\n'; fi
