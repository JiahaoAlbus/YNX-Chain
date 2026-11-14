#!/usr/bin/env python3
"""Compile only the new actual identity/classification callees, without vendor/NE."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def block(source, signature):
    start = source.index(signature)
    opening = source.index("{", start)
    depth = 1
    end = opening + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    out = Path(tempfile.mkdtemp(prefix="qualification-callee.", dir=args.output)).resolve()
    root = Path(__file__).resolve().parents[3]
    native = root / "native/Sources/YNXBrowserNative/NymProtectedRouteProvider.swift"
    core = root / "native/Sources/YNXBrowserCore"
    paths = [native, Path(__file__).with_name("NymQualificationDeltaChecks.swift")]
    definitions = [
        (native, "enum NymProtectedFailure:"), (native, "enum NymProtectedStage:"),
        (core / "ProtectionLease.swift", "public enum RoutedIsolationMode:"),
        (core / "ProtectionLease.swift", "public enum ProtectionLeaseFailure:"),
        (core / "RoutedProductionQualification.swift", "public enum RoutedQualificationFailure:"),
        (core / "RoutedNormalProofProtocol.swift", "public enum RoutedNormalProofFailure:"),
        (core / "NymRouteAdapter.swift", "public enum NymRouteAdapterError:"),
        (core / "BundledNymSupply.swift", "public enum BundledNymSupplyError:"),
        (core / "OwnedBackendStartGate.swift", "public struct BackendStartGateFailure:"),
        (core / "PrivacyRouteProvider.swift", "public enum PrivacyRouteError:")
    ]
    paths += [path for path, _ in definitions]
    snapshots = {str(path): path.read_bytes() for path in paths}
    source = snapshots[str(native)].decode()
    excerpts = [block(snapshots[str(path)].decode(), signature) for path, signature in definitions]
    methods = [block(source, "static func validateIdentityInputs("), block(source, "static func classify(")]
    fixture = "import Foundation\n" + "\n".join(excerpts)
    fixture += "\n@MainActor enum NymProtectedRouteProvider {\n" + "\n".join(methods) + "\n}\n"
    checks = snapshots[str(paths[1])].decode().replace("import YNXBrowserCore\n", "")
    fixture += checks + '\n@main struct Probe { @MainActor static func main() throws { print("checks=\\(try NymQualificationDeltaChecks.run()) PASS") } }\n'
    (out / "ActualCallees.swift").write_text(fixture)
    sdk = subprocess.check_output(["xcodebuild", "-version", "-sdk", "macosx", "Path"], text=True).strip()
    (out / "tmp").mkdir()
    # Keep physical files on the selected disk, avoiding the known Unicode TMPDIR driver trap.
    with tempfile.TemporaryDirectory(prefix="ynx-nym-qual.", dir="/tmp") as alias:
        os.symlink(out / "tmp", Path(alias) / "t")
        env = dict(os.environ, TMPDIR=str(Path(alias) / "t") + "/")
        command = ["swiftc", "-j", "1", "-sdk", sdk, "-target", platform.machine() + "-apple-macosx14.0",
                   "-module-cache-path", str(out / "module-cache"), "-swift-version", "6", "-parse-as-library",
                   str(out / "ActualCallees.swift"), "-o", str(out / "probe")]
        with (out / "compile.log").open("w") as log:
            compiled = subprocess.run(command, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=60)
        result = subprocess.run([str(out / "probe")], capture_output=True, text=True, timeout=10) if compiled.returncode == 0 else None
    (out / "result.log").write_text(result.stdout + result.stderr if result else "NOT_RUN: compilation failed")
    normal = block(source, "private func authorizeNormalStartup(")
    factory = block(source, "static func make(protection:")
    startup = block(source, "private func performStart(")
    wiring = {
        "sameOwnerRetainedBeforeCheck": normal.index("protection = owner") < normal.index("try owner.requireBackendStartupQualification(mode: .nym)"),
        "factoryUsesTypedOwner": "try protection.requireBackendStartupQualification(mode: .nym)" in factory and "preflight(" not in factory,
        "startupUsesTypedOwnerBeforeSupply": startup.index("try authorizeNormalStartup()") < startup.index("BundledNymSupply.load("),
        "noSnapshotInNormalOwnerCheck": "RoutedPlatformIsolationAdmission.current" not in normal,
        "legacyProofCannotTransfer": "_ = decision\n        return 78" in source and "let authority = try RoutedNormalProofChildAuthority.begin(binding: binding)" in source
    }
    drift = {path: Path(path).read_bytes() != data for path, data in snapshots.items()}
    receipt = {"schema": "P05_NYM_QUALIFICATION_CALLEE_DELTA_V1", "sourceSHA256": {path: digest(data) for path, data in snapshots.items()},
               "extractedSHA256": [digest(text.encode()) for text in excerpts + methods], "compileCommand": command,
               "compileExit": compiled.returncode, "testExit": result.returncode if result else None,
               "result": result.stdout if result else None, "sourceDrift": drift, "wiringReadbackOnly": wiring,
               "scope": "13 actual DATA identity/classifier checks; wiring checks are source readback, not a qualified owner/NE/backend positive",
               "notRun": ["fullCore/fullNative", "qualification-positive", "normal-proof-child-authority", "vendor/network/GUI/keys"]}
    (out / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(out)
    if compiled.returncode or result is None or result.returncode or any(drift.values()) or not all(wiring.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
