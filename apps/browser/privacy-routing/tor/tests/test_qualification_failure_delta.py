#!/usr/bin/env python3
"""New typed qualification rejection/first-cause delta, no old suites or vendor."""
import argparse
import hashlib
import json
import platform
from pathlib import Path
import subprocess
import time
from test_worker_ownership import segment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args(); output = args.output.resolve()
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    browser = Path(__file__).resolve().parents[3]; tests = Path(__file__).parent
    selected = {
        'native/Sources/YNXBrowserNative/TorProtectedRouteProvider.swift': ['enum TorCoordinatorFailure:'],
        'native/Sources/YNXBrowserNative/TorExternalTransport.swift': ['enum TorTransportFailure:'],
        'native/Sources/YNXBrowserCore/ProtectionLease.swift': ['enum ProtectionLeaseFailure:'],
        'native/Sources/YNXBrowserCore/PrivacyRouteProvider.swift': ['enum PrivacyRouteError:'],
        'native/Sources/YNXBrowserCore/RoutedProductionQualification.swift': ['enum RoutedQualificationFailure:'],
        'native/Sources/YNXBrowserCore/SyntheticCanaryProtocol.swift': ['enum SyntheticTrialFailure:'],
    }
    inputs, declarations = {}, []
    for rel, names in selected.items():
        raw = (browser / rel).read_bytes(); inputs[rel] = hashlib.sha256(raw).hexdigest()
        (output / Path(rel).name).write_bytes(raw)
        for name in names:
            value = segment(raw.decode(), name)
            if name == 'enum SyntheticTrialFailure:': value = '#if YNX_PRIVACY_ACCEPTANCE\n' + value + '\n#endif'
            declarations.append(value)
    for filename in ['ProductionStartupAdmissionDeltaProbe.swift', 'QualificationFailureDeltaProbe.swift']:
        p = tests / filename; raw = p.read_bytes(); inputs[str(p.relative_to(browser))] = hashlib.sha256(raw).hexdigest()
        (output / filename).write_bytes(raw)
    doubles = (tests / 'ProductionStartupAdmissionDeltaProbe.swift').read_text().split('@main struct')[0]
    doubles = doubles.replace(segment(doubles, 'enum TorCoordinatorFailure:'), '')
    source = (browser / 'native/Sources/YNXBrowserNative/TorProtectedRouteProvider.swift').read_text()
    assert 'recordObservedFailure(error)' in segment(source, 'private func performStart(')
    assert 'fenceObservedStatusFailure(error, expected: expected)' in segment(source, 'func status() async -> PrivacyRouteStatus')
    assert 'recordObservedFailure(error)' in segment(source, 'private func fenceObservedStatusFailure(')
    actual = output / 'ActualQualificationDeclarations.swift'
    actual.write_text('import Foundation\n' + '\n'.join(declarations) + '\n' + doubles + '''
@MainActor final class ActualStartupAdmission {
    var bundle = FixtureBundle()
    let entryPort: UInt16 = 19150
    var protection: BrowserRouteProtection?
    var offlineTouches = 0
    var firstQualificationFailure: RoutedQualificationFailure?
    var firstFailure: TorCoordinatorFailure?
    var lastFailure: TorCoordinatorFailure?
    #if YNX_PRIVACY_ACCEPTANCE
    var acceptanceAuthority: SyntheticTrialAuthority?
    #endif
    init(protection: BrowserRouteProtection? = nil) { self.protection = protection }
    func fence(_ failure: TorCoordinatorFailure) {}
    func observeAuthorization(helperSHA256: String) {
        do { try authorizeStartup(helperSHA256: helperSHA256); offlineTouches += 1 }
        catch { recordObservedFailure(error) }
    }
    func observe(_ error: Error) { recordObservedFailure(error) }
''' + '\n'.join(segment(source, name) for name in ['private static func verifyLaunchIdentity(',
        'private func authorizeStartup(', 'private func recordFailure(', 'private func recordObservedFailure(']) + '\n}\n')
    (output / 'inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')
    events, failure = [], None
    try:
        for mode in ['normal', 'acceptance']:
            binary = output / ('qualification-' + mode)
            command = ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target', platform.machine() + '-apple-macosx14.0', '-j', '1', '-module-cache-path', str(output / 'module-cache'), '-parse-as-library']
            if mode == 'acceptance': command += ['-DYNX_PRIVACY_ACCEPTANCE']
            for name, command, budget in [(mode + '-compile', command + [str(actual), str(output / 'QualificationFailureDeltaProbe.swift'), '-o', str(binary)], 90), (mode + '-delta', [str(binary)], 8)]:
                started = time.monotonic(); p = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE); timeout = False
                try: stdout, stderr = p.communicate(timeout=budget)
                except subprocess.TimeoutExpired:
                    timeout = True; p.terminate()
                    try: stdout, stderr = p.communicate(timeout=2)
                    except subprocess.TimeoutExpired: p.kill(); stdout, stderr = p.communicate(timeout=2)
                (output / (name + '.stdout')).write_bytes(stdout); (output / (name + '.stderr')).write_bytes(stderr)
                events.append(dict(name=name, command=command, pid=p.pid, returncode=p.returncode, timeout=timeout, reaped=p.poll() is not None, seconds=time.monotonic()-started))
                if timeout or p.returncode: raise RuntimeError(name + ' failed; first cause preserved')
        for rel, digest in inputs.items():
            if hashlib.sha256((browser / rel).read_bytes()).hexdigest() != digest: raise RuntimeError('source drift: ' + rel)
    except Exception as error: failure = str(error)
    result = dict(status='FAIL' if failure else 'PASS', firstCause=failure, processes=events,
                  scope='actual Tor classification, recording and authorization declarations; PUBLIC rejection doubles only',
                  qualificationRootBackendWKNetwork='NOT_RUN', oldGroupsRepeated=False)
    (output / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2)); raise SystemExit(1 if failure else 0)


if __name__ == '__main__': main()
