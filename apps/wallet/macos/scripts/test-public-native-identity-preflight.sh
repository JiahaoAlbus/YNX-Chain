#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
preflight="$script_dir/public-native-identity-preflight.rb"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/ynx-wallet-preflight-test.XXXXXX")"
mount_root="$fixture_root/mount"
trap 'hdiutil detach "$mount_root" >/dev/null 2>&1 || true; rm -rf "$fixture_root"' EXIT

make_fixture() {
  local bundle_id="$1"
  local scheme="$2"
  local source_root="$fixture_root/source"
  local app="$source_root/YNX Wallet.app"
  rm -rf "$source_root"
  mkdir -p "$app/Contents/MacOS"
  cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>YNXWalletMac</string>
  <key>CFBundleIdentifier</key><string>${bundle_id}</string>
  <key>CFBundleName</key><string>YNX Wallet</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.0.0-fixture</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>CFBundleURLTypes</key><array><dict>
    <key>CFBundleURLSchemes</key><array><string>${scheme}</string></array>
  </dict></array>
</dict></plist>
PLIST
  printf '#!/bin/sh\nexit 0\n' > "$app/Contents/MacOS/YNXWalletMac"
  chmod 755 "$app/Contents/MacOS/YNXWalletMac"
}

run_preflight() {
  local dmg="$1"
  local output="$2"
  local bytes sha
  bytes="$(wc -c < "$dmg" | tr -d ' ')"
  sha="$(shasum -a 256 "$dmg" | awk '{print $1}')"
  ruby "$preflight" --artifact "$dmg" --expected-bytes "$bytes" --expected-sha256 "$sha" > "$output"
}

make_fixture com.ynxweb4.wallet.macos ynxwallet
matching_dmg="$fixture_root/matching.dmg"
hdiutil create -quiet -format UDZO -srcfolder "$fixture_root/source" "$matching_dmg"
run_preflight "$matching_dmg" "$fixture_root/matching.json"
ruby -rjson -e '
  result = JSON.parse(File.read(ARGV.fetch(0)))
  abort unless result.dig("preflight", "artifactIntegrityVerified") == true
  abort unless result.dig("preflight", "ownerNativeIdentityVerified") == true
  abort unless result.dig("preflight", "eligibleSignedInstallCandidate") == false
  abort unless result.dig("operations", "applicationInstalled") == false
  abort unless result.dig("operations", "applicationLaunched") == false
  abort unless result.dig("operations", "signingAttempted") == false
  abort unless result.dig("mount", "detached") == true
' "$fixture_root/matching.json"

make_fixture com.ynxweb4.wallet.desktop otherwallet
mismatched_dmg="$fixture_root/mismatched.dmg"
hdiutil create -quiet -format UDZO -srcfolder "$fixture_root/source" "$mismatched_dmg"
run_preflight "$mismatched_dmg" "$fixture_root/mismatched.json"
ruby -rjson -e '
  result = JSON.parse(File.read(ARGV.fetch(0)))
  abort unless result.dig("preflight", "artifactIntegrityVerified") == true
  abort unless result.dig("identityComparison", "bundleIdentifierMatches") == false
  abort unless result.dig("identityComparison", "customSchemeRegistered") == false
  abort unless result.dig("preflight", "ownerNativeIdentityVerified") == false
  abort unless result.dig("preflight", "passed") == false
' "$fixture_root/mismatched.json"

set +e
ruby "$preflight" \
  --artifact "$mismatched_dmg" \
  --expected-bytes "$(wc -c < "$mismatched_dmg" | tr -d ' ')" \
  --expected-sha256 "$(shasum -a 256 "$mismatched_dmg" | awk '{print $1}')" \
  --require-owner-identity >/dev/null
status=$?
set -e
test "$status" -eq 3

printf 'public native identity preflight tests PASS\n'
