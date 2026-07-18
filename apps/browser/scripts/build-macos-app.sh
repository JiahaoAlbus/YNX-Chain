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
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ROOT/dist/macos/YNX-Browser-Testnet-Preview-macOS.zip"
shasum -a 256 "$ROOT/dist/macos/YNX-Browser-Testnet-Preview-macOS.zip"
