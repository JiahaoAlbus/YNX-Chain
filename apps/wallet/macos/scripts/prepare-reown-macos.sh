#!/usr/bin/env bash
set -euo pipefail

package_root="${1:?package root is required}"
scratch_path="${2:-$package_root/.build}"
expected_commit="968a82d440e51c4de18857928b60a03d36af7a2a"
expected_blob="34b299ee3b325f26536980d272e0e7f906fe2869"
relative_source="Sources/WalletConnectSign/Auth/Link/LinkEnvelopesDispatcher.swift"
checkout="$scratch_path/checkouts/reown-swift"

if ! test -d "$checkout/.git"; then
  swift package --package-path "$package_root" --scratch-path "$scratch_path" resolve
fi
test "$(git -C "$checkout" rev-parse HEAD)" = "$expected_commit"

if grep -Fq "MODIFIED BY YNX WALLET" "$checkout/$relative_source"; then
  grep -Fq "import Foundation" "$checkout/$relative_source"
  exit 0
fi

test "$(git -C "$checkout" hash-object "$relative_source")" = "$expected_blob"
chmod u+w "$checkout/$relative_source"
ruby -e '
  path = ARGV.fetch(0)
  source = File.read(path)
  needle = <<~SWIFT.chomp
    #if os(iOS)
    import UIKit
    #endif

    import Combine
  SWIFT
  replacement = <<~SWIFT.chomp
    #if os(iOS)
    import UIKit
    #elseif os(macOS)
    import AppKit
    #endif

    import Combine
    // MODIFIED BY YNX WALLET: Reown Swift 2.3.1 declares macOS support, but this
    // file only obtains Foundation and a URL opener through UIKit on iOS. Import
    // Foundation directly and use NSWorkspace for its declared macOS target.
    import Foundation
  SWIFT
  abort "unexpected Reown source structure" unless source.scan(needle).length == 1
  source = source.sub(needle, replacement)
  opener = "UIApplication.shared.open(envelopeUrl, options: [.universalLinksOnly: true]) { success in"
  abort "unexpected Reown URL opener structure" unless source.scan(opener).length == 2
  source = source.gsub(opener, "openUniversalLink(envelopeUrl) { success in")
  helper_anchor = <<~SWIFT.chomp
        func isRunningTests() -> Bool {
  SWIFT
  helper = <<~SWIFT.chomp
        private func openUniversalLink(_ url: URL, completion: @escaping (Bool) -> Void) {
    #if os(iOS)
            UIApplication.shared.open(url, options: [.universalLinksOnly: true], completionHandler: completion)
    #elseif os(macOS)
            completion(NSWorkspace.shared.open(url))
    #else
            completion(false)
    #endif
        }

        func isRunningTests() -> Bool {
  SWIFT
  abort "unexpected Reown helper anchor" unless source.scan(helper_anchor).length == 1
  File.write(path, source.sub(helper_anchor, helper))
' "$checkout/$relative_source"
grep -Fq "MODIFIED BY YNX WALLET" "$checkout/$relative_source"
grep -Fq "import Foundation" "$checkout/$relative_source"
