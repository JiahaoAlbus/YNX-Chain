#!/usr/bin/env python3
"""New resource postconditions for actual Arti/PT stop consumers; no real backend."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
from test_worker_ownership import segment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='new managed scratch directory')
    parser.add_argument('--early-cancel-only', action='store_true', help='only new cleanup PID edge; do not rerun38')
    args = parser.parse_args(); output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    browser = Path(__file__).resolve().parents[3]
    arti = browser / 'native/Sources/YNXBrowserNative/TorProtectedRouteProvider.swift'
    pt = browser / 'native/Sources/YNXBrowserNative/TorExternalTransport.swift'
    probe = Path(__file__).with_name('GateCleanupConsumerDeltaProbe.swift')
    extractor = Path(__file__).with_name('test_worker_ownership.py')
    inputs = {}
    for source in [arti, pt, probe, extractor]:
        data = source.read_bytes(); inputs[str(source.relative_to(browser))] = hashlib.sha256(data).hexdigest()
        (output / source.name).write_bytes(data)
    arti_method = segment(arti.read_text(), 'private func performStop() async')
    pt_method = segment(pt.read_text(), 'func stop() async')
    release = segment(pt.read_text(), 'private func releaseOwnership()')
    # All control/resource mutation below comes from those original method bodies.
    # Only their dependencies are PUBLIC fakes; the lock is a real fresh OS flock.
    fixtures = '''import Foundation
import Darwin
@MainActor final class ActualArtiStopConsumer: PublicLock {
    enum Cleanup { case notStarted, complete, unconfirmed }
    var preparation: Int? = nil
    var artiGate: PublicGate?
    var artiPrepareInvoked = true
    let transport = PublicTransport()
    var cleanupStatus: Cleanup = .notStarted
    var firstFailure: PublicFailure?
    init(root: URL, gate: PublicGate) throws { artiGate = gate; try super.init(root: root) }
    func recordFailure(_ failure: PublicFailure) { if firstFailure == nil { firstFailure = failure } }
    func stop() async { await performStop() }
''' + arti_method + '''
}
@MainActor final class ActualPTStopConsumer: PublicLock {
    enum Cleanup { case notStarted, reaped, unconfirmed }
    enum State { case starting, stopping, failed, stopped }
    var gate: PublicGate?
    var generation = UUID()
    var state: State = .starting
    var cleanupStatus: Cleanup = .notStarted
    var freshControlLease: (() -> Void)? = nil
    var identity: Int? = nil
    var sourceBridge: Int? = nil
    var entryPeers: [Int] = []
    var bootstrapMarkerSHA256: String? = nil
    var outputDiscardAcknowledgement: Int? = nil
    init(root: URL, gate: PublicGate) throws { self.gate = gate; try super.init(root: root) }
''' + pt_method + '\n' + release + '\n}\n'
    actual = output / 'ActualStopConsumers.swift'; actual.write_text(fixtures)
    (output / 'inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')
    commands = [('compile', ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target', 'arm64-apple-macosx14.0',
                             '-j', '1', '-module-cache-path', str(output / 'module-cache'), '-parse-as-library',
                             str(actual), str(output / probe.name), '-o', str(output / 'consumer-delta')], 90),
                ('new-delta', [str(output / 'consumer-delta'), str(output / 'PUBLIC-flocks')] +
                 (['--early-cancel-only'] if args.early_cancel_only else []), 10)]
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
        events.append(dict(name=name, command=command, pid=process.pid, returncode=process.returncode,
                           timeout=timeout, reaped=process.poll() is not None, seconds=time.monotonic() - start))
        if timeout or process.returncode:
            failure = name + ' failed; original compiler/runtime error preserved'; break
    drift = [r for r, digest in inputs.items() if hashlib.sha256((browser / r).read_bytes()).hexdigest() != digest]
    if drift and failure is None: failure = 'source drift'
    result = dict(status='FAIL' if failure else 'PASS', firstCause=failure, sourceDrift=drift, processes=events,
                  ownedLockFilesRemaining=(output / 'PUBLIC-flocks').exists(),
                  scope='actual stop-consumer bodies and real fresh owned OS flocks; gate/process receipts are PUBLIC fixtures',
                  signedNEBrowserRouteReadyLeakSafe='NOT_RUN', old23Repeated=False,
                  phase='early-cancel16-only' if args.early_cancel_only else 'original-consumer38')
    (output / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2)); raise SystemExit(1 if failure else 0)


if __name__ == '__main__':
    main()
