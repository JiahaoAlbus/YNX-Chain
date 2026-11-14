#!/usr/bin/env python3
"""Only new stale PT poll success/lease lifetime boundaries, actual method body."""
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
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--legacy-counterexample', action='store_true')
    mode.add_argument('--disconnect-fence-only', action='store_true')
    args = parser.parse_args(); output = args.output.resolve(); output.mkdir(mode=0o700, parents=True, exist_ok=False)
    browser = Path(__file__).resolve().parents[3]
    source = browser / 'native/Sources/YNXBrowserNative/TorExternalTransport.swift'
    provider = source.with_name('TorProtectedRouteProvider.swift')
    probe = Path(__file__).with_name('StaleTransportPollDeltaProbe.swift')
    inputs = {}
    for path in [source, provider, probe]:
        raw = path.read_bytes(); inputs[str(path.relative_to(browser))] = hashlib.sha256(raw).hexdigest()
        (output / path.name).write_bytes(raw)
    text = source.read_text()
    actual = output / 'ActualTransportPoll.swift'
    actual.write_text('import Foundation\n' + segment(text, 'enum TorTransportFailure:') + '''
@MainActor final class ActualTransportPoll {
    enum State: Equatable { case stopped, suspended, starting, protocolAvailable(UInt16), stopping, failed }
    var gate: PublicPollGate?
    var generation = UUID()
    var state: State = .protocolAvailable(1111)
    var freshControlLease: (() throws -> Void)?
    var ownerStops = 0
    var stopPause: PublicPollPause?
    func stop() async {
        ownerStops += 1
        if let stopPause { await stopPause.wait() }
        gate = nil; state = .stopped
    }
''' + segment(text, 'func poll(') + '''
}
@MainActor final class PublicRevocableContent {
    private(set) var closed = false
    func close() { closed = true }
}
@MainActor final class ActualDisconnectFence {
    enum Phase { case connected, blocked }
    var phase = Phase.connected
    var generation = UUID()
    let protection: PublicRevocableContent? = PublicRevocableContent()
    let preparation: PublicRevocableContent? = PublicRevocableContent()
    private(set) var firstFailure: TorCoordinatorFailure?
    func recordObservedFailure(_ error: Error) { recordFailure(TorCoordinatorFailure.classify(error)) }
    func recordFailure(_ failure: TorCoordinatorFailure) { if firstFailure == nil { firstFailure = failure } }
    func stop() async {}
''' + segment(provider.read_text(), 'private func fenceObservedStatusFailure(').replace('private func', 'func', 1) + '\n'
        + segment(provider.read_text(), 'private func fence(_ failure:') + '\n}\n')
    (output / 'inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')
    runtime_args = []
    if args.legacy_counterexample:
        runtime_args.append('--legacy-counterexample')
    if args.disconnect_fence_only:
        runtime_args.append('--disconnect-fence-only')
    commands = [('compile', ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target', 'arm64-apple-macosx14.0', '-j', '1',
                             '-module-cache-path', str(output / 'module-cache'), '-parse-as-library', str(actual), str(output / probe.name), '-o', str(output / 'poll-delta')], 90),
                ('new-delta', [str(output / 'poll-delta')] + runtime_args, 8)]
    events, failure = [], None
    for name, command, budget in commands:
        started = time.monotonic(); process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE); timeout = False
        try: stdout, stderr = process.communicate(timeout=budget)
        except subprocess.TimeoutExpired:
            timeout = True; process.terminate()
            try: stdout, stderr = process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill(); stdout, stderr = process.communicate(timeout=2)
        (output / (name + '.stdout')).write_bytes(stdout); (output / (name + '.stderr')).write_bytes(stderr)
        events.append(dict(name=name, command=command, pid=process.pid, returncode=process.returncode, timeout=timeout,
                           reaped=process.poll() is not None, seconds=time.monotonic() - started))
        if timeout or process.returncode:
            failure = name + ' failed; original error preserved'; break
    drift = [r for r, d in inputs.items() if hashlib.sha256((browser / r).read_bytes()).hexdigest() != d]
    if drift and failure is None: failure = 'source drift'
    result = dict(status='FAIL' if failure else ('BUG_REPRODUCED' if args.legacy_counterexample else 'PASS'),
                  firstCause=failure, sourceDrift=drift, processes=events, scope='actual PT poll with PUBLIC memory fixtures',
                  mode='DISCONNECT_FENCE_ONLY' if args.disconnect_fence_only else 'STALE_POLL', BrowserRouteReadyLeakSafe='NOT_RUN', vendorNetworkGUI='NOT_RUN', old23_38_16Repeated=False)
    (output / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2)); raise SystemExit(1 if failure else 0)


if __name__ == '__main__':
    main()
