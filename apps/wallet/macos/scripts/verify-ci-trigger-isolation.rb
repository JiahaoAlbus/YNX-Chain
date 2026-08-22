#!/usr/bin/env ruby

root = File.expand_path("../../../../", __dir__)
ios_workflow = File.read(File.join(root, ".github/workflows/wallet-ios.yml"))
macos_workflow = File.read(File.join(root, ".github/workflows/wallet-macos.yml"))

ios_path_lines = ios_workflow.lines.grep(/^\s+paths:/)
abort "wallet-ios must define push and pull_request path filters" unless ios_path_lines.length == 2

ios_path_lines.each do |line|
  wallet_index = line.index('"apps/wallet/**"')
  macos_exclusion_index = line.index('"!apps/wallet/macos/**"')
  abort "wallet-ios path filter must include apps/wallet/**" unless wallet_index
  abort "wallet-ios path filter must exclude apps/wallet/macos/**" unless macos_exclusion_index
  abort "wallet-ios macOS exclusion must follow the broad Wallet include" unless macos_exclusion_index > wallet_index
end

abort "wallet-macos must own apps/wallet/macos changes" unless macos_workflow.include?('"apps/wallet/macos/**"')
abort "wallet-macos must run on the native owner branch" unless macos_workflow.include?("codex/wallet-ios-macos-20260813")

puts "wallet iOS/macOS CI trigger ownership verified"
