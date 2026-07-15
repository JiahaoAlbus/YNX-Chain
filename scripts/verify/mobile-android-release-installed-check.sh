#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
serial="${ANDROID_SERIAL:-}"
[[ -n "$serial" ]] || { echo "ANDROID_SERIAL must identify a running Android emulator" >&2; exit 1; }
adb -s "$serial" get-state | grep -qx device
[[ "$(adb -s "$serial" shell getprop ro.kernel.qemu | tr -d '\r')" == 1 ]] || {
  echo "release installed check refuses non-emulator devices because it clears application data" >&2
  exit 1
}

apk=apps/mobile/android/app/build/outputs/apk/release/app-release.apk
[[ -s "$apk" ]] || { echo "build the test-only release APK with make mobile-android-release-check first" >&2; exit 1; }
if [[ -z "${ANDROID_HOME:-}" && -d /opt/homebrew/share/android-commandlinetools ]]; then
  export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
fi
apksigner="$(find "$ANDROID_HOME/build-tools" -type f -name apksigner -perm -111 | sort -V | tail -1)"
"$apksigner" verify --verbose "$apk" | rg -q '^Verifies$'

adb -s "$serial" shell am force-stop com.ynxweb4.mobile >/dev/null 2>&1 || true
adb -s "$serial" shell pm uninstall com.ynxweb4.mobile >/dev/null 2>&1 || true
adb -s "$serial" logcat -c
adb -s "$serial" install "$apk" >/dev/null
launch="$(adb -s "$serial" shell am start -W -n com.ynxweb4.mobile/.MainActivity | tr -d '\r')"
printf '%s\n' "$launch" | rg -q '^Status: ok$'
printf '%s\n' "$launch" | rg -q '^Activity: com\.ynxweb4\.mobile/\.MainActivity$'
sleep 5
adb -s "$serial" shell dumpsys activity activities | rg -q 'topResumedActivity=.*com\.ynxweb4\.mobile/\.MainActivity'
[[ -n "$(adb -s "$serial" shell pidof com.ynxweb4.mobile | tr -d '\r')" ]]

remote_dump=/sdcard/ynx-release-installed-check.xml
local_dump="$(mktemp)"
trap 'rm -f "$local_dump"' EXIT
adb -s "$serial" shell uiautomator dump "$remote_dump" >/dev/null
adb -s "$serial" pull "$remote_dump" "$local_dump" >/dev/null
for text in 'content-desc="YNX"' 'text="Testnet"' 'text="The Square is quiet"' 'text="Live public feed connected. No posts are stored yet."'; do
  rg -Fq "$text" "$local_dump"
done
if adb -s "$serial" logcat -d -t 1200 | rg -i 'FATAL EXCEPTION|AndroidRuntime.*FATAL|Process: com\.ynxweb4\.mobile.*crash'; then
  echo "release application emitted a fatal Android log" >&2
  exit 1
fi

printf 'mobile-android-release-installed-check passed: serial=%s package=com.ynxweb4.mobile no-post-live-feed apkSha256=' "$serial"
shasum -a 256 "$apk" | awk '{print $1}'
