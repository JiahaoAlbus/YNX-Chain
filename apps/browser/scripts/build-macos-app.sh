#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
swift build -c release --package-path "$ROOT/native"
APP="$ROOT/dist/macos/YNX Browser Testnet Preview.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT/native/.build/release/YNXBrowserNative" "$APP/Contents/MacOS/YNXBrowserNative"
cp "$ROOT/native/AppBundle/Info.plist" "$APP/Contents/Info.plist"
codesign --force --sign - --timestamp=none "$APP"
codesign --verify --deep --strict "$APP"

# Normalize archive metadata and entry order so identical source bytes produce
# an identical local Testnet Preview ZIP. This does not change the ad-hoc
# signing class or imply notarization.
export TZ=UTC
find "$APP" -exec touch -h -t 202001010000 {} +
ZIP="$ROOT/dist/macos/YNX-Browser-Testnet-Preview-macOS.zip"
rm -f "$ZIP"
(
  cd "$(dirname "$APP")"
  find "$(basename "$APP")" -print | LC_ALL=C sort | zip -X -q "$ZIP" -@
)
unzip -tq "$ZIP"
shasum -a 256 "$ZIP"
