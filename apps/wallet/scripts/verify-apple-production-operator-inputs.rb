#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"

path = ARGV.fetch(0, "release/integration/wallet-apple-production-operator-inputs.request.json")
request = JSON.parse(File.read(path))

abort "wrong owner" unless request.fetch("owner") == "02-wallet-auth-ios-macos-native"
abort "wrong response channel" unless request.fetch("responseChannel") == "approved control plane or named release-owner handoff"

expected_environments = %w[wallet-ios-production wallet-macos-production]
environments = request.fetch("protectedEnvironments").map { |entry| entry.fetch("name") }
abort "protected environments changed" unless environments == expected_environments

expected_secret_names = %w[
  YNX_APPLE_TEAM_ID
  YNX_IOS_DISTRIBUTION_IDENTITY
  YNX_IOS_DISTRIBUTION_P12_BASE64
  YNX_IOS_DISTRIBUTION_P12_PASSWORD
  YNX_IOS_PROVISIONING_PROFILE_BASE64
  YNX_APP_STORE_CONNECT_KEY_ID
  YNX_APP_STORE_CONNECT_ISSUER_ID
  YNX_APP_STORE_CONNECT_PRIVATE_KEY_P8_BASE64
  YNX_MACOS_DEVELOPER_ID_APPLICATION
  YNX_MACOS_DEVELOPER_ID_P12_BASE64
  YNX_MACOS_DEVELOPER_ID_P12_PASSWORD
  YNX_APPLE_NOTARY_KEY_ID
  YNX_APPLE_NOTARY_ISSUER_ID
  YNX_APPLE_NOTARY_PRIVATE_KEY_P8_BASE64
].sort
provided_names = request.fetch("operatorInputs").flat_map do |entry|
  entry.fetch("provideThroughProtectedEnvironment", [])
end.sort
abort "protected input names changed" unless provided_names == expected_secret_names

serialized = JSON.generate(request)
abort "placeholder Team ID present" if serialized.include?("FAKETEAMID") && !serialized.include?("FAKETEAMID is rejected")
%w[value secretValue base64Value privateKey passwordValue].each do |key|
  abort "forbidden embedded credential field: #{key}" if request.to_s.match?(/\"#{Regexp.escape(key)}\"\s*=>/)
end

ios = request.fetch("operatorInputs").find { |entry| entry["id"] == "ios-app-store-distribution" }
abort "iOS input missing" unless ios
abort "wrong iOS bundle" unless ios.fetch("bundleIdentifier") == "com.ynxweb4.wallet"
profile = ios.fetch("profileContract")
abort "profile must fail closed" unless profile == {
  "distributionClass" => "App Store Connect",
  "explicitBundleIdentifier" => "com.ynxweb4.wallet",
  "getTaskAllow" => false,
  "betaReportsActive" => true,
  "provisionedDevicesPresent" => false,
  "provisionsAllDevicesPresent" => false,
  "associatedDomainsPresent" => false
}

link = request.fetch("universalLinkBoundary")
abort "Universal Link boundary widened" unless link.fetch("associatedDomainFrozenByCore") == false &&
  link.fetch("aasaComponentsFrozenByCore") == false &&
  link.fetch("requestedInThisDocument") == false

gates = request.fetch("currentGates")
abort "operator inputs cannot be satisfied in source" unless gates.values.all? { |value| value == false }

puts "wallet Apple production operator input request verified"
