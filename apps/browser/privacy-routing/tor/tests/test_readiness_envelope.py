#!/usr/bin/env python3
"""New readiness envelope/parser delta using actual source declarations; no backend."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
from test_worker_ownership import segment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--legacy-counterexample', action='store_true')
    args = parser.parse_args(); output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    browser = Path(__file__).resolve().parents[3]
    sources = {
        'native/Sources/YNXBrowserNative/PrivacyTorPlatform.swift': ['struct ArtiBootstrapSignalParser'],
        'native/Sources/YNXBrowserNative/TorProtectedRouteProvider.swift': ['enum TorCoordinatorFailure:', 'struct TorBootstrapOutputMarker'],
        'native/Sources/YNXBrowserNative/TorExternalTransport.swift': ['enum TorTransportFailure:'],
        'native/Sources/YNXBrowserCore/ProtectionLease.swift': ['enum ProtectionLeaseFailure:'],
        'native/Sources/YNXBrowserCore/PrivacyRouteProvider.swift': ['enum PrivacyRouteError:'],
        'native/Sources/YNXBrowserCore/RoutedProductionQualification.swift': ['enum RoutedQualificationFailure:'],
    }
    inputs, declarations = {}, []
    for relative, names in sources.items():
        raw = (browser / relative).read_bytes(); inputs[relative] = hashlib.sha256(raw).hexdigest()
        (output / Path(relative).name).write_bytes(raw)
        declarations.extend(segment(raw.decode(), name) for name in names)
    actual = output / 'ActualReadinessDeclarations.swift'
    actual.write_text('import Foundation\nimport CryptoKit\n\n' + '\n\n'.join(declarations) + '\n')
    probe = Path(__file__).with_name('ReadinessEnvelopeDeltaProbe.swift')
    raw = probe.read_bytes(); inputs[str(probe.relative_to(browser))] = hashlib.sha256(raw).hexdigest()
    copied = output / probe.name; copied.write_bytes(raw)
    (output / 'inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')
    commands = [('compile', ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target', 'arm64-apple-macosx14.0', '-j', '1',
                             '-module-cache-path', str(output / 'module-cache'), '-parse-as-library', str(actual), str(copied), '-o', str(output / 'readiness-delta')], 90),
                ('new-delta', [str(output / 'readiness-delta')] + (['--legacy-counterexample'] if args.legacy_counterexample else []), 8)]
    events, failure = [], None
    for name, command, budget in commands:
        start = time.monotonic(); process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        timeout = False
        try: stdout, stderr = process.communicate(timeout=budget)
        except subprocess.TimeoutExpired:
            timeout = True; process.terminate()
            try: stdout, stderr = process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill(); stdout, stderr = process.communicate(timeout=2)
        (output / (name + '.stdout')).write_bytes(stdout); (output / (name + '.stderr')).write_bytes(stderr)
        events.append(dict(name=name, command=command, pid=process.pid, returncode=process.returncode, timeout=timeout,
                           reaped=process.poll() is not None, seconds=time.monotonic() - start))
        if timeout or process.returncode:
            failure = name + ' failed; first error preserved'; break
    drift = [r for r, digest in inputs.items() if hashlib.sha256((browser / r).read_bytes()).hexdigest() != digest]
    if drift and failure is None: failure = 'source drift'
    result = dict(status='FAIL' if failure else ('BUG_REPRODUCED' if args.legacy_counterexample else 'PASS'),
                  firstCause=failure, sourceDrift=drift, processes=events, scope='actual readiness parser and owned marker declarations, PUBLIC bytes only',
                  BrowserRouteReady='NOT_RUN', vendorNetworkGUI='NOT_RUN', old23_38_16Repeated=False)
    (output / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2)); raise SystemExit(1 if failure else 0)


if __name__ == '__main__':
    main()
