#!/usr/bin/env bash
set -euo pipefail

wallet_root="$(cd "$(dirname "$0")/.." && pwd -P)"
repo_root="$(cd "$wallet_root/../.." && pwd -P)"
output="${1:-}"

[[ -n "$output" && "$output" == /* ]] || { echo "usage: $0 /absolute/output/directory" >&2; exit 2; }
case "$output/" in "$repo_root/"*) echo "QA output must remain outside the Git repository" >&2; exit 2 ;; esac
[[ ! -e "$output" ]] || { echo "QA output already exists: $output" >&2; exit 2; }
[[ -z "$(git -C "$repo_root" status --porcelain)" ]] || { echo "disposable QA build requires a clean Git worktree" >&2; exit 2; }
[[ -d "$wallet_root/node_modules" ]] || { echo "Wallet dependencies are missing; run: npm ci --offline --prefix apps/wallet" >&2; exit 2; }

android_home="${ANDROID_HOME:-/Users/huangjiahao/Library/Android/sdk}"
java_home="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
build_tools="$android_home/build-tools/36.0.0"
[[ -d "$android_home/platforms/android-36" ]] || { echo "Android SDK platform 36 is required" >&2; exit 2; }
[[ -x "$build_tools/apksigner" && -x "$build_tools/aapt" ]] || { echo "Android build-tools 36.0.0 are required" >&2; exit 2; }
[[ -x "$java_home/bin/java" && -x "$java_home/bin/keytool" ]] || { echo "Android Studio Java runtime is required" >&2; exit 2; }

if [[ -d /private/tmp ]]; then
  custody="$(mktemp -d /private/tmp/ynx-wallet-disposable-qa-custody.XXXXXX)"
else
  temp_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
  [[ -d "$temp_root" ]] || { echo "QA temporary root is missing: $temp_root" >&2; exit 2; }
  custody="$(mktemp -d "$temp_root/ynx-wallet-disposable-qa-custody.XXXXXX")"
fi
partial="${output}.partial.$$"
cleanup() {
  chmod -R u+rwX "$custody" "$partial" 2>/dev/null || true
  /bin/rm -rf -- "$custody" "$partial"
}
trap cleanup EXIT INT TERM
chmod 0700 "$custody"

store_password_file="$custody/store-password"
keystore="$custody/wallet-disposable-qa.p12"
alias_name="ynx-wallet-disposable-qa"
openssl rand -base64 48 | tr -d '\n' >"$store_password_file"
printf '\n' >>"$store_password_file"
chmod 0600 "$store_password_file"
export YNX_QA_STORE_PASSWORD="$(<"$store_password_file")"
# PKCS12 requires the private key and store to use the same password. Reuse
# the single high-entropy disposable secret instead of passing a key password
# that keytool would silently ignore and Gradle could not decrypt.
export YNX_QA_KEY_PASSWORD="$YNX_QA_STORE_PASSWORD"
"$java_home/bin/keytool" -genkeypair -noprompt \
  -storetype PKCS12 -keystore "$keystore" -storepass:env YNX_QA_STORE_PASSWORD \
  -keypass:env YNX_QA_KEY_PASSWORD -alias "$alias_name" -keyalg RSA -keysize 3072 \
  -validity 30 -dname 'CN=YNX Wallet Disposable QA,OU=Android API 36 Verification,O=YNX Chain,C=SG' >/dev/null
chmod 0600 "$keystore"

source_commit="$(git -C "$repo_root" rev-parse HEAD)"
gradle_network_args=(--offline)
if [[ "${YNX_QA_ALLOW_GRADLE_NETWORK:-0}" == "1" ]]; then
  gradle_network_args=()
fi
(
  cd "$wallet_root/android"
  ANDROID_HOME="$android_home" ANDROID_SDK_ROOT="$android_home" JAVA_HOME="$java_home" \
  NODE_ENV=production CI=1 EXPO_NO_TELEMETRY=1 JAVA_TOOL_OPTIONS=--enable-native-access=ALL-UNNAMED \
  YNX_ANDROID_KEYSTORE_PATH="$keystore" YNX_ANDROID_KEYSTORE_TYPE=PKCS12 \
  YNX_ANDROID_KEY_ALIAS="$alias_name" YNX_ANDROID_STORE_PASSWORD="$YNX_QA_STORE_PASSWORD" \
  YNX_ANDROID_KEY_PASSWORD="$YNX_QA_KEY_PASSWORD" \
  ./gradlew "${gradle_network_args[@]}" --no-daemon --console=plain --max-workers=1 \
    -Pkotlin.compiler.execution.strategy=in-process -PreactNativeArchitectures=arm64-v8a \
    -Pandroid.enableMinifyInReleaseBuilds=true -Pandroid.enableShrinkResourcesInReleaseBuilds=true \
    :app:assembleRelease
)
unset YNX_QA_STORE_PASSWORD YNX_QA_KEY_PASSWORD

apk_source="$wallet_root/android/app/build/outputs/apk/release/app-release.apk"
[[ -s "$apk_source" ]] || { echo "signed Wallet QA APK is missing" >&2; exit 1; }
signing_output="$($build_tools/apksigner verify --verbose --print-certs "$apk_source")"
printf '%s\n' "$signing_output" | grep -Fqx 'Verifies'
printf '%s\n' "$signing_output" | grep -Fqx 'Verified using v2 scheme (APK Signature Scheme v2): true'
cert_sha="$(printf '%s\n' "$signing_output" | awk -F': ' '/Signer #1 certificate SHA-256 digest:/{print tolower($2); exit}')"
cert_dn="$(printf '%s\n' "$signing_output" | sed -n 's/^Signer #1 certificate DN: //p' | head -1)"
[[ "$cert_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "APK signer certificate digest is invalid" >&2; exit 1; }
[[ "$cert_dn" == *"CN=YNX Wallet Disposable QA"* ]] || { echo "APK signer is not the disposable Wallet QA identity" >&2; exit 1; }

badging="$($build_tools/aapt dump badging "$apk_source")"
manifest_tree="$($build_tools/aapt dump xmltree "$apk_source" AndroidManifest.xml)"
package_name="$(printf '%s\n' "$badging" | sed -n "s/^package: name='\([^']*\)'.*/\1/p" | head -1)"
version_code="$(printf '%s\n' "$badging" | sed -n "s/^package:.*versionCode='\([^']*\)'.*/\1/p" | head -1)"
version_name="$(printf '%s\n' "$badging" | sed -n "s/^package:.*versionName='\([^']*\)'.*/\1/p" | head -1)"
minimum_sdk="$(printf '%s\n' "$badging" | sed -n "s/^sdkVersion:'\([^']*\)'.*/\1/p" | head -1)"
target_sdk="$(printf '%s\n' "$badging" | sed -n "s/^targetSdkVersion:'\([^']*\)'.*/\1/p" | head -1)"
[[ "$package_name" == "com.ynxweb4.wallet" && "$version_code" == "2" && "$version_name" == "1.0.1" ]] || { echo "Wallet package/version identity mismatch" >&2; exit 1; }
[[ "$minimum_sdk" == "24" && "$target_sdk" == "36" ]] || { echo "Wallet SDK boundary mismatch" >&2; exit 1; }
[[ "$(printf '%s\n' "$manifest_tree" | grep -Fc 'android:scheme(0x01010027)="ynxwallet"')" == "3" ]] || { echo "Wallet APK must expose exactly three host-bound ynxwallet routes" >&2; exit 1; }
for route in authorize action open; do
  [[ "$(printf '%s\n' "$manifest_tree" | grep -Fc "android:host(0x01010028)=\"$route\"")" == "1" ]] || { echo "Wallet APK is missing its exact $route route" >&2; exit 1; }
done
printf '%s\n' "$manifest_tree" | grep -Fq 'android:name(0x01010003)="android.intent.category.DEFAULT"'
printf '%s\n' "$manifest_tree" | grep -Fq 'android:name(0x01010003)="android.intent.category.BROWSABLE"'

install -d -m 0700 "$partial"
install -m 0644 "$apk_source" "$partial/ynx-wallet-1.0.1-api36-disposable-qa.apk"
YNX_QA_OUTPUT="$partial" YNX_QA_SOURCE_COMMIT="$source_commit" YNX_QA_CERT_SHA="$cert_sha" \
node --input-type=module <<'NODE'
import {createHash} from "node:crypto";
import {readFile, stat, writeFile} from "node:fs/promises";
import path from "node:path";
const output=process.env.YNX_QA_OUTPUT;
const apk=path.join(output,"ynx-wallet-1.0.1-api36-disposable-qa.apk");
const bytes=(await stat(apk)).size;
const sha256=createHash("sha256").update(await readFile(apk)).digest("hex");
const manifest={
  schemaVersion:1, artifactType:"wallet-android-disposable-qa-release", sourceCommit:process.env.YNX_QA_SOURCE_COMMIT,
  package:"com.ynxweb4.wallet", versionName:"1.0.1", versionCode:2, minimumOS:"Android API 24",
  compileSdk:36, targetSdk:36, abi:"arm64-v8a", apk:{name:path.basename(apk),bytes,sha256},
  signingClass:"disposable-qa-release-key", signerCertificateSha256:process.env.YNX_QA_CERT_SHA,
  apkSignatureSchemeV2:true, keyValidityDays:30, installedLocal:false, productionSigned:false, storeReleased:false,
  secretMaterialRecorded:false,
};
await writeFile(path.join(output,"manifest.json"),`${JSON.stringify(manifest,null,2)}\n`,{mode:0o644});
NODE
mv "$partial" "$output"
trap - EXIT INT TERM
chmod -R u+rwX "$custody" 2>/dev/null || true
/bin/rm -rf -- "$custody"
printf 'wallet disposable QA release ready: %s\n' "$output/ynx-wallet-1.0.1-api36-disposable-qa.apk"
printf 'manifest: %s\n' "$output/manifest.json"
