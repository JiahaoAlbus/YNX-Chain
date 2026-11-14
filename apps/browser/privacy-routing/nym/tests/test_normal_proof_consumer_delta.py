#!/usr/bin/env python3
"""Run only normal proof requested-DATA/self-identity callee regressions, offline."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile


def block(source, signature):
    start = source.index(signature)
    position = source.index("{", start) + 1
    depth = 1
    while depth:
        depth += (source[position] == "{") - (source[position] == "}")
        position += 1
    return source[start:position]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--failure-only", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    out = Path(tempfile.mkdtemp(prefix="normal-proof-callee.", dir=args.output)).resolve()
    root = Path(__file__).resolve().parents[3]
    core = root / "native/Sources/YNXBrowserCore"
    native = root / "native/Sources/YNXBrowserNative/NymProtectedRouteProvider.swift"
    test = Path(__file__).with_name("NymNormalProofScopeDeltaChecks.swift")
    definitions = [
        (native, "enum NymProtectedFailure:"),
        (native, "enum NymProtectedStage:"),
        (core / "RoutedProductionQualification.swift", "public enum RoutedQualificationFailure:"),
        (core / "OwnedBackendStartGate.swift", "public struct BackendStartGateFailure:"),
        (core / "PrivacyRouteProvider.swift", "public enum PrivacyRouteError:"),
        (core / "ProtectionLease.swift", "public enum RoutedIsolationMode:"),
        (core / "ProtectionLease.swift", "public enum ProtectionLeaseFailure:"),
        (core / "ProtectionLease.swift", "public struct RoutedIsolationConfiguration:"),
        (core / "RootPreparationClient.swift", "public struct RootDenyReceipt:"),
        (core / "NymRouteAdapter.swift", "public enum NymRouteAdapterError:"),
        (core / "BundledNymSupply.swift", "public enum BundledNymSupplyError:"),
        (core / "BundledNymSupply.swift", "public struct NymDedicatedProfile:"),
        (core / "RoutedNormalProofProtocol.swift", "public enum RoutedNormalProofFailure:"),
        (core / "RoutedNormalProofProtocol.swift", "public struct RoutedNormalProofBinding:"),
        (core / "NymRouteAdapter.swift", "public struct NymControlledProbe:")
    ]
    paths = {path for path, _ in definitions} | {native, test}
    snapshots = {str(path): path.read_bytes() for path in paths}
    source = snapshots[str(native)].decode()
    excerpts = [block(snapshots[str(path)].decode(), signature) for path, signature in definitions]
    domain = block((core / "NymRouteAdapter.swift").read_text(), "public static func socks5DomainConnect(")
    helper = [block(source, signature) for signature in ["struct Request {", "static func parse(_ args:",
              "static func validateAuthorityScope(", "static func selfPreflight(", "private static func verify("]]
    normal = source[source.index("enum NymNormalProofHelper {"):]
    lookup = [block(normal, signature) for signature in ["static func claims(", "static func validateBinding(", "static func arguments(", "static func parse("]]
    fixture = "import Foundation\nimport Security\nimport CryptoKit\nimport Darwin\n" + "\n".join(excerpts)
    fixture += "\nenum NymRouteLaunchPlan {\n" + domain + "\n}\n"
    fixture += '\nenum NymProofHelper {\nstatic let flag = "--ynx-nym-proof-v1"\nstatic let identifier = "com.ynxweb4.browser.route.nym.probe"\n' + "\n".join(helper) + "\n}\n"
    fixture += '\nenum NymNormalProofHelper {\nstatic let flag = "--ynx-nym-normal-proof-v1"\n' + "\n".join(lookup) + "\n}\n"
    classifier = block(source, "static func classify(")
    fixture += '\n@MainActor enum NymProtectedRouteProvider {\n' + classifier + '\n}\n'
    fixture += snapshots[str(test)].decode().replace("import YNXBrowserCore\n", "")
    call = "NymNormalProofScopeDeltaChecks.runFailures()" if args.failure_only else "try NymNormalProofScopeDeltaChecks.run()"
    fixture += '\n@main struct Probe { @MainActor static func main() throws { print("checks=\\(' + call + ') PASS") } }\n'
    (out / "ActualCallees.swift").write_text(fixture)
    sdk = subprocess.check_output(["xcodebuild", "-version", "-sdk", "macosx", "Path"], text=True).strip()
    (out / "tmp").mkdir()
    with tempfile.TemporaryDirectory(prefix="ynx-nym-normal-proof.", dir="/tmp") as alias:
        os.symlink(out / "tmp", Path(alias) / "t")
        env = dict(os.environ, TMPDIR=str(Path(alias) / "t") + "/")
        command = ["swiftc", "-j", "1", "-sdk", sdk, "-target", platform.machine() + "-apple-macosx14.0",
                   "-module-cache-path", str(out / "module-cache"), "-swift-version", "6", "-parse-as-library",
                   str(out / "ActualCallees.swift"), "-o", str(out / "probe")]
        with (out / "compile.log").open("w") as log:
            compiled = subprocess.run(command, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=60)
        result = subprocess.run([str(out / "probe")], capture_output=True, text=True, timeout=10) if compiled.returncode == 0 else None
    (out / "result.log").write_text(result.stdout + result.stderr if result else "NOT_RUN: compile failed")
    sha = lambda value: hashlib.sha256(value).hexdigest()
    drift = {path: Path(path).read_bytes() != value for path, value in snapshots.items()}
    registration = source.index("normalProofRegistration = try await protection.registerNormalProof(")
    wiring = {
        "actualRegisterAfterFinalGraph": source.index("let proofAck = try await protection.updateBootstrapGraph(") < registration,
        "actualRegisterBeforeChildResume": registration < source.index("try await pg.resume(after: proofAck"),
        "requireLiveAfterActualProof": source.index("try await awaitProof(pg,") < source.index("if normalProofBinding != nil { try await requireNormalProofRegistration()"),
        "sameRefreshCoalesced": "if let pending = normalProofRefresh { try await pending.value; return }" in source,
        "noDefaultAuthorize": "func perform(authorize: (URLRequest) throws -> Void) throws -> Data" in source,
        "stopAdoptsThenClosesLateRegistration": "normalProofRegistration?.close()\n        if let refresh = normalProofRefresh" in source,
        "childActualOpaqueFactory": "let authority = try RoutedNormalProofChildAuthority.begin(binding: binding)" in normal,
        "childScopeBeforeRequest": normal.index("try NymProofHelper.validateAuthorityScope(") < normal.index("let body = try transfer.perform"),
        "childRevocationCancels": "authority.installRevocationHandler { transfer.cancel() }" in normal
    }
    receipt = {"schema": "P05_NYM_NORMAL_PROOF_CALLEE_DELTA_V1", "sourceSHA256": {path: sha(value) for path, value in snapshots.items()},
               "extractedSHA256": [sha(value.encode()) for value in excerpts + [domain] + helper + lookup + [classifier]],
               "compileCommand": command, "compileExit": compiled.returncode, "testExit": result.returncode if result else None,
               "result": result.stdout if result else None, "sourceDrift": drift, "wiringReadbackOnly": wiring,
               "failureOnly": args.failure_only,
               "scope": "Actual normal lookup/scope/identity callees; one real NoTeam self-identity rejection; all other comparisons are DATA, not capability or signed Provider success",
               "notRun": ["fullCore/fullNative", "normal-authority-positive", "Root/Gate/NE/vendor/network/GUI/profile/keys"]}
    (out / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(out)
    if compiled.returncode or result is None or result.returncode or any(drift.values()) or not all(wiring.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
