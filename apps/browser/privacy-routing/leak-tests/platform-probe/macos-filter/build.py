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
    args = parser.parse_args()
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
    for path, value in [(app / "Contents/Info.plist", host_info), (ext / "Contents/Info.plist", ext_info)]:
        path.write_bytes(plistlib.dumps(value))
    host_entitlements = {"com.apple.developer.system-extension.install": True, "com.apple.developer.networking.networkextension": ["content-filter-provider-systemextension"]}
    ext_entitlements = {"com.apple.developer.networking.networkextension": ["content-filter-provider-systemextension"]}
    for name, value in [("host.entitlements.plist", host_entitlements), ("provider.entitlements.plist", ext_entitlements)]:
        (args.output / name).write_bytes(plistlib.dumps(value))
    sdk = subprocess.check_output(["xcrun", "--sdk", "macosx", "--show-sdk-path"], text=True).strip()
    c_object = args.output / "objects/IdentityBridge.o"
    commands = []
    def run(command):
        commands.append(command)
        subprocess.run(command, check=True)
    run(["xcrun", "clang", "-isysroot", sdk, "-mmacosx-version-min=15.0", "-Wno-deprecated-declarations", "-c", str(HERE / "IdentityBridge.c"), "-o", str(c_object)])
    swift = ["xcrun", "swiftc", "-swift-version", "5", "-sdk", sdk, "-target", "arm64-apple-macos15.0", "-import-objc-header", str(HERE / "IdentityBridge.h"), "-parse-as-library", "-framework", "Foundation", "-framework", "Security", "-framework", "NetworkExtension", "-lbsm"]
    shared = [str(HERE / "RunPolicy.swift"), str(HERE / "ControlProtocol.swift"), str(c_object)]
    run(swift + ["-module-name", "YNXPrivacyFilter"] + shared + [str(HERE / "Provider.swift"), str(HERE / "ProviderMain.swift"), "-o", str(ext / "Contents/MacOS/YNXPrivacyFilter")])
    run(swift + ["-framework", "SystemExtensions", "-framework", "AppKit", "-module-name", "YNXFilterHost"] + shared + [str(HERE / "HostMain.swift"), "-o", str(app / "Contents/MacOS/YNXFilterHost")])
    if args.test_cohort:
        tests = args.output / "YNXFilterPolicyTests"
        run(swift + ["-module-name", "YNXFilterPolicyTests", str(HERE / "RunPolicy.swift"), str(c_object), str(HERE / "PolicySelfTest.swift"), "-o", str(tests)])
        result = subprocess.run([str(tests), "--cohort", str(args.test_cohort)], check=True, text=True, capture_output=True)
        (args.output / "policy-selftest-receipt.json").write_text(result.stdout)
    # Concrete owner review recipe. It is never run here. IDENTITY must be selected by the
    # original signing owner; provisioning profiles are separately supplied, never downloaded.
    quote = shlex.quote
    recipe = "#!/bin/sh\nset -eu\n: \"${IDENTITY:?Original signing owner must provide an authorized Developer ID Application identity}\"\n"
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
    receipt = {"schema": "P05_NE_FILTER_BUILD_V1", "output": str(app), "teamID": args.team_id, "sdk": sdk, "commands": commands, "inputs": inputs, "hostSHA256": sha(app / "Contents/MacOS/YNXFilterHost"), "providerSHA256": sha(ext / "Contents/MacOS/YNXPrivacyFilter"), "codesignInvoked": False, "automaticLinkerAdHocSignatureIsNotAuthorizedSigning": True, "installed": False, "activated": False, "networkExtensionAcceptance": "NOT_RUN", "productionRouteAdmission": False}
    (args.output / "build-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"receipt": str(args.output / "build-receipt.json"), "app": str(app), "signedByAuthorizedIdentity": False, "activated": False}))

if __name__ == "__main__":
    main()
