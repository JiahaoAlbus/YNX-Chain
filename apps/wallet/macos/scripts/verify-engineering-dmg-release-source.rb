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
  "Public Applications",
  "PUBLIC_COLD_PID",
  "PUBLIC_SECOND_PID",
  "YNX_WALLET_MAC_RPC_CHAIN_ID_VERIFIED pid=$PUBLIC_COLD_PID chainId=0x1917",
  "YNX_WALLET_MAC_RPC_CHAIN_ID_VERIFIED pid=$PUBLIC_SECOND_PID chainId=0x1917",
  "YNX_WALLET_MAC_CALLBACK_RECEIVED pid=$PUBLIC_SECOND_PID scheme=ynxwallet",
  "YNX_WALLET_MAC_CALLBACK_REJECTED pid=$PUBLIC_SECOND_PID code=INVALID_DEEP_LINK",
  "anonymous-public-callback-fail-closed.png",
  "isolatedInstall=true systemApplicationsInstalled=false browserQuarantineAccepted=false",
  "SYSTEM_APP=\"/Applications/YNX Wallet.app\"",
  "sudo ditto \"$PUBLIC_INSTALLED_APP\" \"$SYSTEM_APP\"",
  "xattr -p com.apple.quarantine",
  "SYSTEM_COLD_PID",
  "SYSTEM_SECOND_PID",
  "YNX_WALLET_MAC_RPC_CHAIN_ID_VERIFIED pid=$SYSTEM_COLD_PID chainId=0x1917",
  "YNX_WALLET_MAC_RPC_CHAIN_ID_VERIFIED pid=$SYSTEM_SECOND_PID chainId=0x1917",
  "YNX_WALLET_MAC_CALLBACK_RECEIVED pid=$SYSTEM_SECOND_PID scheme=ynxwallet",
  "system-applications-callback-fail-closed.png",
  "systemApplicationsInstalled=true installedPath=/Applications/YNX%%20Wallet.app ephemeralHostedRunner=true browserQuarantinePresent=false",
  "publicRepository=true anonymousDownload=true exactSource=true",
  "websitePublished=false",
  "not Developer ID signed",
  "not notarized",
  "rejected by Gatekeeper"
]

missing = requirements.reject { |value| workflow.include?(value) }
abort "missing engineering DMG publication source semantics: #{missing.join(", ")}" unless missing.empty?

puts "wallet macOS engineering DMG publication source contract verified"
