#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUPPLY_ARGUMENTS=()
NYM_PROOF_ORIGIN=""
NYM_PROOF_RESPONSE_SHA256=""
NYM_SUPPLY_PRESENT=false
ROUTE_FILTER_PROVIDER=""
ROUTE_FILTER_PROVIDER_SHA256=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tor-supply|--nym-supply)
      [[ $# -ge 2 ]] || { echo "Missing offline supply directory" >&2; exit 64; }
      if [[ "$1" == --nym-supply ]]; then NYM_SUPPLY_PRESENT=true; fi
      SUPPLY_ARGUMENTS+=("$1" "$2"); shift 2 ;;
    --nym-proof-origin|--nym-proof-response-sha256)
      [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || { echo "Missing Nym proof argument value" >&2; exit 64; }
      if [[ "$1" == --nym-proof-origin ]]; then
        [[ -z "$NYM_PROOF_ORIGIN" ]] || { echo "Duplicate Nym proof origin" >&2; exit 64; }
        NYM_PROOF_ORIGIN="$2"
      else
        [[ -z "$NYM_PROOF_RESPONSE_SHA256" ]] || { echo "Duplicate Nym proof response pin" >&2; exit 64; }
        NYM_PROOF_RESPONSE_SHA256="$2"
      fi
      SUPPLY_ARGUMENTS+=("$1" "$2"); shift 2 ;;
    --route-filter-provider|--route-filter-provider-sha256)
      [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || { echo "Missing reviewed provider argument value" >&2; exit 64; }
      if [[ "$1" == --route-filter-provider ]]; then
        [[ -z "$ROUTE_FILTER_PROVIDER" ]] || { echo "Duplicate provider bundle" >&2; exit 64; }
        ROUTE_FILTER_PROVIDER="$2"
      else
        [[ -z "$ROUTE_FILTER_PROVIDER_SHA256" ]] || { echo "Duplicate provider pin" >&2; exit 64; }
        ROUTE_FILTER_PROVIDER_SHA256="$2"
      fi
      SUPPLY_ARGUMENTS+=("$1" "$2"); shift 2 ;;
    *) echo "Unknown build argument: $1" >&2; exit 64 ;;
  esac
done
# Reject incomplete or invalid proof input before compiling or removing an old
# app. The packager remains the single validator; this performs no network I/O.
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 - "$ROOT/scripts" "$NYM_PROOF_ORIGIN" "$NYM_PROOF_RESPONSE_SHA256" "$NYM_SUPPLY_PRESENT" "$ROUTE_FILTER_PROVIDER" "$ROUTE_FILTER_PROVIDER_SHA256" <<'PY'
import runpy
import sys
import plistlib
import subprocess
from pathlib import Path
sys.path.insert(0, sys.argv[1])
packager = runpy.run_path(str(Path(sys.argv[1]) / 'package-macos-native.py'))
try:
    configuration = packager['validate_nym_proof_configuration'](sys.argv[2] or None, sys.argv[3] or None)
    if configuration is not None and sys.argv[4] != 'true':
        raise ValueError('Controlled Nym proof configuration requires a reviewed Nym runtime supply')
    info = packager['read_normal_template']()
    packager['validate_route_filter_provider'](Path(sys.argv[5]) if sys.argv[5] else None,
                                             sys.argv[6] or None, info.get('YNXReviewedTeamIdentifier'))
except (ValueError, OSError, plistlib.InvalidFileException, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
    print(str(error), file=sys.stderr)
    sys.exit(64)
PY
node "$ROOT/scripts/verify-route-protection-sources.mjs"
swift build -c release --package-path "$ROOT/native"
VERIFY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ynx-routed-package.XXXXXX")"
PACKAGE_COMPLETE=false
trap 'status=$?; rm -rf "$VERIFY_DIR" || :; if [[ "$status" -eq 0 && "$PACKAGE_COMPLETE" != true ]]; then status=1; fi; exit "$status"' EXIT
FILTER_SOURCE="$ROOT/privacy-routing/leak-tests/platform-probe/macos-filter"
MACOS_SDK="$(xcodebuild -version -sdk macosx Path)"
SWIFT_PLATFORM_ARGS=(-sdk "$MACOS_SDK" -target "$(uname -m)-apple-macosx14.0")
xcrun clang -isysroot "$MACOS_SDK" -O2 -mmacosx-version-min=14.0 -c "$FILTER_SOURCE/IdentityBridge.c" \
  -Wno-deprecated-declarations -o "$VERIFY_DIR/IdentityBridge.o"
xcrun clang -isysroot "$MACOS_SDK" -fobjc-arc -O2 -mmacosx-version-min=14.0 "$FILTER_SOURCE/BackendStartGate.m" "$VERIFY_DIR/IdentityBridge.o" \
  -framework Foundation -framework Security -lbsm -Wno-deprecated-declarations -o "$VERIFY_DIR/YNXBackendStartGate"
APP="$ROOT/dist/macos/YNX Browser Testnet Preview.app"
rm -rf "$APP"
mkdir -p "$(dirname "$APP")"
# Bash 3.2 treats an empty array as unset under nounset.
/usr/bin/python3 "$ROOT/scripts/package-macos-native.py" --binary "$ROOT/native/.build/release/YNXBrowserNative" --output "$APP" --spawn-gate-helper "$VERIFY_DIR/YNXBackendStartGate" ${SUPPLY_ARGUMENTS[@]+"${SUPPLY_ARGUMENTS[@]}"}
swiftc "${SWIFT_PLATFORM_ARGS[@]}" -module-cache-path "$VERIFY_DIR/module-cache" -module-name YNXBrowserCore -parse-as-library "$ROOT"/native/Sources/YNXBrowserCore/*.swift \
  "$ROOT/native/Sources/YNXBrowserNative/PrivacyTorPlatform.swift" \
  "$ROOT/native/Sources/YNXBrowserNative/BundledTorBackend.swift" \
  "$ROOT/native/Sources/YNXBrowserNative/TorExternalTransport.swift" \
  "$ROOT/native/Sources/YNXBrowserNative/TorProtectedRouteProvider.swift" \
  "$ROOT/native/Sources/YNXBrowserNative/NymProtectedRouteProvider.swift" \
  "$ROOT/native/Sources/YNXBrowserNative/RoutedBrowserPage.swift" \
  "$ROOT/native/Sources/YNXBrowserNative/PrivacyRouteWindow.swift" \
  "$ROOT/native/Sources/YNXBrowserNative/BrowserRouteProtection.swift" \
  "$ROOT/native/Sources/YNXBrowserNative/BrowserRoutedApplication.swift" \
  "$ROOT/privacy-routing/tor/tests/RoutedPackageProbe.swift" -o "$VERIFY_DIR/verify-package"
"$VERIFY_DIR/verify-package" "$APP"
swiftc "${SWIFT_PLATFORM_ARGS[@]}" -module-cache-path "$VERIFY_DIR/module-cache" -module-name YNXBrowserCore -parse-as-library "$ROOT"/native/Sources/YNXBrowserCore/*.swift \
  "$ROOT/test/BundledNymPackageProbe.swift" -o "$VERIFY_DIR/verify-nym-supply"
"$VERIFY_DIR/verify-nym-supply" "${APP%.app}.package.json"

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
PACKAGE_COMPLETE=true
