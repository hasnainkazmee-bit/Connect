#!/bin/bash
set -euo pipefail

[[ $# -ge 1 && $# -le 2 ]] || { printf 'Usage: test-package.sh installer.pkg [reference.app]\n' >&2; exit 2; }
package="$1"
reference_app="${2:-}"
[[ -f "$package" ]] || { printf 'Installer package not found.\n' >&2; exit 1; }
scratch="$(mktemp -d "${TMPDIR:-/tmp}/connect-installer-check.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
/usr/sbin/pkgutil --expand-full "$package" "$scratch/expanded"
distribution="$scratch/expanded/Distribution"
component="$scratch/expanded/ConnectComponent.pkg"
manifest="$component/PackageInfo"
app="$component/Payload/Connect.app"
assert_xml() {
  local file="$1" query="$2" expected="$3" actual
  actual="$(/usr/bin/xmllint --xpath "$query" "$file")"
  [[ "$actual" == "$expected" ]] || { printf 'Unexpected package metadata: %s → %s (expected %s)\n' "$query" "$actual" "$expected" >&2; exit 1; }
}
/usr/bin/xmllint --noout "$distribution" "$manifest"
/usr/bin/codesign --verify --strict --all-architectures --verbose=2 "$app"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
minimum_os="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$app/Contents/Info.plist")"
assert_xml "$manifest" 'string(/pkg-info/@identifier)' 'com.sunhub.connect.macos.pkg'
assert_xml "$manifest" 'string(/pkg-info/@version)' "$version"
assert_xml "$manifest" 'string(/pkg-info/@install-location)' '/Applications'
assert_xml "$manifest" 'count(/pkg-info/scripts/*)' '0'
assert_xml "$manifest" 'count(/pkg-info/relocate/*)' '0'
assert_xml "$manifest" 'count(/pkg-info/bundle-version/bundle[@id="com.sunhub.connect.macos"])' '1'
assert_xml "$manifest" 'count(/pkg-info/upgrade-bundle/bundle[@id="com.sunhub.connect.macos"])' '1'
assert_xml "$manifest" 'count(/pkg-info/strict-identifier/bundle[@id="com.sunhub.connect.macos"])' '1'
assert_xml "$distribution" 'string(/installer-gui-script/options/@require-scripts)' 'false'
assert_xml "$distribution" 'string(/installer-gui-script/options/@allow-external-scripts)' 'false'
assert_xml "$distribution" 'string(/installer-gui-script/domains/@enable_anywhere)' 'false'
assert_xml "$distribution" 'string(/installer-gui-script/domains/@enable_currentUserHome)' 'false'
assert_xml "$distribution" 'string(/installer-gui-script/domains/@enable_localSystem)' 'true'
assert_xml "$distribution" 'string(/installer-gui-script/volume-check/allowed-os-versions/os-version/@min)' "$minimum_os"
assert_xml "$distribution" 'count(/installer-gui-script/pkg-ref/must-close/app[@id="com.sunhub.connect.macos"])' '1'
assert_xml "$distribution" 'count(/installer-gui-script/script)' '0'
[[ ! -e "$component/Scripts" ]] || { printf 'Unexpected install scripts in package.\n' >&2; exit 1; }
# A fixed, narrow payload protects sessions/preferences and other app copies.
/usr/bin/lsbom -s "$component/Bom" > "$scratch/payload-files"
[[ -s "$scratch/payload-files" ]] || { printf 'Empty installer payload manifest.\n' >&2; exit 1; }
while IFS= read -r entry; do
  case "$entry" in
    .|./Connect.app|./._Connect.app|./Connect.app/*) ;;
    *) printf 'Unexpected installer payload path: %s\n' "$entry" >&2; exit 1 ;;
  esac
done < "$scratch/payload-files"
for resource in Welcome.html ReadMe.html Conclusion.html; do
  [[ -f "$scratch/expanded/Resources/$resource" ]] || { printf 'Missing installer resource: %s\n' "$resource" >&2; exit 1; }
done
if /usr/bin/grep -q -E '@TRUST_NOTICE@|@INSTALLER_CSS@' "$scratch/expanded/Resources/"*.html; then
  printf 'Unresolved content in installer.\n' >&2; exit 1
fi
architectures="$(xcrun lipo -archs "$app/Contents/MacOS/Connect")"
case "$architectures" in
  'arm64 x86_64'|'x86_64 arm64') expected_architectures='arm64,x86_64' ;;
  arm64|x86_64) expected_architectures="$architectures" ;;
  *) printf 'Unexpected payload architectures.\n' >&2; exit 1 ;;
esac
assert_xml "$distribution" 'string(/installer-gui-script/options/@hostArchitectures)' "$expected_architectures"
if [[ -n "$reference_app" ]]; then
  /usr/bin/cmp "$reference_app/Contents/MacOS/Connect" "$app/Contents/MacOS/Connect"
  /usr/bin/cmp "$reference_app/Contents/Info.plist" "$app/Contents/Info.plist"
  /usr/bin/cmp "$reference_app/Contents/Resources/ConnectWordmark.png" "$app/Contents/Resources/ConnectWordmark.png"
fi
printf 'Installer verified: Connect %s, /Applications/Connect.app, %s, version-checked atomic upgrade, no install scripts.\n' "$version" "$architectures"
