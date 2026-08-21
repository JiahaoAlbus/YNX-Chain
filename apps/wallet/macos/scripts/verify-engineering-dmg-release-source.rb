#!/usr/bin/env ruby

require "yaml"

root = File.expand_path("../../../../", __dir__)
workflow_path = File.join(root, ".github/workflows/wallet-macos.yml")
YAML.load_file(workflow_path)
workflow = File.read(workflow_path)

requirements = [
  "publish_engineering_dmg:",
  "environment: wallet-macos-engineering-publication",
  "test \"${{ github.ref }}\" = refs/heads/main",
  "test \"$YNX_EXPECTED_SOURCE_SHA\" = \"$GITHUB_SHA\"",
  "wallet-macos-native-ad-hoc-dmg-${YNX_EXPECTED_SOURCE_SHA:0:8}",
  "gh run download \"$GITHUB_RUN_ID\" --name ynx-wallet-macos-native",
  "YNX-Wallet-macOS-ad-hoc.dmg",
  "DMG-SHA256SUMS",
  "DMG-BYTES",
  "gatekeeperAccepted=false",
  "signingClass=ad-hoc",
  "gh release create",
  "--prerelease",
  "not Developer ID signed",
  "not notarized",
  "rejected by Gatekeeper"
]

missing = requirements.reject { |value| workflow.include?(value) }
abort "missing engineering DMG publication source semantics: #{missing.join(", ")}" unless missing.empty?

puts "wallet macOS engineering DMG publication source contract verified"
