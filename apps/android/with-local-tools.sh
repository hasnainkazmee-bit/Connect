#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/../.." && pwd)"
# Optional project-local tool installation. Existing developer environment wins.
if [[ -z "${JAVA_HOME:-}" ]]; then
  for candidate in "$project_root"/.toolchains/jdk-*/Contents/Home; do
    if [[ -x "$candidate/bin/java" ]]; then export JAVA_HOME="$candidate"; break; fi
  done
fi
export ANDROID_HOME="${ANDROID_HOME:-$project_root/.toolchains/android-sdk}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$project_root/.toolchains/gradle-home}"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$project_root/.toolchains/android-user}"
export ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-$ANDROID_USER_HOME/avd}"
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
cd "$project_root/apps/android"
exec "$@"
