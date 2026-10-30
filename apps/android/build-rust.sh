#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/../.." && pwd)"
android_project="$project_root/apps/android"
: "${ANDROID_HOME:?Set ANDROID_HOME to your licensed Android SDK directory.}"
ndk_root="${ANDROID_NDK_HOME:-$ANDROID_HOME/ndk/28.2.13676358}"
case "$(uname -s)" in
  Darwin) ndk_host=darwin-x86_64; host_library=libsunhub_mobile_core.dylib ;;
  Linux) ndk_host=linux-x86_64; host_library=libsunhub_mobile_core.so ;;
  *) echo "Run this build script on macOS or Linux." >&2; exit 1 ;;
esac
toolchain="$ndk_root/toolchains/llvm/prebuilt/$ndk_host/bin"
if [[ ! -x "$toolchain/aarch64-linux-android26-clang" ]]; then
  echo "NDK 28.2.13676358 is missing. See apps/android/README.md." >&2; exit 1
fi
cd "$project_root"
cargo build --locked -p sunhub-mobile-core -p sunhub-bindgen
target/debug/sunhub-bindgen generate --library "target/debug/$host_library" --language kotlin \
  --out-dir "$android_project/app/src/main/java" --no-format
env CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$toolchain/aarch64-linux-android26-clang" \
  CC_aarch64_linux_android="$toolchain/aarch64-linux-android26-clang" AR_aarch64_linux_android="$toolchain/llvm-ar" \
  cargo build --locked --release -p sunhub-mobile-core --target aarch64-linux-android
env CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER="$toolchain/x86_64-linux-android26-clang" \
  CC_x86_64_linux_android="$toolchain/x86_64-linux-android26-clang" AR_x86_64_linux_android="$toolchain/llvm-ar" \
  cargo build --locked --release -p sunhub-mobile-core --target x86_64-linux-android
mkdir -p "$android_project/app/src/main/jniLibs/arm64-v8a" "$android_project/app/src/main/jniLibs/x86_64"
cp target/aarch64-linux-android/release/libsunhub_mobile_core.so "$android_project/app/src/main/jniLibs/arm64-v8a/"
cp target/x86_64-linux-android/release/libsunhub_mobile_core.so "$android_project/app/src/main/jniLibs/x86_64/"
