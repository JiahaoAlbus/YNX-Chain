#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

mode="${YNX_ANDROID_RELEASE_MODE:-}"
output="${1:-tmp/packages/mobile-android-release}"
product="${YNX_MOBILE_PRODUCT:-integration}"
case "$mode" in
  test-only | owner-approved) ;;
  *) echo "YNX_ANDROID_RELEASE_MODE must be test-only or owner-approved" >&2; exit 1 ;;
esac
case "$product" in
  integration) package_name="com.ynxweb4.mobile" ;;
  social) package_name="com.ynxweb4.social" ;;
  wallet) package_name="com.ynxweb4.wallet" ;;
  *) echo "YNX_MOBILE_PRODUCT must be integration, social, or wallet" >&2; exit 1 ;;
esac

repo_root="$(pwd -P)"
absolute_path() {
  local path="$1" parent
  [[ "$path" == /* ]] || { echo "release credential paths must be absolute" >&2; exit 1; }
  parent="$(cd "$(dirname "$path")" && pwd -P)"
  printf '%s/%s\n' "$parent" "$(basename "$path")"
}
mode_of() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}
outside_repo() {
  case "$1/" in "$repo_root/"*) echo "release credentials must remain outside the Git repository" >&2; exit 1 ;; esac
}
read_secret() {
  local path="$1" value lines
  [[ -f "$path" && ! -L "$path" && -s "$path" ]] || { echo "release password file must be a non-empty regular file" >&2; exit 1; }
  [[ "$(mode_of "$path")" == 600 ]] || { echo "release password files must use mode 0600" >&2; exit 1; }
  lines="$(awk 'END { print NR }' "$path")"
  [[ "$lines" == 1 ]] || { echo "release password files must contain exactly one line" >&2; exit 1; }
  value="$(<"$path")"
  [[ -n "$value" ]] || { echo "release password must not be empty" >&2; exit 1; }
  printf '%s' "$value"
}

keystore="$(absolute_path "${YNX_ANDROID_KEYSTORE_PATH:-}")"
store_password_file="$(absolute_path "${YNX_ANDROID_STORE_PASSWORD_FILE:-}")"
key_password_file="$(absolute_path "${YNX_ANDROID_KEY_PASSWORD_FILE:-}")"
alias="${YNX_ANDROID_KEY_ALIAS:-}"
store_type="${YNX_ANDROID_KEYSTORE_TYPE:-PKCS12}"

outside_repo "$keystore"
outside_repo "$store_password_file"
outside_repo "$key_password_file"
[[ -f "$keystore" && ! -L "$keystore" && -s "$keystore" ]] || { echo "release keystore must be a non-empty regular file" >&2; exit 1; }
[[ "$(mode_of "$keystore")" == 600 ]] || { echo "release keystore must use mode 0600" >&2; exit 1; }
[[ "$alias" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || { echo "invalid Android release key alias" >&2; exit 1; }
[[ "$store_type" == PKCS12 || "$store_type" == JKS ]] || { echo "YNX_ANDROID_KEYSTORE_TYPE must be PKCS12 or JKS" >&2; exit 1; }

store_password="$(read_secret "$store_password_file")"
key_password="$(read_secret "$key_password_file")"
if [[ "$mode" == owner-approved ]]; then
  [[ "${YNX_MOBILE_RELEASE_APPROVED:-}" == yes ]] || { echo "owner-approved release requires YNX_MOBILE_RELEASE_APPROVED=yes" >&2; exit 1; }
  [[ -z "$(git status --porcelain)" ]] || { echo "owner-approved release requires a clean Git worktree" >&2; exit 1; }
fi
[[ ! -e "$output" ]] || { echo "release output already exists: $output" >&2; exit 1; }

if [[ -z "${ANDROID_HOME:-}" && -d /opt/homebrew/share/android-commandlinetools ]]; then
  export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
fi
[[ -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME/platforms" ]] || { echo "set ANDROID_HOME to an installed Android SDK" >&2; exit 1; }
if [[ -z "${JAVA_HOME:-}" && -x /usr/libexec/java_home ]]; then
  export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
fi
[[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" ]] || { echo "Java 17 is required" >&2; exit 1; }

export YNX_ANDROID_STORE_PASSWORD="$store_password"
export YNX_ANDROID_KEY_PASSWORD="$key_password"
keytool -list -keystore "$keystore" -storetype "$store_type" -storepass:env YNX_ANDROID_STORE_PASSWORD -alias "$alias" >/dev/null

(
  cd apps/mobile
  CI=1 EXPO_NO_TELEMETRY=1 YNX_MOBILE_PRODUCT="$product" EXPO_PUBLIC_YNX_PRODUCT="$product" npx expo prebuild --platform android --clean --no-install
  rg -q 'signingConfig ynxReleaseSigningConfigured \? signingConfigs\.release : null' android/app/build.gradle
  rg -q 'System\.getenv\("YNX_ANDROID_KEYSTORE_PATH"\)' android/app/build.gradle
  cd android
  YNX_ANDROID_KEYSTORE_PATH="$keystore" \
  YNX_ANDROID_KEYSTORE_TYPE="$store_type" \
  YNX_ANDROID_KEY_ALIAS="$alias" \
  YNX_MOBILE_PRODUCT="$product" \
  EXPO_PUBLIC_YNX_PRODUCT="$product" \
  NODE_ENV=production \
  ./gradlew --no-daemon --console=plain :app:bundleRelease :app:assembleRelease
)

aab_source=apps/mobile/android/app/build/outputs/bundle/release/app-release.aab
apk_source=apps/mobile/android/app/build/outputs/apk/release/app-release.apk
[[ -s "$aab_source" && -s "$apk_source" ]] || { echo "release APK/AAB outputs are missing" >&2; exit 1; }
unzip -tqq "$aab_source"
unzip -tqq "$apk_source"
jarsigner -verify -certs "$aab_source" | rg -q '^jar verified\.$'

apksigner="$(find "$ANDROID_HOME/build-tools" -type f -name apksigner -perm -111 | sort -V | tail -1)"
aapt="$(find "$ANDROID_HOME/build-tools" -type f -name aapt -perm -111 | sort -V | tail -1)"
[[ -x "$apksigner" && -x "$aapt" ]] || { echo "Android apksigner and aapt are required" >&2; exit 1; }
apk_signer_output="$($apksigner verify --verbose --print-certs "$apk_source")"
printf '%s\n' "$apk_signer_output" | rg -q '^Verifies$'
printf '%s\n' "$apk_signer_output" | rg -q '^Verified using v2 scheme \(APK Signature Scheme v2\): true$'
actual_package="$("$aapt" dump badging "$apk_source" | sed -n "s/^package: name='\([^']*\)'.*/\1/p" | head -1)"
[[ "$actual_package" == "$package_name" ]] || { echo "Android package identity mismatch: $actual_package" >&2; exit 1; }

aab_cert="$(keytool -printcert -jarfile "$aab_source" | awk -F': ' '/SHA256:/{gsub(":", "", $2); print tolower($2); exit}')"
apk_cert="$(printf '%s\n' "$apk_signer_output" | awk -F': ' '/Signer #1 certificate SHA-256 digest:/{print tolower($2); exit}')"
[[ "$aab_cert" =~ ^[0-9a-f]{64}$ && "$aab_cert" == "$apk_cert" ]] || { echo "APK/AAB signer certificate mismatch" >&2; exit 1; }

partial="${output}.partial.$$"
trap 'rm -rf "$partial"' EXIT
install -d -m 0755 "$partial"
install -m 0644 "$aab_source" "$partial/ynx-mobile-android.aab"
install -m 0644 "$apk_source" "$partial/ynx-mobile-android.apk"

YNX_RELEASE_OUTPUT="$partial" \
YNX_RELEASE_MODE="$mode" \
YNX_RELEASE_CERT_SHA="$aab_cert" \
YNX_RELEASE_PACKAGE_NAME="$package_name" \
node --input-type=module <<'NODE'
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFile, writeFile, stat} from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = process.env.YNX_RELEASE_OUTPUT;
const mode = process.env.YNX_RELEASE_MODE;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fileHash = async (file) => hash(await readFile(file));
const app = JSON.parse(await readFile("apps/mobile/app.json", "utf8"));
const tracked = execFileSync("git", ["ls-files", "-z", "apps/mobile"], {encoding: "buffer"})
  .toString("utf8").split("\0").filter(Boolean).sort();
const treeHash = createHash("sha256");
for (const file of tracked) {
  treeHash.update(file).update("\0").update(await fileHash(file)).update("\0");
}
const artifacts = [];
for (const [name, type] of [["ynx-mobile-android.aab", "android-app-bundle"], ["ynx-mobile-android.apk", "android-package"]]) {
  const file = path.join(output, name);
  artifacts.push({name, type, size: (await stat(file)).size, sha256: await fileHash(file)});
}
const dirty = execFileSync("git", ["status", "--porcelain"], {encoding: "utf8"}).trim().length > 0;
const manifest = {
  schema: "ynx-mobile-android-release/v1",
  releaseMode: mode,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {encoding: "utf8"}).trim(),
  sourceTreeDigest: treeHash.digest("hex"),
  sourceTreeDirty: dirty,
  packageName: process.env.YNX_RELEASE_PACKAGE_NAME,
  versionName: app.expo.version,
  versionCode: app.expo.android.versionCode,
  signerCertificateSHA256: process.env.YNX_RELEASE_CERT_SHA,
  canonicalLogoSHA256: await fileHash("assets/brand/ynx-logo.png"),
  productionSigningApproved: mode === "owner-approved",
  realDeviceVerified: false,
  storeSubmitted: false,
  storeAccepted: false,
  iosArtifactIncluded: false,
  artifacts,
};
await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {mode: 0o644});
NODE

mv "$partial" "$output"
trap - EXIT
unset YNX_ANDROID_STORE_PASSWORD YNX_ANDROID_KEY_PASSWORD store_password key_password
node scripts/verify/mobile-android-release-verify.mjs "$output" "$mode"
printf 'mobile Android release package ready: mode=%s output=%s signer=%s\n' "$mode" "$output" "$aab_cert"
