#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
root="$PWD/.ynx-developer-local"
app="$root/YNX Developer Local.app"
rm -rf "$root"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
/usr/bin/swiftc desktop/macos/main.swift -o "$app/Contents/MacOS/YNXDeveloper" -framework Cocoa -framework WebKit
cp desktop/macos/Info.plist "$app/Contents/Info.plist"
cp desktop/server.mjs "$app/Contents/Resources/server.mjs"
cp -R dist "$app/Contents/Resources/web"
"$app/Contents/MacOS/YNXDeveloper" --self-test
signature=$(/usr/bin/codesign -dv --verbose=4 "$app" 2>&1 || true)
if ! grep -Fq 'Signature=adhoc' <<<"$signature" || ! grep -Fq 'TeamIdentifier=not set' <<<"$signature"; then
  echo "Refusing local-package classification: expected only linker ad-hoc signing with no team identity." >&2
  exit 1
fi
/usr/bin/ditto -c -k --keepParent "$app" "$root/ynx-developer-local-macos-unsigned.zip"
/usr/bin/shasum -a 256 "$root/ynx-developer-local-macos-unsigned.zip"
echo "Built local macOS package with linker ad-hoc signature and no team identity. This is not a Developer ID signed production desktop release."
