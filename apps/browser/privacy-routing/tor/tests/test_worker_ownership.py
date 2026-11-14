#!/usr/bin/env python3
"""Compile the actual production Tor startup ownership/classifier declarations only."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time


def segment(text, name):
    if text.count(name) != 1:
        raise ValueError('ambiguous production declaration')
    start = text.index(name)
    end = text.index('{', start) + 1
    depth = 1
    while depth:
        if end >= len(text):
            raise ValueError('incomplete production declaration')
        depth += (text[end] == '{') - (text[end] == '}')
        end += 1
    return text[start:end]


NYM_PUBLIC_SOURCES = ('NymPublicSearchRuntime.swift', 'NymPublicDirectoryData.swift')
NYM_DECLARATION_SOURCE = 'NymProtectedRouteProvider.swift'


def nym_public_declarations(provider_text):
    names = (
        'enum NymProtectedFailure:',
        '@MainActor final class NymStartupOperation',
        'struct NymNumericBootstrapPlan:',
        'struct NymReviewedNetworkPolicy:',
        'final class NymObservedStartupLine',
        'struct NymModeGatewayState',
    )
    return 'import CoreFoundation\nimport CryptoKit\nimport Darwin\n' + '\n'.join(
        segment(provider_text, name) for name in names
    ) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='new managed scratch directory')
    args = parser.parse_args()
    output = args.output.resolve(); output.mkdir(parents=True, mode=0o700, exist_ok=False)
    browser = Path(__file__).resolve().parents[3]
    declarations = {
        'native/Sources/YNXBrowserNative/TorProtectedRouteProvider.swift': ['enum TorCoordinatorFailure:', '@MainActor final class TorStartupOwnership<Value: Sendable>'],
        'native/Sources/YNXBrowserNative/TorExternalTransport.swift': ['enum TorTransportFailure:'],
        'native/Sources/YNXBrowserCore/ProtectionLease.swift': ['enum ProtectionLeaseFailure:'],
        'native/Sources/YNXBrowserCore/PrivacyRouteProvider.swift': ['enum PrivacyRouteError:'],
        'native/Sources/YNXBrowserCore/RoutedProductionQualification.swift': ['enum RoutedQualificationFailure:'],
    }
    inputs, slices = {}, []
    for relative, names in declarations.items():
        data = (browser / relative).read_bytes()
        inputs[relative] = hashlib.sha256(data).hexdigest()
        (output / Path(relative).name).write_bytes(data)
        slices.extend(segment(data.decode(), name) for name in names)
    production = output / 'ActualWorkerDeclarations.swift'
    production.write_text('import Foundation\n\n' + '\n\n'.join(slices) + '\n')
    source = Path(__file__).with_name('WorkerOwnershipDeltaProbe.swift')
    probe = output / source.name; probe.write_bytes(source.read_bytes())
    inputs[str(source.relative_to(browser))] = hashlib.sha256(probe.read_bytes()).hexdigest()
    (output / 'inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')
    commands = [('compile', ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target', 'arm64-apple-macosx14.0', '-j', '1',
                             '-module-cache-path', str(output / 'module-cache'), '-parse-as-library', str(production), str(probe), '-o', str(output / 'worker-delta')], 90),
                ('new-delta', [str(output / 'worker-delta')], 8)]
    events, failure = [], None
    for name, command, budget in commands:
        started = time.monotonic(); process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        timed_out = False
        try:
            stdout, stderr = process.communicate(timeout=budget)
        except subprocess.TimeoutExpired:
            timed_out = True; process.terminate()
            try: stdout, stderr = process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill(); stdout, stderr = process.communicate(timeout=2)
        (output / (name + '.stdout')).write_bytes(stdout); (output / (name + '.stderr')).write_bytes(stderr)
        events.append(dict(name=name, command=command, pid=process.pid, returncode=process.returncode, timeout=timed_out,
                           reaped=process.poll() is not None, seconds=time.monotonic() - started))
        if timed_out or process.returncode:
            failure = name + ' failed/timeout; original stdout/stderr preserved'
            break
    if failure is None:
        for relative, digest in inputs.items():
            if hashlib.sha256((browser / relative).read_bytes()).hexdigest() != digest:
                failure = 'source drift: ' + relative
    report = dict(status='FAIL' if failure else 'PASS', firstCause=failure, processes=events,
                  scope='actual production startup ownership helper, PUBLIC memory fixtures; not a full Native build',
                  old28And29Repeated=False, BrowserRouteReady='NOT_RUN', LeakSafe='NOT_RUN', vendorNetworkGUI='NOT_RUN')
    (output / 'RESULT.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2)); raise SystemExit(1 if failure else 0)


if __name__ == '__main__':
    main()
