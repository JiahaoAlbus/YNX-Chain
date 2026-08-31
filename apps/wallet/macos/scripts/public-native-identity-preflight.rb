#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "fileutils"
require "json"
require "open3"
require "optparse"
require "tmpdir"

options = {
  expected_bundle_id: "com.ynxweb4.wallet.macos",
  expected_scheme: "ynxwallet",
  require_owner_identity: false
}

OptionParser.new do |parser|
  parser.on("--artifact PATH") { |value| options[:artifact] = value }
  parser.on("--expected-sha256 SHA256") { |value| options[:expected_sha256] = value.downcase }
  parser.on("--expected-bytes BYTES", Integer) { |value| options[:expected_bytes] = value }
  parser.on("--expected-bundle-id BUNDLE_ID") { |value| options[:expected_bundle_id] = value }
  parser.on("--expected-scheme SCHEME") { |value| options[:expected_scheme] = value }
  parser.on("--require-owner-identity") { options[:require_owner_identity] = true }
end.parse!

def capture(*argv)
  stdout, stderr, status = Open3.capture3(*argv)
  [stdout, stderr, status.exitstatus]
end

def bounded_text(stdout, stderr)
  [stdout, stderr].join("\n").strip.gsub(/\s+/, " ")[0, 500]
end

artifact = options[:artifact] && File.expand_path(options[:artifact])
abort "--artifact must name an existing regular file" unless artifact && File.file?(artifact)
abort "--expected-sha256 must be 64 lowercase hex characters" unless options[:expected_sha256]&.match?(/\A[0-9a-f]{64}\z/)
abort "--expected-bytes must be positive" unless options[:expected_bytes]&.positive?
abort "--expected-bundle-id is invalid" unless options[:expected_bundle_id].match?(/\A[A-Za-z0-9.-]+\z/)
abort "--expected-scheme is invalid" unless options[:expected_scheme].match?(/\A[a-z][a-z0-9+.-]*\z/)

actual_bytes = File.size(artifact)
actual_sha256 = Digest::SHA256.file(artifact).hexdigest
bytes_match = actual_bytes == options[:expected_bytes]
sha256_match = actual_sha256 == options[:expected_sha256]

verify_stdout, verify_stderr, verify_exit = capture("/usr/bin/hdiutil", "verify", artifact)

result = {
  schemaVersion: 1,
  evidenceKind: "macos-public-native-identity-install-preflight",
  artifact: {
    name: File.basename(artifact),
    bytes: actual_bytes,
    sha256: actual_sha256,
    expectedBytes: options[:expected_bytes],
    expectedSha256: options[:expected_sha256],
    bytesMatch: bytes_match,
    sha256Match: sha256_match,
    hdiutilVerify: verify_exit.zero?,
    hdiutilVerifyExit: verify_exit
  },
  expectedOwnerIdentity: {
    bundleIdentifier: options[:expected_bundle_id],
    customScheme: options[:expected_scheme]
  },
  operations: {
    readOnlyMountAttempted: false,
    applicationCopied: false,
    applicationInstalled: false,
    applicationLaunched: false,
    signingAttempted: false,
    runtimeLeaseRequested: false
  }
}

Dir.mktmpdir("ynx-wallet-public-preflight-") do |directory|
  mount = File.join(directory, "mount")
  Dir.mkdir(mount)
  attach_stdout, attach_stderr, attach_exit = capture(
    "/usr/bin/hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", mount, artifact
  )
  result[:operations][:readOnlyMountAttempted] = true
  result[:mount] = {
    attached: attach_exit.zero?,
    attachExit: attach_exit,
    attachOutputRecorded: false,
    detached: false
  }

  begin
    raise "read-only DMG attach failed" unless attach_exit.zero?

    applications = Dir.children(mount)
      .select { |name| name.end_with?(".app") && File.directory?(File.join(mount, name)) }
      .sort
    raise "expected exactly one top-level application, found #{applications.length}" unless applications.length == 1

    application = File.join(mount, applications.fetch(0))
    info_plist = File.join(application, "Contents", "Info.plist")
    raise "contained application Info.plist is missing" unless File.file?(info_plist)

    plist_stdout, plist_stderr, plist_exit = capture("/usr/bin/plutil", "-convert", "json", "-o", "-", info_plist)
    raise "contained application Info.plist is unreadable: #{bounded_text(plist_stdout, plist_stderr)}" unless plist_exit.zero?
    plist = JSON.parse(plist_stdout)

    url_schemes = Array(plist["CFBundleURLTypes"]).flat_map do |entry|
      entry.is_a?(Hash) ? Array(entry["CFBundleURLSchemes"]) : []
    end.select { |value| value.is_a?(String) }.uniq.sort

    executable_name = plist["CFBundleExecutable"]
    executable = executable_name && File.join(application, "Contents", "MacOS", executable_name)
    executable_present = executable && File.file?(executable)
    arch_stdout, arch_stderr, arch_exit = executable_present ? capture("/usr/bin/lipo", "-archs", executable) : ["", "missing executable", 1]
    architectures = arch_exit.zero? ? arch_stdout.split.sort : []

    codesign_stdout, codesign_stderr, codesign_exit = capture("/usr/bin/codesign", "--verify", "--deep", "--strict", application)
    spctl_stdout, spctl_stderr, spctl_exit = capture("/usr/sbin/spctl", "--assess", "--type", "execute", "--verbose=4", application)

    bundle_match = plist["CFBundleIdentifier"] == options[:expected_bundle_id]
    scheme_match = url_schemes.include?(options[:expected_scheme])
    owner_identity_match = bundle_match && scheme_match

    result[:containedApplication] = {
      name: File.basename(application),
      bundleIdentifier: plist["CFBundleIdentifier"],
      shortVersion: plist["CFBundleShortVersionString"],
      bundleVersion: plist["CFBundleVersion"],
      minimumOS: plist["LSMinimumSystemVersion"],
      executablePresent: !!executable_present,
      architectures: architectures,
      customSchemes: url_schemes
    }
    result[:identityComparison] = {
      bundleIdentifierMatches: bundle_match,
      customSchemeRegistered: scheme_match,
      ownerNativeIdentityMatches: owner_identity_match
    }
    result[:signingAssessment] = {
      strictDeepCodesignVerified: codesign_exit.zero?,
      strictDeepCodesignExit: codesign_exit,
      strictDeepCodesignResult: bounded_text(codesign_stdout, codesign_stderr).gsub(application, "<MOUNTED_APP>"),
      gatekeeperAccepted: spctl_exit.zero?,
      gatekeeperExit: spctl_exit,
      gatekeeperResult: bounded_text(spctl_stdout, spctl_stderr).gsub(application, "<MOUNTED_APP>")
    }
    result[:preflight] = {
      artifactIntegrityVerified: bytes_match && sha256_match && verify_exit.zero?,
      ownerNativeIdentityVerified: owner_identity_match,
      eligibleSignedInstallCandidate: owner_identity_match && codesign_exit.zero? && spctl_exit.zero?,
      passed: bytes_match && sha256_match && verify_exit.zero? && owner_identity_match
    }
  ensure
    detach_stdout, detach_stderr, detach_exit = capture("/usr/bin/hdiutil", "detach", mount)
    result[:mount][:detached] = detach_exit.zero?
    result[:mount][:detachExit] = detach_exit
    result[:mount][:detachOutputRecorded] = false
  end
end

puts JSON.pretty_generate(result)
exit 3 if options[:require_owner_identity] && !result.dig(:preflight, :passed)
