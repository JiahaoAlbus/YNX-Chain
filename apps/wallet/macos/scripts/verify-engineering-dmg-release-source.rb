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
  "YNX-Wallet-macOS-ad-hoc.manifest.json",
  "sourceCommit: ENV.fetch(\"YNX_EXPECTED_SOURCE_SHA\")",
  "testnetEngineeringArtifact: true",
  "developerIDSigned: false",
  "gatekeeperAccepted: false",
  "websitePublished: false",
  "false_gates.values.all?",
  "gh release create",
  "--prerelease",
  "https://api.github.com/repos/${GITHUB_REPOSITORY}",
  "env -u GH_TOKEN -u GITHUB_TOKEN curl -fsSL",
  "for _ in $(seq 1 15)",
  "YNX-Wallet-macOS-ad-hoc.manifest.json\") | .url",
  "https://github.com/${GITHUB_REPOSITORY}/releases/download/${RELEASE_TAG}/YNX-Wallet-macOS-ad-hoc.dmg",
  "--retry-all-errors",
  "PUBLIC_MANIFEST",
  "hdiutil verify \"$PUBLIC_DMG\"",
  "codesign --verify --deep --strict \"$PUBLIC_APP\"",
  "TeamIdentifier=not set",
  "publicRepository=true anonymousDownload=true exactSource=true",
  "websitePublished=false",
  "not Developer ID signed",
  "not notarized",
  "rejected by Gatekeeper"
]

missing = requirements.reject { |value| workflow.include?(value) }
abort "missing engineering DMG publication source semantics: #{missing.join(", ")}" unless missing.empty?

puts "wallet macOS engineering DMG publication source contract verified"
