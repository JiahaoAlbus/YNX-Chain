#!/usr/bin/env python3
"""Only the normal Tor startup qualification composition delta; no Core/vendor build."""
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
    parser.add_argument('--legacy-counterexample', action='store_true')
    args = parser.parse_args(); output = args.output.resolve()
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    browser = Path(__file__).resolve().parents[3]
    provider = browser / 'native/Sources/YNXBrowserNative/TorProtectedRouteProvider.swift'
    probe = Path(__file__).with_name('ProductionStartupAdmissionDeltaProbe.swift')
    inputs = {}
    for source in [provider, probe]:
        data = source.read_bytes(); inputs[str(source.relative_to(browser))] = hashlib.sha256(data).hexdigest()
        (output / source.name).write_bytes(data)
    source = provider.read_text()
    actual = output / 'ActualStartupAdmission.swift'
    actual.write_text('''import Foundation
@MainActor final class ActualStartupAdmission {
    var bundle = FixtureBundle()
    let entryPort: UInt16 = 19150
    var protection: BrowserRouteProtection?
    var offlineTouches = 0
    #if YNX_PRIVACY_ACCEPTANCE
    var acceptanceAuthority: SyntheticTrialAuthority?
    #endif
    init(protection: BrowserRouteProtection? = nil) { self.protection = protection }
    func fence(_ failure: TorCoordinatorFailure) {}
    func touchOfflineFixtureAfterAuthorization(helperSHA256: String) throws {
        try authorizeStartup(helperSHA256: helperSHA256)
        offlineTouches += 1
    }
''' + '\n'.join(segment(source, n) for n in [
        'static func preflight(', 'private static func verifyLaunchIdentity(',
        'private func authorizeStartup(']) + '\n}\n')
    (output / 'inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')
    events, failure = [], None
    modes = ['normal'] if args.legacy_counterexample else ['normal', 'acceptance']
    try:
        for mode in modes:
            binary = output / ('admission-' + mode)
            compile = ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target', platform.machine() + '-apple-macosx14.0', '-j', '1',
                       '-module-cache-path', str(output / 'module-cache'), '-parse-as-library']
            if mode == 'acceptance': compile += ['-DYNX_PRIVACY_ACCEPTANCE']
            commands = [(mode + '-compile', compile + [str(actual), str(output / probe.name), '-o', str(binary)], 90),
                        (mode + '-delta', [str(binary)] + (['--legacy-counterexample'] if args.legacy_counterexample else []), 8)]
            for name, command, budget in commands:
                started = time.monotonic(); p = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                timeout = False
                try: stdout, stderr = p.communicate(timeout=budget)
                except subprocess.TimeoutExpired:
                    timeout = True; p.terminate()
                    try: stdout, stderr = p.communicate(timeout=2)
                    except subprocess.TimeoutExpired: p.kill(); stdout, stderr = p.communicate(timeout=2)
                (output / (name + '.stdout')).write_bytes(stdout); (output / (name + '.stderr')).write_bytes(stderr)
                events.append(dict(name=name, command=command, pid=p.pid, returncode=p.returncode, timeout=timeout,
                                   reaped=p.poll() is not None, seconds=time.monotonic() - started))
                if timeout or p.returncode: raise RuntimeError(name + ' failed; first cause preserved')
        for rel, digest in inputs.items():
            if hashlib.sha256((browser / rel).read_bytes()).hexdigest() != digest: raise RuntimeError('source drift: ' + rel)
    except Exception as error: failure = str(error)
    result = dict(status='FAIL' if failure else ('BUG_REPRODUCED' if args.legacy_counterexample else 'PASS'),
                  firstCause=failure, processes=events, modes=modes,
                  scope='actual Tor authorizeStartup/preflight/identity declarations with PUBLIC control-flow doubles',
                  qualificationRootBackendWKNetwork='NOT_RUN', oldGroupsRepeated=False)
    (output / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2)); raise SystemExit(1 if failure else 0)


if __name__ == '__main__': main()
