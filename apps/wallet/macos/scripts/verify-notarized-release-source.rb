#!/usr/bin/env ruby

require "yaml"

root = File.expand_path("../../../../", __dir__)
workflow_path = File.join(root, ".github/workflows/wallet-macos-notarized-release.yml")
probe_path = File.join(root, "apps/wallet/macos/scripts/verify-notarized-dmg.sh")

YAML.load_file(workflow_path)
workflow = File.read(workflow_path)
probe = File.read(probe_path)

uses = workflow.scan(/^\s*-\s+uses:\s+([^\s#]+)/).flatten
mutable = uses.reject { |use| use.start_with?("./") || use.match?(/@[0-9a-f]{40}$/) }
abort "mutable GitHub Actions: #{mutable.join(", ")}" unless mutable.empty?

workflow_requirements = [
  "workflow_dispatch:",
  "environment: wallet-macos-production",
  "test \"$YNX_APPLE_TEAM_ID\" != FAKETEAMID",
  "EXPECTED_RELEASE_TAG=\"wallet-macos-notarized-v$APP_VERSION-${YNX_EXPECTED_SOURCE_SHA:0:8}\"",
  "notarytool-app.json",
  "notarytool-dmg.json",
  "stapler-app-validation.txt",
  "stapler-dmg-validation.txt",
  "gatekeeper-app.txt",
  "gatekeeper-dmg.txt",
  "YNX_ORIGINAL_KEYCHAINS_PATH",
  "security list-keychains -d user > \"$ORIGINAL_KEYCHAINS\"",
  "original_keychains=()",
  "security list-keychains -d user -s \"${original_keychains[@]}\"",
  "hdiutil create",
  "DMG-SHA256SUMS",
  "DMG-BYTES",
  "verify-notarized-dmg.sh",
  "native-dmg-release-manifest.json",
  "github-release-publication-receipt.json"
]

probe_requirements = [
  "hdiutil attach -readonly -nobrowse",
  "Print :CFBundleIdentifier",
  "com.ynxweb4.wallet.macos",
  "Print :CFBundleURLTypes",
  "grep -F ynxwallet",
  "codesign --verify --deep --strict",
  "source=Notarized Developer ID",
  "cold_pid=\"$(launch_new_instance)\"",
  "second_pid=\"$(launch_new_instance)\"",
  "YNX_WALLET_MAC_RPC_CHAIN_ID_VERIFIED",
  "YNX_WALLET_MAC_REST_APP_GATEWAY_REACHABLE",
  "open 'ynxwallet://authorize?request=invalid'",
  "YNX_WALLET_MAC_CALLBACK_REJECTED",
  "systemApplicationsInstalled: false",
  "callbackVisibleVerified: false",
  "authorizationSuccess: false",
  "callbackEmitted: false",
  "githubReleasePublished: false",
  "websitePublished: false",
  "appStoreReleased: false",
  "productSessionVerified: false"
]

missing_workflow = workflow_requirements.reject { |value| workflow.include?(value) }
missing_probe = probe_requirements.reject { |value| probe.include?(value) }
abort "missing notarized workflow semantics: #{missing_workflow.join(", ")}" unless missing_workflow.empty?
abort "missing final DMG probe semantics: #{missing_probe.join(", ")}" unless missing_probe.empty?

puts "wallet macOS notarized native DMG source contract verified"
