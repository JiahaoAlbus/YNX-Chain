#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
: "${YNX_NYM_TEST_OUTPUT:?Set an external-disk test output directory}"
OUT="$(mktemp -d "$YNX_NYM_TEST_OUTPUT/offline.XXXXXX")"
SWIFT_SDK="$(xcodebuild -version -sdk macosx Path)"
SWIFT_TARGET="$(uname -m)-apple-macosx14.0"
mkdir -p "$OUT/snapshot/Core" "$OUT/snapshot/Native"
cp "$ROOT/native/Sources/YNXBrowserCore/"*.swift "$OUT/snapshot/Core/"
for name in PrivacyTorPlatform BrowserRouteProtection NymProtectedRouteProvider; do
  cp "$ROOT/native/Sources/YNXBrowserNative/$name.swift" "$OUT/snapshot/Native/"
done
cp "$ROOT/privacy-routing/nym/tests/ProtectedNymProbe.swift" "$ROOT/privacy-routing/nym/tests/NymProductionLifecycleChecks.swift" "$OUT/snapshot/"
shasum -a 256 "$OUT/snapshot/Core/"*.swift "$OUT/snapshot/Native/"*.swift "$OUT/snapshot/ProtectedNymProbe.swift" "$OUT/snapshot/NymProductionLifecycleChecks.swift" > "$OUT/sources.sha256"
mkdir "$OUT/module"
swiftc -sdk "$SWIFT_SDK" -target "$SWIFT_TARGET" -module-cache-path "$OUT/module-cache" -swift-version 6 -parse-as-library -emit-module -module-name YNXBrowserCore \
  "$OUT/snapshot/Core/"*.swift -emit-module-path "$OUT/module/YNXBrowserCore.swiftmodule" \
  > "$OUT/core-module.log" 2>&1
swiftc -sdk "$SWIFT_SDK" -target "$SWIFT_TARGET" -module-cache-path "$OUT/module-cache" -swift-version 6 -typecheck -I "$OUT/module" "$OUT/snapshot/Native/"*.swift \
  > "$OUT/native-consumer.log" 2>&1
swiftc -sdk "$SWIFT_SDK" -target "$SWIFT_TARGET" -module-cache-path "$OUT/module-cache" -swift-version 6 -module-name YNXBrowserCore -parse-as-library \
  "$OUT/snapshot/Core/"*.swift "$OUT/snapshot/Native/"*.swift "$OUT/snapshot/ProtectedNymProbe.swift" "$OUT/snapshot/NymProductionLifecycleChecks.swift" \
  -o "$OUT/protected-nym-probe" > "$OUT/compile.log" 2>&1
YNX_NYM_TEST_OUTPUT="$OUT" "$OUT/protected-nym-probe" > "$OUT/result.log" 2>&1
cat "$OUT/result.log"
printf 'evidence=%s\n' "$OUT"
