#!/usr/bin/env ruby

require "yaml"

root = File.expand_path("../../../../", __dir__)
workflow_path = File.join(root, ".github/workflows/wallet-ios-production-distribution.yml")
cleanup_path = File.join(root, "apps/wallet/ios/scripts/cleanup-distribution-material.sh")
project_path = File.join(root, "apps/wallet/ios/YNXWallet.xcodeproj/project.pbxproj")
info_path = File.join(root, "apps/wallet/ios/YNXWallet/Info.plist")
entitlements_path = File.join(root, "apps/wallet/ios/YNXWallet/YNXWallet.entitlements")
simulator_workflow_path = File.join(root, ".github/workflows/wallet-ios.yml")

YAML.load_file(workflow_path)
workflow = File.read(workflow_path)
cleanup = File.read(cleanup_path)
project = File.read(project_path)
info = File.read(info_path)
entitlements = File.read(entitlements_path)
simulator_workflow = File.read(simulator_workflow_path)

uses = workflow.scan(/^\s*-\s+uses:\s+([^\s#]+)/).flatten
mutable = uses.reject { |use| use.start_with?("./") || use.match?(/@[0-9a-f]{40}$/) }
abort "mutable GitHub Actions: #{mutable.join(", ")}" unless mutable.empty?

workflow_requirements = [
  "workflow_dispatch:",
  "environment: wallet-ios-production",
  "cleanup-runtime:",
  "Prove distribution material cleanup without production credentials",
  "iosDistributionCleanupRuntime=true",
  "productionCredentialsUsed=false",
  'test "${{ github.ref }}" = refs/heads/main',
  "test \"$YNX_APPLE_TEAM_ID\" != FAKETEAMID",
  "Apple Distribution:",
  "YNX_IOS_DISTRIBUTION_P12_BASE64",
  "YNX_IOS_PROVISIONING_PROFILE_BASE64",
  "YNX_ASC_PRIVATE_KEY_P8_BASE64",
  "YNX_ASC_PRIVATE_KEY_UPLOAD_COPY_PATH",
  "security cms -D -i",
  "application-identifier",
  "com.apple.developer.associated-domains",
  "get-task-allow",
  "beta-reports-active",
  "Print :ProvisionedDevices",
  "Print :ProvisionsAllDevices",
  "xcodebuild -workspace ios/YNXWallet.xcworkspace",
  "-destination 'generic/platform=iOS'",
  "-exportArchive",
  "method -string app-store-connect",
  "Add :provisioningProfiles:com.ynxweb4.wallet",
  "codesign --verify --deep --strict",
  "ruby apps/wallet/ios/scripts/ios-device-candidate-preflight.rb",
  "--app \"$APP\" --require-device-candidate",
  "ios-physical-device-candidate-preflight.json",
  "CODESIGN_INSPECTION=\"$RUNNER_TEMP/ynx-ios-codesign-inspection.txt\"",
  "ENTITLEMENTS_INSPECTION=\"$RUNNER_TEMP/ynx-ios-entitlements-inspection.plist\"",
  "PROFILE_INSPECTION=\"$RUNNER_TEMP/ynx-ios-profile-inspection.plist\"",
  "Signature=adhoc",
  "xcrun altool --upload-app",
  "appStoreConnectUploadSubmitted:false",
  "testFlightProcessingVerified:false",
  "appStoreReleased:false",
  "physicalDeviceInstalled:false",
  "universalLinkVerified:false",
  "authorizationSuccess:false",
  "signSuccess:false",
  "sendSuccess:false",
  "bash apps/wallet/ios/scripts/cleanup-distribution-material.sh"
]

cleanup_requirements = [
  "set -euo pipefail",
  "original_keychains=()",
  "security list-keychains -d user -s \"${original_keychains[@]}\"",
  "cmp -s \"$YNX_IOS_ORIGINAL_KEYCHAINS_PATH\" <(security list-keychains -d user)",
  "security delete-keychain \"$YNX_IOS_SIGNING_KEYCHAIN\"",
  "YNX_IOS_PROFILE_INSTALLED_PATH",
  "YNX_ASC_PRIVATE_KEY_PATH",
  "YNX_ASC_PRIVATE_KEY_UPLOAD_COPY_PATH"
]

missing_workflow = workflow_requirements.reject { |value| workflow.include?(value) }
missing_cleanup = cleanup_requirements.reject { |value| cleanup.include?(value) }
abort "missing iOS production workflow semantics: #{missing_workflow.join(", ")}" unless missing_workflow.empty?
abort "missing iOS distribution cleanup semantics: #{missing_cleanup.join(", ")}" unless missing_cleanup.empty?
abort "codesign identity inspection must not be persisted in proof artifacts" if workflow.include?('$PROOF/codesign.txt')
abort "raw entitlement inspection must not be persisted in proof artifacts" if workflow.include?('$PROOF/entitlements.plist')
abort "raw provisioning profile inspection must not be persisted in proof artifacts" if workflow.include?('$PROOF/embedded-profile.plist')
abort "frozen iOS bundle identifier missing" unless project.include?('PRODUCT_BUNDLE_IDENTIFIER = "com.ynxweb4.wallet";')
abort "frozen iOS deployment target missing" unless project.include?("IPHONEOS_DEPLOYMENT_TARGET = 16.4;")
abort "ynxwallet callback scheme missing" unless info.include?("<string>ynxwallet</string>")
abort "associated domains remain unauthorized" if entitlements.include?("com.apple.developer.associated-domains")

simulator_path_lines = simulator_workflow.lines.grep(/^\s+paths:/)
abort "wallet-ios must define push and pull_request path filters" unless simulator_path_lines.length == 2
release_only_exclusions = [
  '"!apps/wallet/ios/scripts/cleanup-distribution-material.sh"',
  '"!apps/wallet/ios/scripts/verify-production-distribution-source.rb"',
  '"!apps/wallet/ios/scripts/ios-device-candidate-preflight.rb"',
  '"!apps/wallet/ios/scripts/test-ios-device-candidate-preflight.sh"'
]
simulator_path_lines.each do |line|
  release_only_exclusions.each do |exclusion|
    abort "wallet-ios must exclude release-only source path #{exclusion}" unless line.include?(exclusion)
  end
end

puts "wallet iOS production distribution source contract verified"
