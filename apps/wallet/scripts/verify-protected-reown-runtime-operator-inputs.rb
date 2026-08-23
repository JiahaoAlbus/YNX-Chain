#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "open3"

path = ARGV.fetch(0, "release/integration/wallet-protected-reown-runtime-operator-inputs.request.json")
request = JSON.parse(File.read(path))

abort "wrong schema" unless request.fetch("schemaVersion") == 1
abort "wrong owner" unless request.fetch("owner") == "walletconnect-runtime-successor"
abort "request cannot be active in source" unless request.fetch("executionLeaseIssued") == false
abort "secret values cannot be recorded" unless request.fetch("secretValuesRecorded") == false
abort "wrong protected environment" unless request.fetch("protectedEnvironment") == "wallet-native-walletconnect-runtime"

chain = request.fetch("runtimeContract").fetch("chain")
abort "chain contract changed" unless chain == {
  "caip2" => "eip155:6423",
  "hex" => "0x1917",
  "asset" => "YNXT",
  "rpc" => "https://rpc.ynxweb4.com/evm"
}
abort "runtime must default off" unless request.fetch("runtimeContract").fetch("defaultEnabled") == false

namespace = request.fetch("runtimeContract").fetch("namespace")
expected_methods = %w[
  eth_chainId
  eth_accounts
  eth_requestAccounts
  wallet_addEthereumChain
  wallet_switchEthereumChain
  personal_sign
  eth_signTypedData_v4
  eth_sendTransaction
]
expected_events = %w[accountsChanged chainChanged disconnect]
abort "namespace widened" unless namespace.fetch("chains") == ["eip155:6423"] &&
  namespace.fetch("methods") == expected_methods &&
  namespace.fetch("events") == expected_events

identity = request.fetch("runtimeContract").fetch("identity")
abort "YNX identity changed" unless identity == {
  "name" => "YNX Wallet",
  "rdns" => "com.ynx.wallet",
  "isYNXWallet" => true,
  "isMetaMask" => false,
  "customScheme" => "ynxwallet"
}

expected_inputs = %w[
  YNX_WALLETCONNECT_PROJECT_ID
  YNX_WALLETCONNECT_APP_GROUP
  YNX_WALLETCONNECT_KEYCHAIN_ACCESS_GROUP
  YNX_WALLETCONNECT_APPROVED_ACCOUNT_HANDLE
  YNX_WALLETCONNECT_TEST_TX_POLICY
  YNX_WALLETCONNECT_DAPP_FIRST_PARTY_ORIGIN
]
inputs = request.fetch("protectedInputs")
abort "protected inputs changed" unless inputs.map { |entry| entry.fetch("name") } == expected_inputs
abort "protected input promoted in source" unless inputs.all? { |entry| entry.fetch("satisfied") == false }
inputs.each do |entry|
  forbidden = entry.keys & %w[value secretValue address privateKey seed mnemonic password token projectId]
  abort "embedded protected value field: #{entry.fetch("name")}/#{forbidden.join(",")}" unless forbidden.empty?
end

expected_external = {
  "uniswap" => "https://app.uniswap.org",
  "opensea" => "https://opensea.io",
  "safe" => "https://app.safe.global"
}
external = request.fetch("allowedDAppOrigins").fetch("external").to_h do |entry|
  [entry.fetch("id"), entry.fetch("origin")]
end
abort "external DApp origins changed" unless external == expected_external
abort "first-party origin leaked or fabricated" unless request.fetch("allowedDAppOrigins")
  .fetch("firstParty").fetch("exactValueRecorded") == false

source = request.fetch("sourceBindings")
hardening = source.fetch("hardening")
abort "hardening source changed" unless hardening.fetch("commit") == "9f8e6aca883af7d31875e04ca01b8b20fac47892" &&
  hardening.fetch("tree") == "683a59ae5c80224cf6ec62f3567402c71e1078e2"

apple = source.fetch("apple")
android = source.fetch("android")
abort "Apple SDK changed" unless apple.fetch("reownSDK") == "reown-swift 2.3.1" &&
  apple.fetch("reownTagObject") == "968a82d440e51c4de18857928b60a03d36af7a2a"
abort "Android SDK changed" unless android.fetch("reownWalletKit") == "@reown/walletkit 1.5.6" &&
  android.fetch("walletConnectCore") == "@walletconnect/core 2.23.10" &&
  android.fetch("reactNativeCompat") == "@walletconnect/react-native-compat 2.23.10"

def git!(*args)
  output, error, status = Open3.capture3("git", *args)
  abort "git #{args.join(" ")} failed: #{error}" unless status.success?
  output
end

{
  apple.fetch("baselineCommit") => apple.fetch("paths"),
  android.fetch("baselineCommit") => android.fetch("paths")
}.each do |commit, paths|
  expected_tree = commit == apple.fetch("baselineCommit") ? apple.fetch("baselineTree") : android.fetch("baselineTree")
  abort "source tree mismatch for #{commit}" unless git!("rev-parse", "#{commit}^{tree}").strip == expected_tree
  paths.each { |source_path| git!("cat-file", "-e", "#{commit}:#{source_path}") }
end

android_package = git!("show", "#{android.fetch("baselineCommit")}:apps/wallet/package.json")
abort "Android Reown pin missing" unless android_package.include?('"@reown/walletkit": "1.5.6"') &&
  android_package.include?('"@walletconnect/core": "2.23.10"') &&
  android_package.include?('"@walletconnect/react-native-compat": "2.23.10"')
apple_resolved = git!("show", "#{apple.fetch("baselineCommit")}:apps/wallet/macos/Package.resolved")
abort "Apple Reown pin missing" unless apple_resolved.include?('"version" : "2.3.1"') &&
  apple_resolved.include?(apple.fetch("reownTagObject"))

targets = request.fetch("signedInstallTargets")
abort "signed target promoted" unless targets.values.all? { |entry| entry.fetch("satisfied") == false }
abort "wrong iOS bundle" unless targets.fetch("ios").fetch("bundleIdentifier") == "com.ynxweb4.wallet"
abort "wrong macOS bundle" unless targets.fetch("macos").fetch("bundleIdentifier") == "com.ynxweb4.wallet.macos"
abort "wrong Android package" unless targets.fetch("android").fetch("packageName") == "com.ynxweb4.wallet"

evidence = request.fetch("requiredEvidenceEnvelope")
abort "wrong evidence schema" unless evidence.fetch("schema") == "walletProtectedReownRuntimeEvidence@1"
abort "evidence promoted in request" unless evidence.fetch("requiredBooleans").values.all? { |value| value == false }
defaults = request.fetch("failClosedDefaults")
abort "fail-closed boolean promoted" unless defaults.reject { |key, _| %w[productsConnected productsMigratedV2].include?(key) }
  .values.all? { |value| value == false }
abort "product count promoted" unless defaults.fetch("productsConnected") == 0 && defaults.fetch("productsMigratedV2") == 0

serialized = JSON.generate(request)
abort "raw private material present" if serialized.match?(/-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/)

puts "wallet protected Reown runtime operator request verified"
puts "applePaths=#{apple.fetch("paths").length} androidPaths=#{android.fetch("paths").length} protectedInputs=#{inputs.length} runtime=false"
