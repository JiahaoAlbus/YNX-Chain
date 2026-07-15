#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
serial="${ANDROID_SERIAL:-}"
selector_type="${1:-}"
selector="${2:-}"
[[ -n "$serial" ]] || { echo "ANDROID_SERIAL must identify a running Android emulator" >&2; exit 1; }
[[ "$selector_type" == text || "$selector_type" == description ]] || { echo "selector type must be text or description" >&2; exit 1; }
[[ -n "$selector" ]] || { echo "selector is required" >&2; exit 1; }
adb -s "$serial" get-state | grep -qx device
[[ "$(adb -s "$serial" shell getprop ro.kernel.qemu | tr -d '\r')" == 1 ]] || {
  echo "UI click automation is limited to disposable Android emulators" >&2
  exit 1
}

sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
platform="$(find "$sdk/platforms" -mindepth 1 -maxdepth 1 -type d -name 'android-*' | sort -V | tail -1)"
build_tools="$(find "$sdk/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
work="$(mktemp -d)"
cleanup() {
  adb -s "$serial" shell rm -f /data/local/tmp/ynx-ui-click.jar >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
mkdir -p "$work/classes" "$work/dex"
javac -source 8 -target 8 -Xlint:-options \
  -cp "$platform/android.jar:$platform/uiautomator.jar" \
  -d "$work/classes" \
  scripts/verify/android-ui-set-text/junit/framework/TestCase.java \
  scripts/verify/android-ui-set-text/Click.java
(cd "$work/classes" && jar cf "$work/input.jar" ynx/verify/Click.class)
"$build_tools/d8" --lib "$platform/android.jar" --output "$work/dex" "$work/input.jar" >/dev/null
(cd "$work/dex" && jar cf "$work/ynx-ui-click.jar" classes.dex)
adb -s "$serial" push "$work/ynx-ui-click.jar" /data/local/tmp/ynx-ui-click.jar >/dev/null
encoded_selector="$(printf '%s' "$selector" | base64 | tr -d '\n')"
adb -s "$serial" shell uiautomator runtest ynx-ui-click.jar -c ynx.verify.Click \
  -e selectorType "$selector_type" -e selectorBase64 "$encoded_selector" -s | grep -q '^OK '
echo "mobile Android visible native control click passed: $selector_type"
