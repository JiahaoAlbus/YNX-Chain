#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "open3"
require "optparse"

options = {
  expected_bundle_id: "com.ynxweb4.wallet",
  expected_scheme: "ynxwallet",
  require_device_candidate: false
}

OptionParser.new do |parser|
  parser.on("--app PATH") { |value| options[:app] = value }
  parser.on("--expected-bundle-id BUNDLE_ID") { |value| options[:expected_bundle_id] = value }
  parser.on("--expected-scheme SCHEME") { |value| options[:expected_scheme] = value }
  parser.on("--require-device-candidate") { options[:require_device_candidate] = true }
end.parse!

def capture(*argv)
  stdout, stderr, status = Open3.capture3(*argv)
  [stdout, stderr, status.exitstatus]
end

def bounded_text(stdout, stderr, application)
  [stdout, stderr]
    .join("\n")
    .strip
    .gsub(application, "<APPLICATION>")
    .gsub(/\s+/, " ")[0, 500]
end

def present_array?(value)
  value.is_a?(Array) && !value.empty?
end

application = options[:app] && File.expand_path(options[:app])
abort "--app must name an existing .app directory" unless application&.end_with?(".app") && File.directory?(application)
abort "--expected-bundle-id is invalid" unless options[:expected_bundle_id].match?(/\A[A-Za-z0-9.-]+\z/)
abort "--expected-scheme is invalid" unless options[:expected_scheme].match?(/\A[a-z][a-z0-9+.-]*\z/)

info_plist = File.join(application, "Info.plist")
abort "application Info.plist is missing" unless File.file?(info_plist)

plist_stdout, plist_stderr, plist_exit = capture("/usr/bin/plutil", "-convert", "json", "-o", "-", info_plist)
abort "application Info.plist is unreadable: #{bounded_text(plist_stdout, plist_stderr, application)}" unless plist_exit.zero?
plist = JSON.parse(plist_stdout)

url_schemes = Array(plist["CFBundleURLTypes"]).flat_map do |entry|
  entry.is_a?(Hash) ? Array(entry["CFBundleURLSchemes"]) : []
end.select { |value| value.is_a?(String) }.uniq.sort

executable_name = plist["CFBundleExecutable"]
executable = executable_name && File.join(application, executable_name)
executable_present = executable && File.file?(executable)
arch_stdout, arch_stderr, arch_exit = executable_present ? capture("/usr/bin/lipo", "-archs", executable) : ["", "missing executable", 1]
architectures = arch_exit.zero? ? arch_stdout.split.sort : []

supported_platforms = Array(plist["CFBundleSupportedPlatforms"])
  .select { |value| value.is_a?(String) }
  .uniq
  .sort
platform_name = plist["DTPlatformName"]
device_platform = platform_name == "iphoneos" || supported_platforms.include?("iPhoneOS")
simulator_platform = platform_name == "iphonesimulator" || supported_platforms.include?("iPhoneSimulator")

codesign_stdout, codesign_stderr, codesign_exit = capture(
  "/usr/bin/codesign", "--verify", "--deep", "--strict", application
)
entitlements_stdout, entitlements_stderr, entitlements_exit = capture(
  "/usr/bin/codesign", "-d", "--entitlements", ":-", application
)

entitlements = {}
entitlements_parsed = false
if entitlements_exit.zero? && entitlements_stdout.include?("<plist")
  json_stdout, _json_stderr, json_exit = Open3.capture3(
    "/usr/bin/plutil", "-convert", "json", "-o", "-", "--", "-",
    stdin_data: entitlements_stdout
  )
  if json_exit.success?
    entitlements = JSON.parse(json_stdout)
    entitlements_parsed = entitlements.is_a?(Hash)
  end
end

bundle_match = plist["CFBundleIdentifier"] == options[:expected_bundle_id]
scheme_match = url_schemes.include?(options[:expected_scheme])
owner_identity_match = bundle_match && scheme_match
embedded_profile_present = File.file?(File.join(application, "embedded.mobileprovision"))
arm64_present = architectures.include?("arm64")
application_identifier_present = entitlements["application-identifier"].is_a?(String) && !entitlements["application-identifier"].empty?
team_identifier_present = entitlements["com.apple.developer.team-identifier"].is_a?(String) && !entitlements["com.apple.developer.team-identifier"].empty?
keychain_groups_present = present_array?(entitlements["keychain-access-groups"])
application_groups_present = present_array?(entitlements["com.apple.security.application-groups"])

eligible = owner_identity_match &&
  device_platform &&
  !simulator_platform &&
  arm64_present &&
  codesign_exit.zero? &&
  entitlements_parsed &&
  embedded_profile_present &&
  application_identifier_present &&
  team_identifier_present &&
  keychain_groups_present &&
  application_groups_present

result = {
  schemaVersion: 1,
  evidenceKind: "ios-physical-device-signing-candidate-preflight",
  expectedOwnerIdentity: {
    bundleIdentifier: options[:expected_bundle_id],
    customScheme: options[:expected_scheme]
  },
  application: {
    name: File.basename(application),
    bundleIdentifier: plist["CFBundleIdentifier"],
    shortVersion: plist["CFBundleShortVersionString"],
    bundleVersion: plist["CFBundleVersion"],
    minimumOS: plist["MinimumOSVersion"],
    platformName: platform_name,
    supportedPlatforms: supported_platforms,
    executablePresent: !!executable_present,
    architectures: architectures,
    customSchemes: url_schemes
  },
  identityComparison: {
    bundleIdentifierMatches: bundle_match,
    customSchemeRegistered: scheme_match,
    ownerNativeIdentityMatches: owner_identity_match
  },
  platformAssessment: {
    physicalDevicePlatform: device_platform,
    simulatorPlatform: simulator_platform,
    arm64Present: arm64_present
  },
  signingAssessment: {
    strictDeepCodesignVerified: codesign_exit.zero?,
    strictDeepCodesignExit: codesign_exit,
    strictDeepCodesignResult: bounded_text(codesign_stdout, codesign_stderr, application),
    entitlementsReadBack: entitlements_parsed,
    entitlementsReadBackExit: entitlements_exit,
    applicationIdentifierPresent: application_identifier_present,
    teamIdentifierPresent: team_identifier_present,
    keychainAccessGroupsPresent: keychain_groups_present,
    applicationGroupsPresent: application_groups_present,
    getTaskAllow: entitlements.key?("get-task-allow") ? entitlements["get-task-allow"] == true : nil,
    embeddedProvisioningProfilePresent: embedded_profile_present,
    protectedEntitlementValuesRecorded: false
  },
  preflight: {
    ownerNativeIdentityVerified: owner_identity_match,
    eligibleSignedPhysicalInstallCandidate: eligible,
    passed: eligible
  },
  operations: {
    applicationInstalled: false,
    applicationLaunched: false,
    signingAttempted: false,
    provisioningProfileDecoded: false,
    runtimeLeaseRequested: false
  }
}

puts JSON.pretty_generate(result)
exit 3 if options[:require_device_candidate] && !eligible
