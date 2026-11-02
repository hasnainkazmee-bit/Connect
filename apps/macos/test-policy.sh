#!/bin/sh
set -eu

macos_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
policy_build_dir=$(mktemp -d "${TMPDIR:-/tmp}/connect-navigation-policy.XXXXXX")
trap 'rm -rf "$policy_build_dir"' EXIT HUP INT TERM

for configuration in debug release; do
  if [ "$configuration" = debug ]; then
    set -- -D DEBUG
  else
    set --
  fi
  swiftc -swift-version 6 -warnings-as-errors \
    -module-cache-path "$policy_build_dir/modules" \
    "$@" \
    "$macos_dir/Sources/NavigationPolicy.swift" \
    "$macos_dir/Tests/NavigationPolicyTests.swift" \
    -o "$policy_build_dir/policy-$configuration"
  "$policy_build_dir/policy-$configuration"
done

xcrun swiftc -swift-version 6 -warnings-as-errors \
  -module-cache-path "$policy_build_dir/modules" \
  -framework AppKit -framework WebKit \
  "$macos_dir/Sources/NativeSelectCoordinator.swift" \
  "$macos_dir/Tests/NativeSelectTests.swift" \
  -o "$policy_build_dir/native-selects"
"$policy_build_dir/native-selects"
