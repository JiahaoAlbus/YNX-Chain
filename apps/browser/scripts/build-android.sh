#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/android"
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$SDK" ]]; then
  echo "ANDROID_SDK_ROOT or ANDROID_HOME is required" >&2
  exit 1
fi
TOOLS="$SDK/build-tools/36.0.0"
PLATFORM="$SDK/platforms/android-36/android.jar"
BUILD="$PROJECT/.manual-build"
DIST="$ROOT/dist/android"
rm -rf "$BUILD"
mkdir -p "$BUILD/generated" "$BUILD/classes" "$BUILD/dex"

"$TOOLS/aapt2" compile --dir "$PROJECT/app/src/main/res" -o "$BUILD/resources.zip"
"$TOOLS/aapt2" link -o "$BUILD/base.apk" -I "$PLATFORM" --manifest "$PROJECT/app/src/main/AndroidManifest.xml" --java "$BUILD/generated" --min-sdk-version 28 --target-sdk-version 36 --version-code 1 --version-name 0.2.0-candidate "$BUILD/resources.zip"
find "$PROJECT/app/src/main/java" "$BUILD/generated" -name '*.java' -print0 | xargs -0 javac -encoding UTF-8 -source 11 -target 11 -cp "$PLATFORM" -d "$BUILD/classes"
jar cf "$BUILD/classes.jar" -C "$BUILD/classes" .
"$TOOLS/d8" --lib "$PLATFORM" --min-api 28 --output "$BUILD/dex" "$BUILD/classes.jar"
cp "$BUILD/base.apk" "$BUILD/with-dex.apk"
(cd "$BUILD/dex" && zip -q -u "$BUILD/with-dex.apk" classes.dex)
"$TOOLS/zipalign" -f 4 "$BUILD/with-dex.apk" "$BUILD/aligned.apk"

KEYSTORE="${YNX_ANDROID_TESTNET_KEYSTORE:-$PROJECT/testnet-signing/YNX_BROWSER_PUBLIC_TEST_ONLY.keystore}"
if [[ ! -f "$KEYSTORE" ]]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass android -alias ynxbrowserpreview -keypass android -dname "CN=YNX Browser Testnet Preview,O=YNX Development,C=CN" -keyalg RSA -keysize 3072 -validity 3650 >/dev/null 2>&1
fi
mkdir -p "$DIST"
"$TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-key-alias ynxbrowserpreview --ks-pass pass:android --key-pass pass:android --out "$DIST/YNX-Browser-Testnet-Preview-Android.apk" "$BUILD/aligned.apk"
"$TOOLS/apksigner" verify --verbose --print-certs "$DIST/YNX-Browser-Testnet-Preview-Android.apk"
shasum -a 256 "$DIST/YNX-Browser-Testnet-Preview-Android.apk"
echo "$DIST/YNX-Browser-Testnet-Preview-Android.apk"
