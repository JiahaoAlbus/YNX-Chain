#!/usr/bin/env python3
"""Compare the actual fixed Arti configuration writer and PUBLIC A/B trace binding offline."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import re

from test_r2_path_sample import run
from test_worker_ownership import segment


CONTROL = r'''
@main struct BindingProbe {
    @MainActor static func main() throws {
        let directoryA = URL(fileURLWithPath: "/synthetic-A/Tor")
        let directoryB = URL(fileURLWithPath: "/synthetic-B/Tor")
        let arti = ArtiProcessAdapter.BinaryPin(executable: directoryA, binarySHA256: BundledTorBackend.artiSHA256,
                    sourceArchiveSHA256: BundledTorBackend.sourceSHA256, version: "2.7.0")
        let line = "obfs4 SYNTHETIC-BRIDGE-DATA"
        func bridge(_ root: URL, _ line: String) -> ArtiProcessAdapter.BridgeConfiguration {
            .init(lines: [line], transport: root.appendingPathComponent("synthetic-lyrebird"), transportSHA256: BundledTorBackend.lyrebirdSHA256)
        }
        func config(_ port: UInt16, _ root: URL, _ bridge: ArtiProcessAdapter.BridgeConfiguration) throws -> String {
            try ArtiProcessAdapter.configuration(port: port, sessionDirectory: root, deferBootstrap: false, bridge: bridge)
        }
        let aBridge = bridge(directoryA, line), bBridge = bridge(directoryB, line)
        let aConfig = try config(63780, directoryA, aBridge), bConfig = try config(63779, directoryB, bBridge)
        let a = ArtiProcessAdapter.publicComparisonBinding(pin: arti, port: 63780, directory: directoryA, bridge: aBridge, config: aConfig)!
        let b = ArtiProcessAdapter.publicComparisonBinding(pin: arti, port: 63779, directory: directoryB, bridge: bBridge, config: bConfig)!
        let otherBridge = bridge(directoryB, "obfs4 CHANGED-SYNTHETIC-BRIDGE")
        let otherConfig = try config(63779, directoryB, otherBridge)
        let other = ArtiProcessAdapter.publicComparisonBinding(pin: arti, port: 63779, directory: directoryB, bridge: otherBridge, config: otherConfig)!
        var external = bBridge
        external.externalProxyPort = 42
        let externalConfig = try config(63779, directoryB, external)
        let externalDenied = ArtiProcessAdapter.publicComparisonBinding(pin: arti, port: 63779, directory: directoryB, bridge: external, config: externalConfig) == nil
        let staleDenied = ArtiProcessAdapter.publicComparisonBinding(pin: arti, port: 63779, directory: directoryB, bridge: bBridge, config: aConfig) == nil
        let foreign = ArtiProcessAdapter.BinaryPin(executable: directoryA, binarySHA256: String(repeating: "9", count: 64),
                    sourceArchiveSHA256: BundledTorBackend.sourceSHA256, version: "2.7.0")
        let foreignDenied = ArtiProcessAdapter.publicComparisonBinding(pin: foreign, port: 63779, directory: directoryB, bridge: bBridge, config: bConfig) == nil
        let json = String(decoding: try JSONSerialization.data(withJSONObject: [a,b,other]), as: UTF8.self)
        let normalized = "normalizedConfigurationSHA256", exact = "configurationSHA256"
        let checks = [
            "normalizationIgnoresInstancePathsAndPort": a[normalized] as? String == b[normalized] as? String,
            "exactConfigurationKeepsInstanceDifferences": a[exact] as? String != b[exact] as? String,
            "bridgeChangeDistinguishesInputs": b[normalized] as? String != other[normalized] as? String,
            "unmanagedTransportExcluded": externalDenied,
            "staleExactConfigurationExcluded": staleDenied,
            "differentArtiBytesExcluded": foreignDenied,
            "noBridgeOrDirectoryText": !json.contains("SYNTHETIC") && !json.contains("synthetic"),
            "sameBindingNeverGrantsSameNetwork": a["sameBindingIsNotProofOfSameNetwork"] as? Bool == true,
        ]
        print(String(decoding: try JSONSerialization.data(withJSONObject: checks, options: [.sortedKeys]), as: UTF8.self))
        exit(checks.values.allSatisfy { $0 } ? 0 : 1)
    }
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    native = Path(__file__).resolve().parents[3]/'native/Sources/YNXBrowserNative'
    native_source = native/'PrivacyTorPlatform.swift'
    supply_source = native/'BundledTorBackend.swift'
    cli_source = Path(__file__).with_name('R2AdjacentCLI.swift')
    source = {p: p.read_bytes() for p in (native_source, supply_source, cli_source)}
    actual = source[native_source].decode()
    swift = out/'ActualR2Binding.swift'
    supply = source[supply_source].decode()
    constants = re.findall(r'^    static let (?:artiSHA256|sourceSHA256|lyrebirdSHA256|bridgesSHA256) = "[0-9a-f]+"$', supply, re.M)
    manifest = re.search(r'^    static let manifestFields:.*?^    \]', supply, re.M | re.S)[0]
    pieces = [segment(actual, name) for name in ('struct BinaryPin {', 'struct BridgeConfiguration {',
              'static func configuration(', 'static func publicComparisonBinding(')]
    swift.write_text('import Foundation\nimport CryptoKit\nimport Darwin\n'
                     'enum TorPlatformError: Error { case invalidPort, invalidPin, binaryMismatch }\n'
                     '@MainActor enum BundledTorBackend {\n'+'\n'.join(constants)+'\n'+manifest+'\n}\n'
                     '@MainActor final class ArtiProcessAdapter {\nstatic let pinnedVersion = "2.7.0"\n'
                     +'\n'.join(pieces)+'\n}\n'+CONTROL)
    marker = 'trace.record("fixedBackendComparisonBinding", binding)'
    callers = {'browser': marker in segment(actual, 'func start(pin:'),
               'cli': marker in segment(source[cli_source].decode(), 'func start(prepared:')}
    binary = out/'r2-binding-probe'
    steps = {'compile':run(['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-j', '1',
                           '-target', f'{platform.machine()}-apple-macosx14.0', '-parse-as-library',
                           '-module-cache-path', str(out/'module-cache'), str(swift), '-o', str(binary)], out, 'compile', 30)}
    if steps['compile']['originalWait'] == 0:
        steps['probe'] = run([str(binary)], out, 'probe', 8)
    checks = json.loads((out/'probe.stdout').read_text()) if steps.get('probe', {}).get('originalWait') == 0 else {}
    passed = len(checks)==8 and all(checks.values()) and all(callers.values()) and all(p.read_bytes()==raw for p,raw in source.items())
    result = dict(status='PASS' if passed else 'FAIL', steps=steps, checks=checks, callerSourceChecks=callers,
                  sourceSHA256={str(p):hashlib.sha256(raw).hexdigest() for p,raw in source.items()},
                  realBackend='NOT_RUN', network='NOT_RUN', installedAB='NOT_RUN')
    (out/'RESULT.json').write_text(json.dumps(result, indent=2)+'\n')
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
