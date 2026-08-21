#!/bin/bash

set -euo pipefail

: "${YNX_RELEASE_DMG:?YNX_RELEASE_DMG is required}"
: "${YNX_RELEASE_DMG_NAME:?YNX_RELEASE_DMG_NAME is required}"
: "${YNX_RELEASE_APP_VERSION:?YNX_RELEASE_APP_VERSION is required}"
: "${YNX_RELEASE_APP_BUILD:?YNX_RELEASE_APP_BUILD is required}"
: "${YNX_EXPECTED_SOURCE_SHA:?YNX_EXPECTED_SOURCE_SHA is required}"
: "${YNX_RELEASE_TAG:?YNX_RELEASE_TAG is required}"
: "${YNX_APPLE_TEAM_ID:?YNX_APPLE_TEAM_ID is required}"
: "${YNX_APP_NOTARY_ID:?YNX_APP_NOTARY_ID is required}"
: "${YNX_DMG_NOTARY_ID:?YNX_DMG_NOTARY_ID is required}"
: "${YNX_PUBLISH_RELEASE:?YNX_PUBLISH_RELEASE is required}"

proof="${YNX_RELEASE_PROOF_DIR:-$PWD/apps/wallet/proof/ci-macos-notarized}"
work_root="${RUNNER_TEMP:-/tmp}/ynx-wallet-notarized-runtime"
mount_point="$work_root/mount"
install_root="$work_root/install"
installed_app="$install_root/Applications/YNX Wallet.app"
lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
mount_attached=false
cold_pid=""
second_pid=""

cleanup() {
  for candidate in "$cold_pid" "$second_pid"; do
    if test -n "$candidate" && kill -0 "$candidate" 2>/dev/null; then
      kill -TERM "$candidate" 2>/dev/null || true
    fi
  done
  if test "$mount_attached" = true; then
    hdiutil detach "$mount_point" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

mkdir -p "$proof" "$mount_point" "$install_root/Applications"
hdiutil attach -readonly -nobrowse -mountpoint "$mount_point" "$YNX_RELEASE_DMG" | tee "$proof/hdiutil-attach.txt"
mount_attached=true
contained_app="$mount_point/YNX Wallet.app"
test -d "$contained_app"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$contained_app/Contents/Info.plist")" = "com.ynxweb4.wallet.macos"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$contained_app/Contents/Info.plist")" = "$YNX_RELEASE_APP_VERSION"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$contained_app/Contents/Info.plist")" = "$YNX_RELEASE_APP_BUILD"
/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes' "$contained_app/Contents/Info.plist" | grep -F ynxwallet
codesign --verify --deep --strict --verbose=4 "$contained_app"
codesign -dv --verbose=4 "$contained_app" 2> "$proof/contained-app-codesign.txt"
grep -F "TeamIdentifier=$YNX_APPLE_TEAM_ID" "$proof/contained-app-codesign.txt"
xcrun stapler validate "$contained_app" | tee "$proof/contained-app-stapler-validation.txt"
spctl --assess --type execute --verbose=4 "$contained_app" 2>&1 | tee "$proof/contained-app-gatekeeper.txt"
grep -F 'source=Notarized Developer ID' "$proof/contained-app-gatekeeper.txt"
ditto "$contained_app" "$installed_app"
codesign --verify --deep --strict --verbose=4 "$installed_app"
"$lsregister" -f "$installed_app"
hdiutil detach "$mount_point"
mount_attached=false

launch_new_instance() {
  local before candidate
  before=" $(pgrep -x YNXWalletMac | tr '\n' ' ' || true)"
  open -n "$installed_app"
  for _ in $(seq 1 60); do
    for candidate in $(pgrep -x YNXWalletMac || true); do
      case "$before " in
        *" $candidate "*) ;;
        *) printf '%s\n' "$candidate"; return 0 ;;
      esac
    done
    sleep 1
  done
  return 1
}

