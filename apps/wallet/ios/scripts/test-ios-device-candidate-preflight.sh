#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFLIGHT="${SCRIPT_DIR}/ios-device-candidate-preflight.rb"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ynx-ios-device-preflight.XXXXXX")"
trap 'rm -rf "${TEMP_ROOT}"' EXIT

make_fixture() {
  local app="$1"
  local bundle_id="$2"
  local scheme="$3"
  local platform="$4"
  local dt_platform="$5"

  mkdir -p "${app}"
  cp /usr/bin/true "${app}/YNXWallet"
  /usr/bin/plutil -create xml1 "${app}/Info.plist"
  /usr/bin/plutil -insert CFBundleExecutable -string YNXWallet "${app}/Info.plist"
  /usr/bin/plutil -insert CFBundleIdentifier -string "${bundle_id}" "${app}/Info.plist"
  /usr/bin/plutil -insert CFBundleShortVersionString -string 0.1.0 "${app}/Info.plist"
  /usr/bin/plutil -insert CFBundleVersion -string 1 "${app}/Info.plist"
  /usr/bin/plutil -insert MinimumOSVersion -string 17.0 "${app}/Info.plist"
  /usr/bin/plutil -insert DTPlatformName -string "${dt_platform}" "${app}/Info.plist"
  /usr/bin/plutil -insert CFBundleSupportedPlatforms -array "${app}/Info.plist"
  /usr/bin/plutil -insert CFBundleSupportedPlatforms.0 -string "${platform}" "${app}/Info.plist"
  /usr/bin/plutil -insert CFBundleURLTypes -array "${app}/Info.plist"
  /usr/bin/plutil -insert CFBundleURLTypes.0 -dictionary "${app}/Info.plist"
  /usr/bin/plutil -insert CFBundleURLTypes.0.CFBundleURLSchemes -array "${app}/Info.plist"
  /usr/bin/plutil -insert CFBundleURLTypes.0.CFBundleURLSchemes.0 -string "${scheme}" "${app}/Info.plist"
}

assert_json() {
  local file="$1"
  local ruby_expression="$2"
  /usr/bin/ruby -rjson -e 'document = JSON.parse(File.read(ARGV.fetch(0))); abort "assertion failed" unless eval(ARGV.fetch(1))' \
    "${file}" "${ruby_expression}"
}

SIMULATOR_APP="${TEMP_ROOT}/Simulator.app"
DEVICE_SHAPED_APP="${TEMP_ROOT}/DeviceShaped.app"
WRONG_IDENTITY_APP="${TEMP_ROOT}/WrongIdentity.app"
make_fixture "${SIMULATOR_APP}" com.ynxweb4.wallet ynxwallet iPhoneSimulator iphonesimulator
make_fixture "${DEVICE_SHAPED_APP}" com.ynxweb4.wallet ynxwallet iPhoneOS iphoneos
make_fixture "${WRONG_IDENTITY_APP}" com.example.other otherwallet iPhoneOS iphoneos

/usr/bin/ruby "${PREFLIGHT}" --app "${SIMULATOR_APP}" > "${TEMP_ROOT}/simulator.json"
assert_json "${TEMP_ROOT}/simulator.json" 'document.dig("identityComparison", "ownerNativeIdentityMatches") == true'
assert_json "${TEMP_ROOT}/simulator.json" 'document.dig("platformAssessment", "simulatorPlatform") == true'
assert_json "${TEMP_ROOT}/simulator.json" 'document.dig("preflight", "eligibleSignedPhysicalInstallCandidate") == false'

/usr/bin/ruby "${PREFLIGHT}" --app "${DEVICE_SHAPED_APP}" > "${TEMP_ROOT}/device-shaped.json"
assert_json "${TEMP_ROOT}/device-shaped.json" 'document.dig("platformAssessment", "physicalDevicePlatform") == true'
assert_json "${TEMP_ROOT}/device-shaped.json" 'document.dig("signingAssessment", "embeddedProvisioningProfilePresent") == false'
assert_json "${TEMP_ROOT}/device-shaped.json" 'document.dig("preflight", "eligibleSignedPhysicalInstallCandidate") == false'
assert_json "${TEMP_ROOT}/device-shaped.json" 'document.dig("signingAssessment", "protectedEntitlementValuesRecorded") == false'

/usr/bin/ruby "${PREFLIGHT}" --app "${WRONG_IDENTITY_APP}" > "${TEMP_ROOT}/wrong-identity.json"
assert_json "${TEMP_ROOT}/wrong-identity.json" 'document.dig("identityComparison", "ownerNativeIdentityMatches") == false'

if /usr/bin/ruby "${PREFLIGHT}" --app "${DEVICE_SHAPED_APP}" --require-device-candidate > /dev/null 2>&1; then
  echo "expected unsigned device-shaped fixture to fail the required gate" >&2
  exit 1
else
  status=$?
  test "${status}" -eq 3
fi

assert_json "${TEMP_ROOT}/device-shaped.json" 'document.dig("operations", "applicationInstalled") == false'
assert_json "${TEMP_ROOT}/device-shaped.json" 'document.dig("operations", "applicationLaunched") == false'
assert_json "${TEMP_ROOT}/device-shaped.json" 'document.dig("operations", "signingAttempted") == false'
assert_json "${TEMP_ROOT}/device-shaped.json" 'document.dig("operations", "runtimeLeaseRequested") == false'

echo "iOS physical-device signing candidate preflight tests passed"
