#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
serial="${ANDROID_SERIAL:-}"
[[ -n "$serial" ]] || { echo "ANDROID_SERIAL must identify a running enrolled Android emulator" >&2; exit 1; }
adb -s "$serial" get-state | grep -qx device
[[ "$(adb -s "$serial" shell getprop ro.kernel.qemu | tr -d '\r')" == 1 ]] || {
  echo "biometric installed check refuses non-emulator devices because it clears application data" >&2
  exit 1
}
apk=apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
[[ -s "$apk" ]] || { echo "build the native debug APK with make mobile-android-native-check first" >&2; exit 1; }
adb -s "$serial" shell dumpsys fingerprint | rg -q '"count":[1-9][0-9]*' || {
  echo "enroll one strong emulator fingerprint before running this check" >&2
  exit 1
}
adb -s "$serial" shell dumpsys biometric | rg -q 'oemStrength: 15, updatedStrength: 15' || {
  echo "the emulator fingerprint sensor is not strong biometric class" >&2
  exit 1
}
adb -s "$serial" shell dumpsys fingerprint | rg -q '"lockout":0,"permanentLockout":0' || {
  echo "strong emulator biometrics are locked or unavailable" >&2
  exit 1
}

work="$(mktemp -d)"
metro_started=0
cleanup() {
  adb -s "$serial" shell am force-stop com.ynxweb4.mobile >/dev/null 2>&1 || true
  adb -s "$serial" shell pm clear com.ynxweb4.mobile >/dev/null 2>&1 || true
  adb -s "$serial" shell rm -f /sdcard/ynx-biometric-check.xml >/dev/null 2>&1 || true
  if [[ "$metro_started" == 1 && -n "${metro_pid:-}" ]]; then kill "$metro_pid" >/dev/null 2>&1 || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

if ! curl --connect-timeout 1 --max-time 2 -fsS http://127.0.0.1:8081/status | grep -qx 'packager-status:running'; then
  (
    cd apps/mobile
    CI=1 EXPO_NO_TELEMETRY=1 npx expo start --dev-client --port 8081 >"$work/metro.log" 2>&1
  ) &
  metro_pid=$!
  metro_started=1
  for _ in {1..60}; do
    if curl --connect-timeout 1 --max-time 2 -fsS http://127.0.0.1:8081/status 2>/dev/null | grep -qx 'packager-status:running'; then break; fi
    sleep 1
  done
  curl --connect-timeout 1 --max-time 2 -fsS http://127.0.0.1:8081/status | grep -qx 'packager-status:running' || {
    sed -n '1,160p' "$work/metro.log" >&2
    echo "Metro did not become ready" >&2
    exit 1
  }
fi

dump_ui() {
  adb -s "$serial" shell uiautomator dump /sdcard/ynx-biometric-check.xml >/dev/null
  adb -s "$serial" pull /sdcard/ynx-biometric-check.xml "$work/ui.xml" >/dev/null
}
tap_description() {
  local label="$1" coordinates
  dump_ui
  coordinates="$(node - "$work/ui.xml" "$label" <<'NODE'
const fs = require("fs");
const [file, label] = process.argv.slice(2);
const xml = fs.readFileSync(file, "utf8");
const nodes = xml.match(/<node\b[^>]*>/g) || [];
const node = nodes.find((value) => value.includes(`content-desc="${label}"`));
if (!node) throw new Error(`UI control not found: ${label}`);
const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
if (!bounds) throw new Error(`UI control has no bounds: ${label}`);
const values = bounds.slice(1).map(Number);
process.stdout.write(`${Math.floor((values[0] + values[2]) / 2)} ${Math.floor((values[1] + values[3]) / 2)}`);
NODE
)"
  adb -s "$serial" shell input tap $coordinates
}

adb -s "$serial" reverse tcp:8081 tcp:8081 >/dev/null
adb -s "$serial" install -r "$apk" >/dev/null
adb -s "$serial" shell pm clear com.ynxweb4.mobile >/dev/null
adb -s "$serial" logcat -c
launch="$(adb -s "$serial" shell am start -W -n com.ynxweb4.mobile/.MainActivity | tr -d '\r')"
printf '%s\n' "$launch" | rg -q '^Status: ok$'
sleep 7
tap_description "Wallet"
sleep 1
tap_description "Create identity"
sleep 1
dump_ui
rg -Fq 'text="Authorize recovery key access"' "$work/ui.xml"

adb -s "$serial" shell input keyevent 4
sleep 1
dump_ui
rg -Fq 'text="Biometric authorization was cancelled."' "$work/ui.xml"
tap_description "Create identity"
sleep 1
adb -s "$serial" emu finger touch 2 >/dev/null
sleep 1
dump_ui
rg -Fq 'text="Authorize recovery key access"' "$work/ui.xml"
if rg -Fq 'text="Recovery key"' "$work/ui.xml"; then
  echo "an unregistered fingerprint opened the recovery panel" >&2
  exit 1
fi

adb -s "$serial" emu finger touch 1 >/dev/null
sleep 2
dump_ui
node - "$work/ui.xml" <<'NODE'
const fs = require("fs");
const xml = fs.readFileSync(process.argv[2], "utf8");
for (const text of ["Recovery key", "I saved the recovery key offline", "Secure on this device"]) {
  if (!xml.includes(`text="${text}"`)) throw new Error(`missing protected recovery UI: ${text}`);
}
if (!/text="[0-9a-f]{64}"/.test(xml)) throw new Error("recovery key was not generated after registered biometric success");
NODE
adb -s "$serial" shell dumpsys window windows | rg -Uq 'com\.ynxweb4\.mobile[\s\S]{0,900}fl=[^\n]*SECURE'
if adb -s "$serial" logcat -d -t 1200 | rg -i 'FATAL EXCEPTION|AndroidRuntime.*FATAL|Process: com\.ynxweb4\.mobile.*crash'; then
  echo "biometric application flow emitted a fatal Android log" >&2
  exit 1
fi

printf 'mobile-biometric-installed-check passed: serial=%s native cancel/unregistered-fingerprint rejection/registered-fingerprint success, protected recovery panel, apkSha256=' "$serial"
shasum -a 256 "$apk" | awk '{print $1}'