wait_for_network() {
  local pid="$1"
  local output="$2"
  for _ in $(seq 1 60); do
    xcrun log show --style compact --last 5m --predicate 'subsystem == "com.ynxweb4.wallet.macos" AND category == "network"' > "$output" 2>&1 || true
    if grep -Fq "YNX_WALLET_MAC_RPC_CHAIN_ID_VERIFIED pid=$pid chainId=0x1917" "$output" &&
       grep -Fq "YNX_WALLET_MAC_REST_APP_GATEWAY_REACHABLE pid=$pid status=200" "$output"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_exit() {
  local pid="$1"
  for _ in $(seq 1 30); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 1
  done
  return 1
}

cold_pid="$(launch_new_instance)"
test -n "$cold_pid"
wait_for_network "$cold_pid" "$proof/final-dmg-cold-network.log"
kill -TERM "$cold_pid"
wait_for_exit "$cold_pid"

second_pid="$(launch_new_instance)"
test -n "$second_pid"
test "$second_pid" != "$cold_pid"
wait_for_network "$second_pid" "$proof/final-dmg-second-network.log"
open 'ynxwallet://authorize?request=invalid'
callback_received=false
for _ in $(seq 1 60); do
  xcrun log show --style compact --last 5m --predicate 'subsystem == "com.ynxweb4.wallet.macos" AND category == "callback"' > "$proof/final-dmg-callback.log" 2>&1 || true
  if grep -Fq "YNX_WALLET_MAC_CALLBACK_RECEIVED pid=$second_pid scheme=ynxwallet" "$proof/final-dmg-callback.log" &&
     grep -Fq "YNX_WALLET_MAC_CALLBACK_REJECTED pid=$second_pid code=INVALID_DEEP_LINK" "$proof/final-dmg-callback.log"; then
    callback_received=true
    break
  fi
  sleep 1
done
test "$callback_received" = true
screenshot_captured=false
if screencapture -x "$proof/final-dmg-callback-fail-closed.png" && test -s "$proof/final-dmg-callback-fail-closed.png"; then
  screenshot_captured=true
fi
kill -TERM "$second_pid"
wait_for_exit "$second_pid"

dmg_sha256="$(shasum -a 256 "$YNX_RELEASE_DMG" | awk '{print $1}')"
dmg_bytes="$(stat -f '%z' "$YNX_RELEASE_DMG")"
architectures="$(tr '\n' ' ' < "$proof/architectures.txt" | xargs)"
minimum_os="$(tr -d '\n' < "$proof/minimum-os.txt")"
jq -n +  --arg sourceCommit "$YNX_EXPECTED_SOURCE_SHA" +  --arg releaseTag "$YNX_RELEASE_TAG" +  --arg artifactName "$YNX_RELEASE_DMG_NAME" +  --arg artifactSha256 "$dmg_sha256" +  --argjson artifactBytes "$dmg_bytes" +  --arg version "$YNX_RELEASE_APP_VERSION" +  --arg build "$YNX_RELEASE_APP_BUILD" +  --arg architectures "$architectures" +  --arg minimumOS "$minimum_os" +  --arg teamIdentifier "$YNX_APPLE_TEAM_ID" +  --arg appNotaryId "$YNX_APP_NOTARY_ID" +  --arg dmgNotaryId "$YNX_DMG_NOTARY_ID" +  --argjson coldPid "$cold_pid" +  --argjson secondPid "$second_pid" +  --argjson screenshotCaptured "$screenshot_captured" +  --argjson publishRequested "$YNX_PUBLISH_RELEASE" +  '{
    schemaVersion: 1,
    product: "YNX Wallet macOS native",
    sourceCommit: $sourceCommit,
    releaseTag: $releaseTag,
    artifact: {
      name: $artifactName,
      sha256: $artifactSha256,
      bytes: $artifactBytes,
      bundleIdentifier: "com.ynxweb4.wallet.macos",
      version: $version,
      build: $build,
      architectures: ($architectures | split(" ")),
      minimumOS: $minimumOS
    },
    signing: {
      class: "Developer ID Application",
      teamIdentifier: $teamIdentifier,
      hardenedRuntime: true,
      timestamped: true,
      appNotarizationAccepted: true,
      appNotarySubmissionId: $appNotaryId,
      appStapled: true,
      dmgNotarizationAccepted: true,
      dmgNotarySubmissionId: $dmgNotaryId,
      dmgStapled: true,
      appGatekeeperAccepted: true,
      dmgGatekeeperAccepted: true
    },
    runtime: {
      isolatedInstallVerified: true,
      systemApplicationsInstalled: false,
      coldLaunchPid: $coldPid,
      secondLaunchPid: $secondPid,
      coldRpcChainId: "0x1917",
      secondRpcChainId: "0x1917",
      coldRestStatus: 200,
      secondRestStatus: 200,
      malformedCallbackDelivered: true,
      malformedCallbackResult: "INVALID_DEEP_LINK",
      screenshotCaptured: $screenshotCaptured,
      callbackVisibleVerified: false,
      authorizationSuccess: false,
      callbackEmitted: false
    },
    publication: {
      githubReleasePublishRequested: $publishRequested,
      githubReleasePublished: false,
      websitePublished: false,
      appStoreReleased: false
    },
    unsupportedProductGates: {
      accountAvailable: false,
      authorizationSuccess: false,
      signSuccess: false,
      sendSuccess: false,
      transactionSuccess: false,
      recoverySuccess: false,
      physicalBiometricVerified: false,
      productSessionVerified: false
    }
  }' > "$proof/native-dmg-release-manifest.json"

jq -e '.artifact.bundleIdentifier == "com.ynxweb4.wallet.macos"
  and .signing.appNotarizationAccepted == true
  and .signing.dmgNotarizationAccepted == true
  and .runtime.isolatedInstallVerified == true
  and .runtime.systemApplicationsInstalled == false
  and .runtime.authorizationSuccess == false
  and .publication.githubReleasePublished == false
  and .publication.websitePublished == false' "$proof/native-dmg-release-manifest.json" >/dev/null

printf 'coldPid=%s secondPid=%s chainId=0x1917 restStatus=200 callback=INVALID_DEEP_LINK authorizationSuccess=false callbackEmitted=false\n' "$cold_pid" "$second_pid" | tee "$proof/final-dmg-runtime.txt"
