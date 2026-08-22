#!/usr/bin/env bash
set -euo pipefail

package_root="${1:?package root is required}"
scratch_path="${2:-$package_root/.build}"
expected_commit="968a82d440e51c4de18857928b60a03d36af7a2a"
expected_blob="34b299ee3b325f26536980d272e0e7f906fe2869"
relative_source="Sources/WalletConnectSign/Auth/Link/LinkEnvelopesDispatcher.swift"
checkout="$scratch_path/checkouts/reown-swift"

swift package --package-path "$package_root" --scratch-path "$scratch_path" resolve
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
  needle = "import Combine\n\nfinal class LinkEnvelopesDispatcher {"
  replacement = <<~SWIFT.chomp
    import Combine
    // MODIFIED BY YNX WALLET: Reown Swift 2.3.1 declares macOS support, but this
    // file only obtains Foundation through UIKit on iOS. Import Foundation directly
    // so its URL, Data, Date and ProcessInfo uses compile on macOS/Xcode 26.3.
    import Foundation

    final class LinkEnvelopesDispatcher {
  SWIFT
  abort "unexpected Reown source structure" unless source.scan(needle).length == 1
  File.write(path, source.sub(needle, replacement))
' "$checkout/$relative_source"
grep -Fq "MODIFIED BY YNX WALLET" "$checkout/$relative_source"
grep -Fq "import Foundation" "$checkout/$relative_source"
