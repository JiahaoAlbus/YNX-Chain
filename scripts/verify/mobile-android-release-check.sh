#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
work="$(mktemp -d)"
output="tmp/packages/mobile-android-release-test"
trap 'rm -rf "$work" "$output" "$output.tampered"' EXIT
rm -rf "$output" "$output.tampered"
install -d -m 0700 "$work/custody"
printf '%s\n' 'ynx-disposable-release-check-2026' >"$work/custody/store-password"
printf '%s\n' 'ynx-disposable-release-check-2026' >"$work/custody/key-password"
chmod 0600 "$work/custody/store-password" "$work/custody/key-password"
export YNX_CHECK_STORE_PASSWORD='ynx-disposable-release-check-2026'
export YNX_CHECK_KEY_PASSWORD='ynx-disposable-release-check-2026'
keytool -genkeypair \
  -keystore "$work/custody/release-test.p12" \
  -storetype PKCS12 \
  -storepass:env YNX_CHECK_STORE_PASSWORD \
  -keypass:env YNX_CHECK_KEY_PASSWORD \
  -alias ynx-release-test \
  -keyalg RSA \
  -keysize 2048 \
  -validity 30 \
  -dname 'CN=YNX Disposable Release Check, OU=Build Verification, O=YNX Chain, C=SG' >/dev/null
chmod 0600 "$work/custody/release-test.p12"
unset YNX_CHECK_STORE_PASSWORD YNX_CHECK_KEY_PASSWORD

if YNX_ANDROID_RELEASE_MODE=owner-approved \
  YNX_ANDROID_KEYSTORE_PATH="$work/custody/release-test.p12" \
  YNX_ANDROID_KEYSTORE_TYPE=PKCS12 \
  YNX_ANDROID_KEY_ALIAS=ynx-release-test \
  YNX_ANDROID_STORE_PASSWORD_FILE="$work/custody/store-password" \
  YNX_ANDROID_KEY_PASSWORD_FILE="$work/custody/key-password" \
  bash scripts/package/mobile-android-release.sh "$output.owner-unapproved" >/dev/null 2>&1; then
  echo "mobile Android release package accepted owner mode without explicit approval" >&2
  exit 1
fi

YNX_ANDROID_RELEASE_MODE=test-only \
YNX_ANDROID_KEYSTORE_PATH="$work/custody/release-test.p12" \
YNX_ANDROID_KEYSTORE_TYPE=PKCS12 \
YNX_ANDROID_KEY_ALIAS=ynx-release-test \
YNX_ANDROID_STORE_PASSWORD_FILE="$work/custody/store-password" \
YNX_ANDROID_KEY_PASSWORD_FILE="$work/custody/key-password" \
bash scripts/package/mobile-android-release.sh "$output"

node scripts/verify/mobile-android-release-verify.mjs "$output" test-only
if rg -n 'ynx-disposable-release-check|release-test\.p12|/var/folders/|/Users/' "$output"; then
  echo "mobile Android release package leaked a credential or local path" >&2
  exit 1
fi

cp -R "$output" "$output.tampered"
printf 'tamper' >>"$output.tampered/ynx-mobile-android.apk"
if node scripts/verify/mobile-android-release-verify.mjs "$output.tampered" test-only >/dev/null 2>&1; then
  echo "mobile Android release verifier accepted a modified APK" >&2
  exit 1
fi
cp "$output/ynx-mobile-android.apk" "$output.tampered/ynx-mobile-android.apk"
node - "$output.tampered/manifest.json" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
manifest.productionSigningApproved = true;
fs.writeFileSync(process.argv[2], `${JSON.stringify(manifest, null, 2)}\n`);
NODE
if node scripts/verify/mobile-android-release-verify.mjs "$output.tampered" test-only >/dev/null 2>&1; then
  echo "mobile Android release verifier accepted a false production-signing claim" >&2
  exit 1
fi
cp "$output/manifest.json" "$output.tampered/manifest.json"
node - "$output.tampered/manifest.json" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
manifest.sourceCommit = "0000000000000000000000000000000000000000";
fs.writeFileSync(process.argv[2], `${JSON.stringify(manifest, null, 2)}\n`);
NODE
if node scripts/verify/mobile-android-release-verify.mjs "$output.tampered" test-only >/dev/null 2>&1; then
  echo "mobile Android release verifier accepted a false source commit" >&2
  exit 1
fi

echo "mobile-android-release-check passed: externally signed test-only APK/AAB, exact provenance, no credential leakage, and tamper/false-claim/source rejection"
