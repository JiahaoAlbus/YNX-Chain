#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
root="$PWD/.ynx-developer-local"
app="$root/YNX Developer Testnet Preview.app"
rm -rf "$root"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
temporary_binary="$root/YNXDeveloper.selftest"
/usr/bin/swiftc desktop/macos/main.swift -o "$temporary_binary" -framework Cocoa -framework WebKit
cp desktop/macos/Info.plist "$app/Contents/Info.plist"
cp desktop/server.mjs "$app/Contents/Resources/server.mjs"
cp -R dist "$app/Contents/Resources/web"
"$temporary_binary" --self-test "$app/Contents/Resources"
mv "$temporary_binary" "$app/Contents/MacOS/YNXDeveloper"
/usr/bin/xattr -cr "$app"
/usr/bin/codesign --force --deep --sign - "$app"
signature=$(/usr/bin/codesign -dv --verbose=4 "$app" 2>&1 || true)
if ! grep -Fq 'Signature=adhoc' <<<"$signature" || ! grep -Fq 'TeamIdentifier=not set' <<<"$signature"; then
  echo "Refusing local-package classification: expected only linker ad-hoc signing with no team identity." >&2
  exit 1
fi
/usr/bin/ditto -c -k --keepParent "$app" "$root/ynx-developer-testnet-preview-macos-unsigned.zip"
/usr/bin/shasum -a 256 "$root/ynx-developer-testnet-preview-macos-unsigned.zip"
echo "Built unsigned macOS Testnet Preview with linker ad-hoc signature and no team identity. This is not a Developer ID signed production desktop release."
