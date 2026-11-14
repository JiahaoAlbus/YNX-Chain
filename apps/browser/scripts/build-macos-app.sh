#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
swift build -c release --package-path "$ROOT/native"
APP="$ROOT/dist/macos/YNX Browser Testnet Preview.app"
rm -rf "$APP"
mkdir -p "$(dirname "$APP")"
/usr/bin/python3 "$ROOT/scripts/package-macos-native.py" --binary "$ROOT/native/.build/release/YNXBrowserNative" --output "$APP"
VERIFY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ynx-routed-package.XXXXXX")"
trap 'rm -rf "$VERIFY_DIR"' EXIT
swiftc -module-name YNXBrowserCore -parse-as-library "$ROOT"/native/Sources/YNXBrowserCore/*.swift \
  "$ROOT/native/Sources/YNXBrowserNative/PrivacyTorPlatform.swift" \
  "$ROOT/native/Sources/YNXBrowserNative/PrivacyRouteWindow.swift" \
  "$ROOT/native/Sources/YNXBrowserNative/BrowserRoutedApplication.swift" \
  "$ROOT/privacy-routing/tor/tests/RoutedPackageProbe.swift" -o "$VERIFY_DIR/verify-package"
"$VERIFY_DIR/verify-package" "$APP"

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
