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
adb -s "$serial" shell dumpsys user | rg -q 'State: RUNNING_UNLOCKED' || {
  echo "release installed check requires the emulator user to be unlocked" >&2
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

dump_ui() {
  adb -s "$serial" shell uiautomator dump "$remote_dump" >/dev/null
  adb -s "$serial" pull "$remote_dump" "$local_dump" >/dev/null
}

tap_desc() {
  local description="$1" bounds x1 y1 x2 y2
  dump_ui
  bounds="$(rg -o "content-desc=\"${description}\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" "$local_dump" | head -1)"
  [[ -n "$bounds" ]] || { echo "accessibility target is missing: $description" >&2; exit 1; }
  read -r x1 y1 x2 y2 < <(printf '%s\n' "$bounds" | sed -E 's/.*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]"/\1 \2 \3 \4/')
  adb -s "$serial" shell input tap "$(((x1 + x2) / 2))" "$(((y1 + y2) / 2))"
  sleep 1
}

dump_ui
for text in 'content-desc="YNX"' 'text="Testnet"' 'content-desc="Feed"' 'content-desc="Messages"' 'content-desc="Alerts"' 'content-desc="Social"' 'content-desc="Wallet"' 'content-desc="Pay"' 'content-desc="Network"'; do
  rg -Fq "$text" "$local_dump"
done
tap_desc Messages
dump_ui
for text in 'text="PRIVATE MESSAGING"' 'text="Chat"' 'text="Private by design"' 'text="Wallet"'; do
  rg -Fq "$text" "$local_dump"
done
tap_desc Alerts
dump_ui
for text in 'text="SOCIAL INBOX"' 'text="Alerts"' 'text="Private alerts are locked"' 'text="Connect your native account to load member-scoped Social activity."'; do
  rg -Fq "$text" "$local_dump"
done
tap_desc Pay
dump_ui
for text in 'text="NATIVE YNXT CHECKOUT"' 'text="Pay"' 'text="Invoice"' 'content-desc="YNX Pay invoice"' 'content-desc="Open invoice"' 'text="Verified before signing"'; do
  rg -Fq "$text" "$local_dump"
done
if adb -s "$serial" logcat -d -t 1200 | rg -i 'FATAL EXCEPTION|AndroidRuntime.*FATAL|Process: com\.ynxweb4\.mobile.*crash|Unable to load script'; then
  echo "release application emitted a fatal Android log" >&2
  exit 1
fi

printf 'mobile-android-release-installed-check passed: serial=%s package=com.ynxweb4.mobile embedded-Hermes Social-Feed-Messages-Alerts-and-Pay-ui apkSha256=' "$serial"
shasum -a 256 "$apk" | awk '{print $1}'
