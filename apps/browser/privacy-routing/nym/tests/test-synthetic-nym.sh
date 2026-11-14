#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
: "${YNX_NYM_TEST_OUTPUT:?Set a dedicated test output directory (external disk locally)}"
OUT="$(mktemp -d "$YNX_NYM_TEST_OUTPUT/synthetic-glue.XXXXXX")"
PROBE_ARGUMENTS=()
if [[ $# -gt 0 ]]; then
  [[ $# -eq 1 && ( "$1" == "--startup-delta" || "$1" == "--gate-cleanup-delta" || "$1" == "--gateway-recovery-delta" || "$1" == "--capture-consumer-delta" || "$1" == "--qualification-delta" || "$1" == "--normal-proof-delta" ) ]] || { echo "Expected one targeted delta selector" >&2; exit 64; }
  PROBE_ARGUMENTS+=("$1")
fi
SWIFT_SDK="$(xcodebuild -version -sdk macosx Path)"
SWIFT_TARGET="$(uname -m)-apple-macosx14.0"
mkdir -p "$OUT/snapshot/Core" "$OUT/snapshot/Native" "$OUT/normal-module" "$OUT/trial-module" "$OUT/tmp"
# Swift driver traps before diagnostics when TMPDIR contains non-ASCII bytes on this SDK.
# Only this private alias lives in /tmp; the compiler's physical temporary files stay in OUT.
COMPILER_TMP_ALIAS_ROOT="$(mktemp -d /tmp/ynx-nym-synthetic.XXXXXX)"
trap 'rm -f "$COMPILER_TMP_ALIAS_ROOT/t"; rmdir "$COMPILER_TMP_ALIAS_ROOT"' EXIT
ln -s "$OUT/tmp" "$COMPILER_TMP_ALIAS_ROOT/t"
printf '%s\n' "$COMPILER_TMP_ALIAS_ROOT/t -> $OUT/tmp" > "$OUT/compiler-temp-alias.txt"
cp "$ROOT/native/Sources/YNXBrowserCore/"*.swift "$OUT/snapshot/Core/"
for name in PrivacyTorPlatform BrowserRouteProtection ProtectedSyntheticCanary NymProtectedRouteProvider; do
  cp "$ROOT/native/Sources/YNXBrowserNative/$name.swift" "$OUT/snapshot/Native/"
done
cp "$ROOT/privacy-routing/nym/tests/NymSyntheticGlueProbe.swift" "$OUT/snapshot/"
cp "$ROOT/privacy-routing/nym/tests/NymStartupDeltaChecks.swift" "$OUT/snapshot/"
cp "$ROOT/privacy-routing/nym/tests/NymGateCleanupDeltaChecks.swift" "$OUT/snapshot/"
cp "$ROOT/privacy-routing/nym/tests/NymGatewayRecoveryDeltaChecks.swift" "$OUT/snapshot/"
cp "$ROOT/privacy-routing/nym/tests/NymCaptureConsumerDeltaChecks.swift" "$OUT/snapshot/"
cp "$ROOT/privacy-routing/nym/tests/NymQualificationDeltaChecks.swift" "$OUT/snapshot/"
cp "$ROOT/privacy-routing/nym/tests/NymNormalProofScopeDeltaChecks.swift" "$OUT/snapshot/"
shasum -a 256 "$OUT/snapshot/Core/"*.swift "$OUT/snapshot/Native/"*.swift "$OUT/snapshot/"*Checks.swift "$OUT/snapshot/NymSyntheticGlueProbe.swift" > "$OUT/sources.sha256"
printf 'evidence=%s\n' "$OUT"
TMPDIR="$COMPILER_TMP_ALIAS_ROOT/t/" swiftc -j 1 -sdk "$SWIFT_SDK" -target "$SWIFT_TARGET" -module-cache-path "$OUT/module-cache" -swift-version 6 -parse-as-library -emit-module -module-name YNXBrowserCore \
  "$OUT/snapshot/Core/"*.swift -emit-module-path "$OUT/normal-module/YNXBrowserCore.swiftmodule" > "$OUT/normal-core.log" 2>&1
TMPDIR="$COMPILER_TMP_ALIAS_ROOT/t/" swiftc -j 1 -sdk "$SWIFT_SDK" -target "$SWIFT_TARGET" -module-cache-path "$OUT/module-cache" -swift-version 6 -typecheck -I "$OUT/normal-module" \
  "$OUT/snapshot/Native/"*.swift > "$OUT/normal-native.log" 2>&1
TMPDIR="$COMPILER_TMP_ALIAS_ROOT/t/" swiftc -j 1 -sdk "$SWIFT_SDK" -target "$SWIFT_TARGET" -module-cache-path "$OUT/module-cache" -swift-version 6 -DYNX_PRIVACY_ACCEPTANCE -parse-as-library -emit-module -module-name YNXBrowserCore \
  "$OUT/snapshot/Core/"*.swift -emit-module-path "$OUT/trial-module/YNXBrowserCore.swiftmodule" > "$OUT/trial-core.log" 2>&1
TMPDIR="$COMPILER_TMP_ALIAS_ROOT/t/" swiftc -j 1 -sdk "$SWIFT_SDK" -target "$SWIFT_TARGET" -module-cache-path "$OUT/module-cache" -swift-version 6 -DYNX_PRIVACY_ACCEPTANCE -module-name YNXBrowserCore -parse-as-library \
  "$OUT/snapshot/Core/"*.swift "$OUT/snapshot/Native/"*.swift "$OUT/snapshot/NymSyntheticGlueProbe.swift" "$OUT/snapshot/"*Checks.swift \
  -o "$OUT/nym-synthetic-glue" > "$OUT/compile.log" 2>&1
YNX_NYM_TEST_OUTPUT="$OUT" "$OUT/nym-synthetic-glue" "${PROBE_ARGUMENTS[@]}" > "$OUT/result.log" 2>&1
cat "$OUT/result.log"
printf 'evidence=%s\n' "$OUT"
