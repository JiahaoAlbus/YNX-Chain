#!/usr/bin/env python3
"""Reproduce an exclusive R2 result-write failure with a bounded local child."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import time

from test_worker_ownership import segment


FIXTURE = r'''
import Foundation
import Darwin

@MainActor final class OwnedHarmlessProcess {
    let process: Process
    let output: URL
    init(_ process: Process, output: URL) { self.process = process; self.output = output }
    var processIdentifier: Int32? {
        FileManager.default.fileExists(atPath: output.appendingPathComponent("original.wait").path)
            ? nil : process.processIdentifier
    }
    func pollProcess() {
        if !process.isRunning {
            process.waitUntilExit()
            try! Data(String(process.terminationStatus).utf8).write(to: output.appendingPathComponent("original.wait"))
        }
    }
}

@main struct ReceiptCustodyProbe {
    @MainActor static func main() async {
        if CommandLine.arguments[1] == "--harmless-child" {
            try? await Task.sleep(for: .seconds(2))
            exit(0)
        }
        await runActualMain()
    }

    @MainActor static var retainedAdapter: OwnedHarmlessProcess?
    @MainActor static var retainedCurl: Process?
    @MainActor static func run(_ output: URL) async throws -> [String: Any] {
        let child = Process()
        child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
        child.arguments = ["--harmless-child"]
        try child.run()
        retainedAdapter = OwnedHarmlessProcess(child, output: output)
        try Data(String(child.processIdentifier).utf8).write(to: output.appendingPathComponent("original.pid"))
        return ["status": "CLEANUP_UNKNOWN", "firstCause": "fixture-original-route-failure"]
    }
    static func prepare(_ output: URL) throws { fatalError("unexpected fixture preparation") }
    enum Stage { case entered }
    static func recordPrepareStage(_ stage: Stage) throws { fatalError("unexpected fixture stage") }

__PRODUCTION__
}
'''


def run(argv, deadline, output, stage):
    started = time.monotonic()
    with (output / f'{stage}.stdout').open('xb') as stdout, (output / f'{stage}.stderr').open('xb') as stderr:
        child = subprocess.Popen(argv, stdout=stdout, stderr=stderr, start_new_session=True)
        timed_out = False
        try:
            child.wait(timeout=deadline)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=2)
    return {'argv': argv, 'pid': child.pid, 'originalWait': child.returncode, 'reaped': child.poll() is not None,
            'timedOut': timed_out, 'seconds': time.monotonic() - started, 'processGroup': child.pid}


def group_members(group):
    rows = subprocess.check_output(['/bin/ps', '-axo', 'pid=,pgid='], text=True, timeout=2)
    return [pid for pid, group_id in (list(map(int, row.split())) for row in rows.splitlines()) if group_id == group]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    source = Path(__file__).with_name('R2AdjacentCLI.swift')
    original = source.read_bytes()
    text = original.decode()
    actual_main = segment(text, '@MainActor static func main() async').replace('func main()', 'func runActualMain()', 1)
    methods = [actual_main, segment(text, 'static func write(')]
    if '@MainActor private static func awaitOwnedCleanup(' in text:
        methods.append(segment(text, '@MainActor private static func awaitOwnedCleanup('))
    probe = output / 'ActualReceiptCustody.swift'
    probe.write_text(FIXTURE.replace('__PRODUCTION__', '\n'.join(methods)))
    (output / source.name).write_bytes(original)
    exe = output / 'receipt-custody-probe'
    commands = {'compile': run(['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-j', '1',
                                '-target', f'{platform.machine()}-apple-macosx14.0', '-parse-as-library',
                                '-module-cache-path', str(output / 'module-cache'), str(probe), '-o', str(exe)],
                               30, output, 'compile')}
    checks = {}
    if commands['compile']['originalWait'] == 0:
        collision = output / 'CLI-RESULT.json'
        saved = b'pre-existing diagnostic receipt\n'
        collision.write_bytes(saved)
        probe_run = run([str(exe), '--run-prepared', str(output)], 8, output, 'probe')
        commands['probe'] = probe_run
        error = output / 'CLI-FIRST-ERROR.json'
        report = json.loads(error.read_bytes()) if error.is_file() else {}
        marker = output / 'original.wait'
        child_pid_file = output / 'original.pid'
        child_pid = int(child_pid_file.read_text()) if child_pid_file.is_file() else None
        checks = {'originalFixturePID': child_pid,
                  'originalWaitObservedBeforeCLIExit': marker.is_file() and marker.read_text() == '0',
                  'firstRouteCausePreserved': report.get('runFirstCause') == 'fixture-original-route-failure',
                  'receiptWriteFailureRecorded': report.get('domain') == 'NSCocoaErrorDomain' and report.get('code') == 516,
                  'existingReceiptUnchanged': collision.read_bytes() == saved,
                  'errorExitAfterCustody': probe_run['originalWait'] == 2 and not probe_run['timedOut']}
        deadline = time.monotonic() + 4
        remaining = group_members(probe_run['processGroup'])
        while remaining and time.monotonic() < deadline:
            time.sleep(.05)
            remaining = group_members(probe_run['processGroup'])
        checks['fixtureGroupRemainingAfterBoundedExit'] = remaining
    pass_checks = ('originalWaitObservedBeforeCLIExit', 'firstRouteCausePreserved', 'receiptWriteFailureRecorded',
                   'existingReceiptUnchanged', 'errorExitAfterCustody')
    passed = (all(checks.get(key) is True for key in pass_checks)
              and checks.get('fixtureGroupRemainingAfterBoundedExit') == [] and source.read_bytes() == original)
    report = {'status': 'PASS' if passed else 'FAIL', 'commands': commands, 'checks': checks,
              'sourceSHA256': hashlib.sha256(original).hexdigest(), 'network': 'NOT_RUN', 'backend': 'NOT_RUN'}
    (output / 'RESULT.json').write_text(json.dumps(report, indent=2) + '\n')
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
