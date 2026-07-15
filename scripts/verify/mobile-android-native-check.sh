#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ ! -d apps/mobile/node_modules ]]; then
  npm --prefix apps/mobile ci --ignore-scripts --no-audit --no-fund
fi

if [[ -z "${ANDROID_HOME:-}" && -d /opt/homebrew/share/android-commandlinetools ]]; then
  export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
fi
if [[ -z "${ANDROID_HOME:-}" || ! -d "$ANDROID_HOME/platforms" ]]; then
  echo "mobile-android-native-check failed: set ANDROID_HOME to an installed Android SDK" >&2
  exit 1
fi
if [[ -z "${JAVA_HOME:-}" && -x /usr/libexec/java_home ]]; then
  export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
fi
if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/java" ]]; then
  echo "mobile-android-native-check failed: Java 17 is required" >&2
  exit 1
fi

(
  cd apps/mobile
  CI=1 EXPO_NO_TELEMETRY=1 npx expo prebuild --platform android --clean --no-install
  cd android
  ./gradlew --no-daemon --console=plain :app:assembleDebug
)

apk=apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
test -s "$apk"
unzip -tqq "$apk"
aapt="$(find "$ANDROID_HOME/build-tools" -type f -name aapt -perm -111 | sort -V | tail -1)"
if [[ -z "$aapt" ]]; then
  echo "mobile-android-native-check failed: Android aapt is unavailable" >&2
  exit 1
fi
"$aapt" dump badging "$apk" | rg -q "package: name='com\.ynxweb4\.mobile'"

printf 'mobile-android-native-check passed: package=com.ynxweb4.mobile apk=%s sha256=' "$apk"
shasum -a 256 "$apk" | awk '{print $1}'
