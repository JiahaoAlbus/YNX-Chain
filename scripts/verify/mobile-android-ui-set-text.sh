#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
serial="${ANDROID_SERIAL:-}"
description="${1:-}"
value="${2:-}"
[[ -n "$serial" ]] || { echo "ANDROID_SERIAL must identify a running Android emulator" >&2; exit 1; }
[[ -n "$description" && -n "$value" ]] || { echo "usage: mobile-android-ui-set-text.sh <accessibility-description> <value>" >&2; exit 1; }
adb -s "$serial" get-state | grep -qx device
[[ "$(adb -s "$serial" shell getprop ro.kernel.qemu | tr -d '\r')" == 1 ]] || {
  echo "UI text automation is limited to disposable Android emulators" >&2
  exit 1
}

sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
platform="$(find "$sdk/platforms" -mindepth 1 -maxdepth 1 -type d -name 'android-*' | sort -V | tail -1)"
build_tools="$(find "$sdk/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
[[ -s "$platform/android.jar" && -s "$platform/uiautomator.jar" && -x "$build_tools/d8" ]] || {
  echo "Android platform UiAutomator and d8 are required" >&2
  exit 1
}

work="$(mktemp -d)"
cleanup() {
  adb -s "$serial" shell rm -f /data/local/tmp/ynx-ui-set-text.jar >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
mkdir -p "$work/classes" "$work/dex"
javac -source 8 -target 8 -Xlint:-options \
  -cp "$platform/android.jar:$platform/uiautomator.jar" \
  -d "$work/classes" \
  scripts/verify/android-ui-set-text/junit/framework/TestCase.java \
  scripts/verify/android-ui-set-text/SetText.java
(cd "$work/classes" && jar cf "$work/input.jar" ynx/verify/SetText.class)
"$build_tools/d8" --lib "$platform/android.jar" --output "$work/dex" "$work/input.jar" >/dev/null
(cd "$work/dex" && jar cf "$work/ynx-ui-set-text.jar" classes.dex)
adb -s "$serial" push "$work/ynx-ui-set-text.jar" /data/local/tmp/ynx-ui-set-text.jar >/dev/null
encoded_description="$(printf '%s' "$description" | base64 | tr -d '\n')"
adb -s "$serial" shell uiautomator runtest ynx-ui-set-text.jar -c ynx.verify.SetText \
  -e descriptionBase64 "$encoded_description" -e value "$value" -s | grep -q '^OK '
echo "mobile Android visible native input set-text passed: $description"
