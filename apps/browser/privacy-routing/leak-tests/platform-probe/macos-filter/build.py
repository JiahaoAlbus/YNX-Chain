#!/usr/bin/env python3
"""Build only. Never selects a signing identity, signs, installs, activates or saves NE preferences."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shlex
import subprocess
import sys

HERE = Path(__file__).resolve().parent
HOST = "com.ynxweb4.browser.routefilter.host"
PROVIDER = "com.ynxweb4.browser.routefilter.provider"

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--team-id", default="NOT_CONFIGURED")
    parser.add_argument("--test-cohort", type=Path, help="Build/run only own-process identity tests plus reducer replay of this preserved C receipt; never activate NE")
    parser.add_argument("--test-lease", action="store_true", help="Only new health-lease/client/protocol delta; no old suite or activation")
    parser.add_argument("--test-start-gate", action="store_true", help="New suspended owned-child lifecycle/ACK delta only; no NE activation or vendor network")
    parser.add_argument("--test-epoch-closure", action="store_true", help="Only new retired-token/observed-control-closure policy checks; no repeated old runtime tests")
    parser.add_argument("--synthetic-acceptance", action="store_true", help="Compile separate QA-only real canary selector/drop instrumentation; no production admission or automatic activation")
    parser.add_argument("--synthetic-provider-self-fault", action="store_true", help="Explicit QA-only one-shot self-exit selector, requiring real synthetic canary/live/exclusive Root; never activated by this builder")
    args = parser.parse_args()
    if args.synthetic_provider_self_fault and not args.synthetic_acceptance:
        parser.error("Provider self-fault requires the separate synthetic acceptance build")
    if not args.output.is_absolute() or args.output.exists():
        parser.error("Fresh absolute output directory required; preserve earlier artifacts")
    if args.team_id != "NOT_CONFIGURED" and not re.fullmatch(r"[A-Z0-9]{10}", args.team_id):
        parser.error("Exact reviewed ten-character Apple team identifier required")
    args.output.mkdir(mode=0o700)
    app = args.output / "YNX Route Filter Host.app"
    ext = app / "Contents/Library/SystemExtensions" / (PROVIDER + ".systemextension")
    for directory in [app / "Contents/MacOS", ext / "Contents/MacOS", args.output / "objects"]:
        directory.mkdir(parents=True, mode=0o700)
    common = {"CFBundleInfoDictionaryVersion": "6.0", "CFBundleVersion": "1", "CFBundleShortVersionString": "0.1", "LSMinimumSystemVersion": "15.0", "YNXReviewedTeamIdentifier": args.team_id}
    host_info = dict(common, CFBundleIdentifier=HOST, CFBundleName="YNX Route Filter Host", CFBundleExecutable="YNXFilterHost", CFBundlePackageType="APPL", LSUIElement=True, NSSystemExtensionUsageDescription="Enable the separately reviewed YNX dedicated Browser route fence. No other application's payload is inspected.")
    ext_info = dict(common, CFBundleIdentifier=PROVIDER, CFBundleName="YNX Scoped Route Filter", CFBundleExecutable="YNXPrivacyFilter", CFBundlePackageType="SYSX", NetworkExtension={"NEProviderClasses": {"com.apple.networkextension.filter-data": "DataProvider"}, "NEMachServiceName": args.team_id + "." + PROVIDER})
    if args.synthetic_provider_self_fault: ext_info["YNXSyntheticProviderSelfFaultTesting"] = True
    for path, value in [(app / "Contents/Info.plist", host_info), (ext / "Contents/Info.plist", ext_info)]:
        path.write_bytes(plistlib.dumps(value))
    host_entitlements = {"com.apple.developer.system-extension.install": True, "com.apple.developer.networking.networkextension": ["content-filter-provider-systemextension"]}
    ext_entitlements = {"com.apple.developer.networking.networkextension": ["content-filter-provider-systemextension"]}
    for name, value in [("host.entitlements.plist", host_entitlements), ("provider.entitlements.plist", ext_entitlements)]:
        (args.output / name).write_bytes(plistlib.dumps(value))
    sdk = subprocess.check_output(["xcrun", "--sdk", "macosx", "--show-sdk-path"], text=True).strip()
    cache = args.output.parent / "C-module-cache"
    cache.mkdir(exist_ok=True, mode=0o700)
    os.environ["CLANG_MODULE_CACHE_PATH"] = str(cache)
    os.environ["SWIFTC_MODULE_CACHE_PATH"] = str(cache)
    c_object = args.output / "objects/IdentityBridge.o"
    commands = []
    def run(command):
        commands.append(command)
        subprocess.run(command, check=True)
    run(["xcrun", "clang", "-isysroot", sdk, "-mmacosx-version-min=14.0", "-Wno-deprecated-declarations", "-c", str(HERE / "IdentityBridge.c"), "-o", str(c_object)])
    swift_base = ["xcrun", "swiftc", "-swift-version", "5", "-sdk", sdk, "-target", "arm64-apple-macos15.0", "-module-cache-path", str(cache), "-parse-as-library", "-framework", "Foundation", "-framework", "Security", "-framework", "NetworkExtension"]
    if args.synthetic_acceptance: swift_base += ["-D", "YNX_PRIVACY_ACCEPTANCE"]
    if args.synthetic_provider_self_fault: swift_base += ["-D", "YNX_SYNTHETIC_PROVIDER_SELF_FAULT"]
    swift = swift_base + ["-import-objc-header", str(HERE / "IdentityBridge.h"), "-lbsm"]
    client_sources = [str(HERE / name) for name in ["ControlProtocol.swift", "ProtectionLease.swift", "RoutedIsolationClient.swift", "OwnedBackendAuditReader.swift", "RootPreparationClient.swift", "OwnedBackendStartGate.swift", "RootClosureObserver.swift", "RoutedNormalProofProtocol.swift", "NormalCaptureProtocol.swift"]]
    if args.synthetic_acceptance: client_sources += [str(HERE / "SyntheticCanaryProtocol.swift"), str(HERE / "SyntheticProofProtocol.swift")]
    if args.synthetic_provider_self_fault: client_sources += [str(HERE / "SyntheticProviderFaultProtocol.swift")]
    shared = [str(HERE / "RunPolicy.swift"), str(HERE / "RoutedEnrollment.swift"), str(HERE / "BootstrapGraphPolicy.swift"), str(HERE / "EpochProtectionPolicy.swift")] + client_sources + [str(c_object)]
    run(swift + ["-module-name", "YNXPrivacyFilter"] + shared + [str(HERE / "RootPreparationModel.swift")] + ([str(HERE / "SyntheticCanaryPolicy.swift")] if args.synthetic_acceptance else []) + [str(HERE / "Provider.swift"), str(HERE / "ProviderMain.swift"), "-o", str(ext / "Contents/MacOS/YNXPrivacyFilter")])
    run(swift + ["-framework", "SystemExtensions", "-framework", "AppKit", "-module-name", "YNXFilterHost"] + shared + [str(HERE / "HostMain.swift"), "-o", str(app / "Contents/MacOS/YNXFilterHost")])
    client = args.output / "YNXRouteIsolation.framework"
    (client / "Modules").mkdir(parents=True)
    (client / "Headers").mkdir()
    (client / "Info.plist").write_bytes(plistlib.dumps(dict(common, CFBundleIdentifier="com.ynxweb4.browser.routefilter.client", CFBundleExecutable="YNXRouteIsolation", CFBundlePackageType="FMWK")))
    run(swift_base + ["-emit-library", "-emit-module", "-module-name", "YNXRouteIsolation", "-emit-module-path", str(client / "Modules/YNXRouteIsolation.swiftmodule"), "-emit-objc-header-path", str(client / "Headers/YNXRouteIsolation-Swift.h"), "-Xlinker", "-install_name", "-Xlinker", "@rpath/YNXRouteIsolation.framework/YNXRouteIsolation"] + client_sources + ["-o", str(client / "YNXRouteIsolation")])
    helper = args.output / "YNXBackendStartGate"
    run(["xcrun", "clang", "-fobjc-arc", "-isysroot", sdk, "-mmacosx-version-min=14.0", "-Wno-deprecated-declarations", str(HERE / "BackendStartGate.m"), str(c_object), "-framework", "Foundation", "-framework", "Security", "-lbsm", "-o", str(helper)])
    if args.test_epoch_closure:
        tests = args.output / "YNXProviderEpochTests"
        native_base = ["xcrun", "swiftc", "-swift-version", "6", "-sdk", sdk, "-target", "arm64-apple-macos14.0", "-module-cache-path", str(cache), "-parse-as-library", "-framework", "Foundation", "-framework", "Security"]
        run(native_base + ["-module-name", "YNXProviderEpochTests"] + client_sources + [str(HERE / "EpochProtectionPolicy.swift"), str(HERE / "ProviderEpochSelfTest.swift"), "-o", str(tests)])
        result = subprocess.run([str(tests)], text=True, capture_output=True)
        (args.output / "provider-epoch-selftest.json").write_text(result.stdout)
        (args.output / "provider-epoch-selftest.stderr").write_text(result.stderr)
        result.check_returncode()
    if args.test_start_gate:
        fixture = args.output / "GateLifecycleFixture"
        run(["xcrun", "clang", "-isysroot", sdk, str(HERE / "GateLifecycleFixture.c"), "-o", str(fixture)])
        tests = args.output / "YNXRootPreparationTests"
        native_base = ["xcrun", "swiftc", "-swift-version", "6", "-sdk", sdk, "-target", "arm64-apple-macos14.0", "-module-cache-path", str(cache), "-parse-as-library", "-framework", "Foundation", "-framework", "Security"]
        run(native_base + ["-module-name", "YNXRootPreparationTests"] + client_sources + [str(HERE / "RootPreparationSelfTest.swift"), "-o", str(tests)])
        result = subprocess.run([str(tests)], text=True, capture_output=True)
        (args.output / "root-preparation-selftest.json").write_text(result.stdout)
        (args.output / "root-preparation-selftest.stderr").write_text(result.stderr)
        result.check_returncode()
        graph_tests = args.output / "YNXBootstrapGraphTests"
        run(swift + ["-module-name", "YNXBootstrapGraphTests"] + shared + [str(HERE / "BootstrapGraphSelfTest.swift"), "-o", str(graph_tests)])
        result = subprocess.run([str(graph_tests)], text=True, capture_output=True)
        (args.output / "bootstrap-graph-selftest.json").write_text(result.stdout)
        (args.output / "bootstrap-graph-selftest.stderr").write_text(result.stderr)
        result.check_returncode()
        result = subprocess.run([sys.executable, str(HERE / "test_start_gate.py"), "--helper", str(helper), "--fixture", str(fixture), "--output", str(args.output / "start-gate-tests")], text=True, capture_output=True)
        (args.output / "start-gate-selftest.stdout").write_text(result.stdout)
        (args.output / "start-gate-selftest.stderr").write_text(result.stderr)
        result.check_returncode()
    if args.test_lease:
        relay = args.output / "BackendIdentityRelay"
        run(["xcrun", "clang", "-fobjc-arc", "-isysroot", sdk, "-Wno-deprecated-declarations", str(HERE / "BackendIdentityRelay.m"), "-framework", "Foundation", "-framework", "Security", "-lbsm", "-o", str(relay)])
        fixtures = []
        for variant in [1, 2]:
            directory = args.output / ("fixture-" + str(variant))
            directory.mkdir()
            fixture = directory / "LeaseBackendFixture"
            run(["xcrun", "clang", "-isysroot", sdk, "-DLEASE_FIXTURE_VARIANT=" + str(variant), str(HERE / "LeaseBackendFixture.c"), "-o", str(fixture)])
            fixtures.append(fixture)
        tests = args.output / "YNXProtectionLeaseTests"
        run(swift + ["-module-name", "YNXProtectionLeaseTests"] + client_sources + [str(HERE / "BackendLaunchTicket.swift"), str(HERE / "RunPolicy.swift"), str(c_object), str(HERE / "LeaseSelfTest.swift"), "-o", str(tests)])
        result = subprocess.run([str(tests), str(relay), str(fixtures[0]), str(fixtures[1]), str(args.output / "relay-live-test")], text=True, capture_output=True)
        (args.output / "lease-selftest-receipt.json").write_text(result.stdout)
        (args.output / "lease-selftest.stderr").write_text(result.stderr)
        result.check_returncode()
    if args.test_cohort:
        tests = args.output / "YNXFilterPolicyTests"
        run(swift + ["-module-name", "YNXFilterPolicyTests", str(HERE / "RunPolicy.swift"), str(c_object), str(HERE / "PolicySelfTest.swift"), "-o", str(tests)])
        result = subprocess.run([str(tests), "--cohort", str(args.test_cohort)], check=True, text=True, capture_output=True)
        (args.output / "policy-selftest-receipt.json").write_text(result.stdout)
    # Concrete owner review recipe. It is never run here. IDENTITY must be selected by the
    # original signing owner; provisioning profiles are separately supplied, never downloaded.
    quote = shlex.quote
    recipe = "#!/bin/sh\nset -eu\n: \"${IDENTITY:?Original signing owner must provide an authorized Apple Development or Developer ID Application identity with matching NE entitlement/profile}\"\n"
    recipe += "test " + quote(args.team_id) + " != NOT_CONFIGURED || { echo 'Rebuild with reviewed team ID first.' >&2; exit 78; }\n"
    for profile in [app / "Contents/embedded.provisionprofile", ext / "Contents/embedded.provisionprofile"]:
        recipe += "test -f " + quote(str(profile)) + " || { echo 'Exact matching entitlement-enabled provisioning profile missing.' >&2; exit 78; }\n"
    recipe += "/usr/bin/codesign --force --timestamp --options runtime --sign \"$IDENTITY\" --entitlements " + quote(str(args.output / "provider.entitlements.plist")) + " " + quote(str(ext)) + "\n"
    recipe += "/usr/bin/codesign --force --timestamp --options runtime --sign \"$IDENTITY\" --entitlements " + quote(str(args.output / "host.entitlements.plist")) + " " + quote(str(app)) + "\n"
    recipe += "/usr/bin/codesign --verify --strict --deep --verbose=2 " + quote(str(app)) + "\n"
    recipe += "echo 'Signed locally only; installation/activation/notarization and true leak regression are separate authorized gates.'\n"
    (args.output / "sign-reviewed.sh").write_text(recipe)
    os.chmod(args.output / "sign-reviewed.sh", 0o700)
    inputs = {str(path.relative_to(HERE)): sha(path) for path in HERE.iterdir() if path.is_file()}
    receipt = {"schema": "P05_NE_FILTER_BUILD_V2", "output": str(app), "teamID": args.team_id, "sdk": sdk, "moduleCache": str(cache), "commands": commands, "inputs": inputs, "hostSHA256": sha(app / "Contents/MacOS/YNXFilterHost"), "providerSHA256": sha(ext / "Contents/MacOS/YNXPrivacyFilter"), "nativeClientFramework": str(client), "nativeClientSHA256": sha(client / "YNXRouteIsolation"), "startHelper": str(helper), "startHelperRelativePath": "Contents/Helpers/YNXBackendStartGate", "startHelperSHA256": sha(helper), "codesignInvoked": False, "automaticLinkerAdHocSignatureIsNotAuthorizedSigning": True, "installed": False, "activated": False, "networkExtensionAcceptance": "NOT_RUN", "productionRouteAdmission": False, "syntheticAcceptanceCompiled": args.synthetic_acceptance}
    receipt["syntheticProviderSelfFaultCompiled"] = args.synthetic_provider_self_fault
    (args.output / "build-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"receipt": str(args.output / "build-receipt.json"), "app": str(app), "signedByAuthorizedIdentity": False, "activated": False}))

if __name__ == "__main__":
    main()
